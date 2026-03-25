import * as cheerio from 'cheerio';
import type { CrawlResult, CrawlerOptions, ScrapingConfig } from './types.js';
import {
  normalizeUrl, isSameDomain, getBuiltinBlocklist,
  compileRegex, compileRegexList, randomUserAgent,
  Semaphore, sleep,
} from './utils.js';

const DEFAULT_OPTIONS: Required<CrawlerOptions> = {
  concurrentRequests: 10,
  delayMin: 0.2,
  delayMax: 0.5,
  timeout: 30000,
  maxRetries: 2,
};

const HEURISTIC_DETAIL_PATTERNS = [
  /\/lote\/\d+/i, /\/imovel\/\d+/i, /\/item\/\d+/i,
  /\/produto\/\d+/i, /\/property\/\d+/i, /\/listing\/\d+/i,
  /\/anuncio\/\d+/i, /\/venda\/\d+/i, /\/detalhe\/\d+/i,
  /\/detalhes\/\d+/i, /\/id\/\d+/i, /\/p\/\d+/i,
  /-\d{4,}/, /\/\d{4,}\//, /\/\d{4,}$/,
];

const PAGINATION_HEURISTICS = [
  /[?&](page|pagina|p|offset|skip)=\d+/i,
  /\/page\/\d+/i, /\/pagina\/\d+/i, /\/p\/\d+/i,
];

const CATEGORY_HEURISTICS = [
  /\/t\/[^/]+\/[^/]+\/?$/i,
  /\/categoria\/[^/]+\/?$/i,
  /\/tipo\/[^/]+\/?$/i,
  /\/(residenciais|comerciais|rurais|terrenos|industriais)\/?$/i,
  /\/imoveis-[^/]+\/?$/i,
  /\/eventos\/[^/]+\/?$/i,
  /\/eventos\/[^/]+\/[^/]+\/?$/i,
  /\/leilao\/[^/]+\/?$/i,
  /\/leiloes\/[^/]+\/?$/i,
  /\/auction\/[^/]+\/?$/i,
  /\/venda\/[^/]+\/?$/i,
  /\/aluguel\/[^/]+\/?$/i,
  /\/comprar\/[^/]+\/?$/i,
  /\/alugar\/[^/]+\/?$/i,
  /\/buscar\/?$/i, /\/buscador\/?$/i,
];

export class DeterministicCrawler {
  private config: ScrapingConfig | Record<string, any>;
  private domain: string;
  private useHeuristics: boolean;
  private opts: Required<CrawlerOptions>;

  private allowlist: RegExp[];
  private blocklist: RegExp[];
  private paginationPattern: RegExp | null;
  private listingIndicators: string[];
  private detailIndicators: string[];
  private categoryPatterns: RegExp[];
  private linkSelectors: string[];
  private maxListing: number;
  private maxDetail: number;

  private visitedUrls = new Set<string>();
  private collectedUrls = new Set<string>();
  private allLinksSeen = new Set<string>();
  private categoryUrls = new Set<string>();
  private listingCount = 0;
  private detailCount = 0;
  private errors: string[] = [];

  private progressCallback?: (progress: number, message: string) => void;
  private abortSignal?: AbortSignal;

  constructor(
    config: ScrapingConfig | Record<string, any>,
    options?: CrawlerOptions & {
      useHeuristics?: boolean;
      onProgress?: (progress: number, message: string) => void;
      abortSignal?: AbortSignal;
    },
  ) {
    this.config = config;
    this.domain = (config as any).domain || '';
    this.useHeuristics = options?.useHeuristics !== false;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.progressCallback = options?.onProgress;
    this.abortSignal = options?.abortSignal;

    this.allowlist = compileRegexList((config as any).allowlist_patterns || []);
    this.blocklist = [
      ...getBuiltinBlocklist(),
      ...compileRegexList((config as any).blocklist_patterns || []),
    ];

    const pp = (config as any).pagination_pattern;
    this.paginationPattern = pp ? compileRegex(pp) : null;

    this.listingIndicators = (config as any).listing_page_indicators || [];
    this.detailIndicators = (config as any).detail_page_indicators || [];
    this.categoryPatterns = compileRegexList((config as any).category_patterns || []);
    this.linkSelectors = (config as any).link_selectors || ['a[href]'];
    this.maxListing = (config as any).max_listing_pages || 200;
    this.maxDetail = (config as any).max_detail_pages || 5000;
  }

