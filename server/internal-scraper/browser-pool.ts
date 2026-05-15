import type { Browser, BrowserContext, Page } from 'playwright';
import { existsSync } from 'node:fs';
import { STEALTH_BROWSER_ARGS, STEALTH_INIT_SCRIPT, randomUserAgent } from './utils.js';

interface PooledBrowser {
  browser: Browser;
  inUse: boolean;
  createdAt: number;
  useCount: number;
}

const MAX_BROWSERS = 3;
const MAX_USES_PER_BROWSER = 20;
const BROWSER_MAX_AGE_MS = 30 * 60 * 1000;
const ACQUIRE_TIMEOUT_MS = 30_000;

const CHROME_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.GOOGLE_CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((path): path is string => Boolean(path));

function findSystemChromeExecutable(): string | undefined {
  return CHROME_EXECUTABLE_CANDIDATES.find(path => existsSync(path));
}

function getPlaywrightProxy():
  | { server: string; username?: string; password?: string }
  | undefined {
  const server = (process.env.PLAYWRIGHT_PROXY_SERVER || process.env.SCRAPING_PROXY_SERVER || '').trim();
  if (!server) return undefined;

  const username = (process.env.PLAYWRIGHT_PROXY_USERNAME || process.env.SCRAPING_PROXY_USERNAME || '').trim();
  const password = (process.env.PLAYWRIGHT_PROXY_PASSWORD || process.env.SCRAPING_PROXY_PASSWORD || '').trim();
  return {
    server,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

function maskProxyServer(server: string): string {
  return server.replace(/\/\/[^/@]+@/, '//***@');
}

class BrowserPool {
  private pool: PooledBrowser[] = [];
  private waitQueue: Array<{ resolve: (browser: Browser) => void; reject: (err: Error) => void }> = [];
  private _totalAcquired = 0;
  private _totalReleased = 0;
  private _creationFailed = false;

  get activeBrowsers(): number {
    return this.pool.filter(b => b.inUse).length;
  }

  get totalBrowsers(): number {
    return this.pool.length;
  }

  get maxBrowsers(): number {
    return MAX_BROWSERS;
  }

  get stats() {
    return {
      active: this.activeBrowsers,
      total: this.totalBrowsers,
      max: MAX_BROWSERS,
      queued: this.waitQueue.length,
      totalAcquired: this._totalAcquired,
      totalReleased: this._totalReleased,
    };
  }

  async acquire(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    if (this._creationFailed) {
      throw new Error('BrowserPool: playwright browser creation previously failed');
    }

    let pooled: PooledBrowser | undefined = this.pool.find(b => !b.inUse && !this.isExpired(b));

    if (!pooled && this.pool.length < MAX_BROWSERS) {
      pooled = (await this.createBrowser()) ?? undefined;
      if (!pooled) {
        this._creationFailed = true;
        console.warn('[BrowserPool] Marcando pool como indisponível — criação de browser falhou. Fallback para fetch será usado.');
        this.rejectAllWaiters('BrowserPool: playwright browser creation failed');
        throw new Error('BrowserPool: playwright browser creation failed');
      }
    }

    if (!pooled) {
      const stale = this.pool.find(b => !b.inUse && this.isExpired(b));
      if (stale) {
        await this.destroyBrowser(stale);
        pooled = (await this.createBrowser()) ?? undefined;
        if (!pooled) {
          this._creationFailed = true;
          this.rejectAllWaiters('BrowserPool: playwright browser creation failed');
          throw new Error('BrowserPool: playwright browser creation failed');
        }
      }
    }

    if (!pooled) {
      const browser = await new Promise<Browser>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const waiter = {
          resolve: (b: Browser) => { clearTimeout(timer); resolve(b); },
          reject: (err: Error) => { clearTimeout(timer); reject(err); },
        };
        timer = setTimeout(() => {
          const idx = this.waitQueue.indexOf(waiter);
          if (idx >= 0) this.waitQueue.splice(idx, 1);
          reject(new Error('BrowserPool: acquire timeout after 30s'));
        }, ACQUIRE_TIMEOUT_MS);

        this.waitQueue.push(waiter);
      });
      const entry = this.pool.find(b => b.browser === browser)!;
      entry.inUse = true;
      entry.useCount++;
      this._totalAcquired++;
      const { context, page } = await this.createContext(entry.browser);
      return { browser: entry.browser, context, page };
    }

    pooled.inUse = true;
    pooled.useCount++;
    this._totalAcquired++;
    const { context, page } = await this.createContext(pooled.browser);
    return { browser: pooled.browser, context, page };
  }

  async release(browser: Browser): Promise<void> {
    const pooled = this.pool.find(b => b.browser === browser);
    if (!pooled) return;

    this._totalReleased++;

    if (this.isExpired(pooled) || pooled.useCount >= MAX_USES_PER_BROWSER) {
      await this.destroyBrowser(pooled);
      if (this.waitQueue.length > 0) {
        const newBrowser = await this.createBrowser();
        if (newBrowser) {
          const waiter = this.waitQueue.shift();
          if (waiter) waiter.resolve(newBrowser.browser);
        } else {
          this._creationFailed = true;
          this.rejectAllWaiters('BrowserPool: playwright browser creation failed on recycle');
        }
      }
      return;
    }

    pooled.inUse = false;

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        waiter.resolve(pooled.browser);
      }
    }
  }

  async drainAll(): Promise<void> {
    this.rejectAllWaiters('BrowserPool: pool drained');

    for (const entry of [...this.pool]) {
      try {
        await entry.browser.close();
      } catch {}
    }
    this.pool = [];
    this._creationFailed = false;
  }

  async drainIdle(): Promise<void> {
    const idle = this.pool.filter(b => !b.inUse);
    for (const entry of idle) {
      await this.destroyBrowser(entry);
    }
  }

  resetCreationFlag(): void {
    this._creationFailed = false;
  }

  private rejectAllWaiters(message: string): void {
    const waiters = [...this.waitQueue];
    this.waitQueue = [];
    for (const w of waiters) {
      w.reject(new Error(message));
    }
  }

  private isExpired(entry: PooledBrowser): boolean {
    return Date.now() - entry.createdAt > BROWSER_MAX_AGE_MS;
  }

  private async createBrowser(): Promise<PooledBrowser | null> {
    try {
      const { chromium } = await import('playwright');
      const executablePath = findSystemChromeExecutable();
      if (executablePath) {
        console.log(`[BrowserPool] Usando Chrome do sistema: ${executablePath}`);
      }
      const proxy = getPlaywrightProxy();
      if (proxy) {
        console.log(`[BrowserPool] Usando proxy Playwright: ${maskProxyServer(proxy.server)}`);
      }

      const browser = await chromium.launch({
        headless: true,
        args: STEALTH_BROWSER_ARGS,
        executablePath,
        proxy,
      });

      const entry: PooledBrowser = {
        browser,
        inUse: false,
        createdAt: Date.now(),
        useCount: 0,
      };

      this.pool.push(entry);
      return entry;
    } catch (e) {
      console.error('[BrowserPool] Failed to create browser:', e);
      return null;
    }
  }

  private async createContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
      userAgent: randomUserAgent(),
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1920, height: 1080 },
    });
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();
      if (
        ['image', 'font', 'media'].includes(resourceType) ||
        /(google-analytics|googletagmanager|facebook|doubleclick|hotjar|clarity|maps\.googleapis|cdn\.wts\.chat|cdn\.flw\.chat)/i.test(url)
      ) {
        await route.abort().catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });
    return { context, page };
  }

  private async destroyBrowser(entry: PooledBrowser): Promise<void> {
    const idx = this.pool.indexOf(entry);
    if (idx >= 0) this.pool.splice(idx, 1);
    try {
      await entry.browser.close();
    } catch {}
  }
}

export const browserPool = new BrowserPool();
