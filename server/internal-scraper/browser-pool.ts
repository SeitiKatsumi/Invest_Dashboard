import { STEALTH_BROWSER_ARGS, STEALTH_INIT_SCRIPT, randomUserAgent } from './utils.js';

interface PooledBrowser {
  browser: any;
  inUse: boolean;
  createdAt: number;
  useCount: number;
}

const MAX_BROWSERS = 3;
const MAX_USES_PER_BROWSER = 20;
const BROWSER_MAX_AGE_MS = 30 * 60 * 1000;

class BrowserPool {
  private pool: PooledBrowser[] = [];
  private waitQueue: Array<(browser: any) => void> = [];
  private _totalAcquired = 0;
  private _totalReleased = 0;

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

  async acquire(): Promise<{ browser: any; context: any; page: any }> {
    let pooled: PooledBrowser | undefined = this.pool.find(b => !b.inUse && !this.isExpired(b));

    if (!pooled && this.pool.length < MAX_BROWSERS) {
      pooled = (await this.createBrowser()) ?? undefined;
    }

    if (!pooled) {
      const stale = this.pool.find(b => !b.inUse && this.isExpired(b));
      if (stale) {
        await this.destroyBrowser(stale);
        pooled = (await this.createBrowser()) ?? undefined;
      }
    }

    if (!pooled) {
      const browser = await new Promise<any>((resolve) => {
        this.waitQueue.push(resolve);
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

  async release(browser: any): Promise<void> {
    const pooled = this.pool.find(b => b.browser === browser);
    if (!pooled) return;

    this._totalReleased++;

    if (this.isExpired(pooled) || pooled.useCount >= MAX_USES_PER_BROWSER) {
      await this.destroyBrowser(pooled);
      if (this.waitQueue.length > 0) {
        const newBrowser = await this.createBrowser();
        if (newBrowser) {
          const waiter = this.waitQueue.shift();
          if (waiter) waiter(newBrowser.browser);
        }
      }
      return;
    }

    pooled.inUse = false;

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        waiter(pooled.browser);
      }
    }
  }

  async drainAll(): Promise<void> {
    for (const waiter of this.waitQueue) {
      waiter(null);
    }
    this.waitQueue = [];

    for (const entry of [...this.pool]) {
      try {
        await entry.browser.close();
      } catch {}
    }
    this.pool = [];
  }

  async drainIdle(): Promise<void> {
    const idle = this.pool.filter(b => !b.inUse);
    for (const entry of idle) {
      await this.destroyBrowser(entry);
    }
  }

  private isExpired(entry: PooledBrowser): boolean {
    return Date.now() - entry.createdAt > BROWSER_MAX_AGE_MS;
  }

  private async createBrowser(): Promise<PooledBrowser | null> {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: true,
        args: STEALTH_BROWSER_ARGS,
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

  private async createContext(browser: any): Promise<{ context: any; page: any }> {
    const context = await browser.newContext({
      userAgent: randomUserAgent(),
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1920, height: 1080 },
    });
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    const page = await context.newPage();
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