  private matchesAllowlist(url: string): boolean {
    if (this.allowlist.length === 0) return true;
    return this.allowlist.some(re => re.test(url));
  }

  private matchesBlocklist(url: string): boolean {
    return this.blocklist.some(re => re.test(url));
  }

  private isListingPage(url: string): boolean {
    return this.listingIndicators.some(ind => {
      try { return new RegExp(ind, 'i').test(url); } catch { return false; }
    });
  }

  private isDetailPage(url: string): boolean {
    return this.detailIndicators.some(ind => {
      try { return new RegExp(ind, 'i').test(url); } catch { return false; }
    });
  }

  private isCategoryPage(url: string): boolean {
    if (this.categoryPatterns.some(re => re.test(url))) return true;
    return CATEGORY_HEURISTICS.some(re => re.test(url));
  }

  private looksLikeDetailPage(url: string): boolean {
    return HEURISTIC_DETAIL_PATTERNS.some(re => re.test(url));
  }

  private isPaginationUrl(url: string): boolean {
    if (this.paginationPattern) return this.paginationPattern.test(url);
    return PAGINATION_HEURISTICS.some(re => re.test(url));
  }

  private shouldVisit(url: string): boolean {
    if (this.visitedUrls.has(url)) return false;
    if (!isSameDomain(url, this.domain)) return false;
    if (this.matchesBlocklist(url)) return false;

    if (this.isDetailPage(url)) {
      return this.detailCount < this.maxDetail;
    }
    if (this.isListingPage(url)) {
      return this.listingCount < this.maxListing;
    }
    if (this.isCategoryPage(url)) return true;
    if (this.isPaginationUrl(url)) return true;
    if (this.matchesAllowlist(url)) return true;

    try {
      const path = new URL(url).pathname.toLowerCase();
      if (/\.(jpg|jpeg|png|gif|pdf|css|js|xml|json|ico|woff)$/i.test(path)) return false;
    } catch { return false; }

    return true;
  }

  private shouldCollect(url: string): boolean {
    if (!isSameDomain(url, this.domain)) return false;
    if (this.matchesBlocklist(url)) return false;
    if (this.isDetailPage(url)) return true;
    if (this.matchesAllowlist(url)) return true;
    if (this.useHeuristics && this.looksLikeDetailPage(url)) return true;
    return false;
  }

  private extractLinks($: cheerio.CheerioAPI, currentUrl: string): string[] {
    const links: string[] = [];

    for (const selector of this.linkSelectors) {
      try {
        $(selector).each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          const fullUrl = normalizeUrl(href, currentUrl);
          if (!fullUrl) return;
          if (isSameDomain(fullUrl, this.domain) && !this.matchesBlocklist(fullUrl)) {
            this.allLinksSeen.add(fullUrl);
          }
          if (this.shouldVisit(fullUrl)) {
            links.push(fullUrl);
          }
        });
      } catch (e) {
        this.errors.push(`Selector error '${selector}': ${e}`);
      }
    }

    if (links.length < 5 && !this.linkSelectors.includes('a[href]')) {
      try {
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          const fullUrl = normalizeUrl(href, currentUrl);
          if (!fullUrl) return;
          if (isSameDomain(fullUrl, this.domain) && !this.matchesBlocklist(fullUrl)) {
            this.allLinksSeen.add(fullUrl);
          }
          if (this.shouldVisit(fullUrl)) {
            links.push(fullUrl);
          }
        });
      } catch (e) {
        this.errors.push(`Fallback selector error: ${e}`);
      }
    }

    return [...new Set(links)];
  }

  private prioritizeUrl(url: string): number {
    if (this.isPaginationUrl(url)) return 0;
    if (this.isCategoryPage(url)) { this.categoryUrls.add(url); return 1; }
    if (this.isListingPage(url)) return 2;
    return 3;
  }

  private async fetchPage(url: string, semaphore: Semaphore): Promise<[string, number, string | null]> {
    await semaphore.acquire();
    try {
      const delayMs = (this.opts.delayMin + Math.random() * (this.opts.delayMax - this.opts.delayMin)) * 1000;
      await sleep(delayMs);

      for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.opts.timeout);
        try {
          if (this.abortSignal?.aborted) {
            return [url, 0, null];
          }

          const response = await fetch(url, {
            headers: {
              'User-Agent': randomUserAgent(),
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            },
            redirect: 'follow',
            signal: controller.signal,
          });

          if (response.status === 429) {
            const waitTime = (attempt + 1) * 2000;
            await sleep(waitTime);
            continue;
          }

          const html = response.status === 200 ? await response.text() : null;
          return [url, response.status, html];
        } catch (e) {
          if (attempt < this.opts.maxRetries) {
            await sleep(1000);
            continue;
          }
          return [url, 0, null];
        } finally {
          clearTimeout(timeout);
        }
      }
      return [url, 429, null];
    } finally {
      semaphore.release();
    }
  }

  private processPageResult(url: string, status: number, html: string | null): string[] {
    if (status !== 200 || !html) {
      if (status > 0) this.errors.push(`HTTP ${status}: ${url}`);
      return [];
    }

    this.visitedUrls.add(url);

    if (this.isListingPage(url)) this.listingCount++;
    else if (this.isDetailPage(url)) this.detailCount++;

    if (this.shouldCollect(url)) this.collectedUrls.add(url);

    const $ = cheerio.load(html);
    return this.extractLinks($, url);
  }

  async crawlWithFetch(startUrl: string, maxPages: number): Promise<CrawlResult> {
    const semaphore = new Semaphore(this.opts.concurrentRequests);
    const queue: string[] = [startUrl];
    const pending = new Set<string>([startUrl]);

    while ((queue.length > 0 || pending.size > 0) && this.visitedUrls.size < maxPages) {
      if (this.abortSignal?.aborted) break;

      const batchSize = Math.min(
        this.opts.concurrentRequests,
        maxPages - this.visitedUrls.size,
        queue.length,
      );

      if (batchSize === 0) {
        if (pending.size > 0) {
          await sleep(100);
          continue;
        }
        break;
      }

      const batchUrls: string[] = [];
      for (let i = 0; i < batchSize; i++) {
        if (queue.length === 0) break;
        const url = queue.shift()!;
        if (!this.visitedUrls.has(url)) batchUrls.push(url);
      }

      if (batchUrls.length === 0) continue;

      const tasks = batchUrls.map(url => this.fetchPage(url, semaphore));
      const results = await Promise.allSettled(tasks);

      const newLinksAll: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const batchUrl = batchUrls[i];
        pending.delete(batchUrl);
        if (result.status === 'rejected') continue;
        const [url, status, html] = result.value;
        const newLinks = this.processPageResult(url, status, html);
        newLinksAll.push(...newLinks);
      }

      for (const link of newLinksAll) {
        if (this.visitedUrls.has(link) || pending.has(link)) continue;
        pending.add(link);
        const priority = this.prioritizeUrl(link);
        if (priority === 0) {
          queue.unshift(link);
        } else if (priority <= 2) {
          const insertPos = Math.min(queue.length, priority * 5);
          queue.splice(insertPos, 0, link);
        } else {
          queue.push(link);
        }
      }

      if (this.progressCallback) {
        const progress = Math.min(99, Math.round((this.visitedUrls.size / maxPages) * 100));
        this.progressCallback(
          progress,
          `Processando... ${this.visitedUrls.size} páginas visitadas, ${this.collectedUrls.size} URLs coletadas`,
        );
      }
    }

    return this.buildResult();
  }

  async crawlWithPlaywright(startUrl: string, maxPages: number): Promise<CrawlResult> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    const urlsToVisit: string[] = [startUrl];

    try {
      while (urlsToVisit.length > 0 && this.visitedUrls.size < maxPages) {
        if (this.abortSignal?.aborted) break;

        const currentUrl = urlsToVisit.shift()!;
        if (this.visitedUrls.has(currentUrl)) continue;

        try {
          await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 45000 });

          const htmlCheck = await page.content();
          const cfIndicators = [
            'Just a moment', 'Checking your browser', 'cf-browser-verification',
            'challenge-platform', 'Attention Required', 'Access denied',
          ];
          if (cfIndicators.some(ind => htmlCheck.includes(ind))) {
            await sleep(10000);
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
          }

          await sleep(1000);

          const html = await page.content();
          this.visitedUrls.add(currentUrl);

          if (this.isListingPage(currentUrl)) this.listingCount++;
          else if (this.isDetailPage(currentUrl)) this.detailCount++;

          if (this.shouldCollect(currentUrl)) this.collectedUrls.add(currentUrl);

          const $ = cheerio.load(html);
          const newLinks = this.extractLinks($, currentUrl);

          for (const link of newLinks) {
            if (!this.visitedUrls.has(link) && !urlsToVisit.includes(link)) {
              if (this.isPaginationUrl(link)) {
                urlsToVisit.unshift(link);
              } else if (this.isCategoryPage(link)) {
                this.categoryUrls.add(link);
                urlsToVisit.splice(Math.min(urlsToVisit.length, 3), 0, link);
              } else if (this.isListingPage(link)) {
                urlsToVisit.splice(Math.min(urlsToVisit.length, 10), 0, link);
              } else {
                urlsToVisit.push(link);
              }
            }
          }

          if (this.progressCallback) {
            const progress = Math.min(99, Math.round((this.visitedUrls.size / maxPages) * 100));
            this.progressCallback(
              progress,
              `Processando... ${this.visitedUrls.size} páginas visitadas, ${this.collectedUrls.size} URLs coletadas`,
            );
          }
        } catch (e) {
          this.errors.push(`Error crawling ${currentUrl}: ${e}`);
          continue;
        }
      }
    } finally {
      await browser.close();
    }

    return this.buildResult();
  }

  private applyHeuristicCollection(): void {
    const heuristicUrls = new Set<string>();

    for (const url of this.allLinksSeen) {
      if (this.looksLikeDetailPage(url)) heuristicUrls.add(url);
    }
    for (const url of this.visitedUrls) {
      if (this.looksLikeDetailPage(url) && !this.matchesBlocklist(url)) {
        heuristicUrls.add(url);
      }
    }

    if (heuristicUrls.size > 0) {
      this.collectedUrls = heuristicUrls;
      this.detailCount = heuristicUrls.size;
      console.log(`[Crawler] Heurística encontrou ${heuristicUrls.size} URLs de detalhe`);
    }
  }

  private buildResult(): CrawlResult {
    if (
      (this.collectedUrls.size === 0 || (this.detailCount === 0 && this.collectedUrls.size < 5))
      && this.visitedUrls.size > 0
    ) {
      console.log('[Crawler] Padrões insuficientes. Aplicando heurística...');
      this.applyHeuristicCollection();
    }

    return {
      success: true,
      urls_found: [...this.collectedUrls],
      total_urls: this.collectedUrls.size,
      pages_processed: this.visitedUrls.size,
      categories_found: this.categoryUrls.size,
      listing_pages: this.listingCount,
      detail_pages: this.detailCount,
      errors: this.errors.slice(0, 20),
      config_used: {
        domain: this.domain,
        allowlist_patterns: (this.config as any).allowlist_patterns || [],
        blocklist_patterns: ((this.config as any).blocklist_patterns || []).slice(0, 5),
      },
    };
  }

  async crawl(startUrl: string, maxPages = 100, usePlaywright = false): Promise<CrawlResult> {
    if (usePlaywright) {
      try {
        return await this.crawlWithPlaywright(startUrl, maxPages);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Executable doesn't exist") || msg.toLowerCase().includes('playwright')) {
          console.warn('[Crawler] Playwright não disponível, usando fetch:', msg.slice(0, 100));
          const result = await this.crawlWithFetch(startUrl, maxPages);
          result.warnings = ['Navegador não disponível. Usando fetch.'];
          return result;
        }
        throw e;
      }
    }

    const result = await this.crawlWithFetch(startUrl, maxPages);

    if (result.pages_processed < 3 && result.urls_found.length === 0) {
      console.log('[Crawler] Resultados insuficientes, tentando Playwright...');
      try {
        this.visitedUrls.clear();
        this.collectedUrls.clear();
        this.listingCount = 0;
        this.detailCount = 0;
        this.errors = [];
        return await this.crawlWithPlaywright(startUrl, maxPages);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Executable doesn't exist") || msg.toLowerCase().includes('playwright')) {
          console.warn('[Crawler] Navegador não disponível:', msg.slice(0, 100));
          result.warnings = ['Navegador não disponível. Resultados podem ser limitados para sites com JavaScript.'];
          return result;
        }
        throw e;
      }
    }

    return result;
  }
}
