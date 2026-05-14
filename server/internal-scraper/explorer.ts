import * as cheerio from 'cheerio';
import type { Page } from 'playwright';
import type {
  ExplorerOptions, ExplorationResult, PageData,
  PageStructure, LinkInfo, SampleLink, ContainerInfo, CardPattern,
} from './types.js';
import {
  normalizeUrl, extractDomain, isSameDomain, isValidPageUrl,
  randomUserAgent, sleep, STEALTH_INIT_SCRIPT, STEALTH_BROWSER_ARGS,
} from './utils.js';
import { browserPool } from './browser-pool.js';

const CATEGORY_PATTERNS = [
  /\/categoria\//i, /\/categorias\//i, /\/eventos\//i,
  /\/leilao\//i, /\/leiloes\//i, /\/imoveis\//i, /\/veiculos\//i,
  /\/buscar/i, /\/buscador/i, /\/search/i, /\/listing/i, /\/results/i,
  /\/venda\//i, /\/aluguel\//i, /\/comprar\//i, /\/alugar\//i,
  /\/t\//i, /\/properties/i, /\/auction/i,
];

const DETAIL_PATTERNS = [
  /\/lote\/\d+/i, /\/imovel\/\d+/i, /\/item\/\d+/i,
  /\/produto\/\d+/i, /\/property\/\d+/i, /\/listing\/\d+/i,
  /\/anuncio\/\d+/i, /\/detalhe\/\d+/i, /\/id\/\d+/i, /\/p\/\d+/i,
  /\/lote\/[^/]+\/\d+/i, /\/imovel\/[^/]+\/\d+/i, /\/item\/[^/]+\/\d+/i,
  /\/produto\/[^/]+\/\d+/i, /\/property\/[^/]+\/\d+/i, /\/listing\/[^/]+\/\d+/i,
  /\/anuncio\/[^/]+\/\d+/i, /\/detalhe\/[^/]+\/\d+/i,
  /\/venda\/[^/]+\/\d+/i, /\/aluguel\/[^/]+\/\d+/i,
  /\/leilao\/[^/]+\/\d+/i, /\/auction\/[^/]+\/\d+/i,
  /-\d{4,}$/, /\/\d{4,}$/, /\/\d{4,}\//,
];

const PAGINATION_SELECTORS = [
  '.pagination a', '.paging a', '.pages a',
  '[class*="pagination"] a', '[class*="pager"] a',
  'a[href*="page"]', 'a[href*="pagina"]', 'a[href*="p="]',
  '.next', '.prev', '[rel="next"]', '[rel="prev"]',
];

const CONTAINER_SELECTORS = [
  'main', 'article', '[class*="listing"]', '[class*="results"]',
  '[class*="cards"]', '[class*="grid"]', '[class*="list"]',
];

function looksLikeCategory(url: string): boolean {
  for (const pattern of CATEGORY_PATTERNS) {
    if (pattern.test(url)) {
      if (!/\/\d{3,}(\/[^/]*)?$/.test(url)) return true;
    }
  }
  return false;
}

function looksLikeDetail(url: string): boolean {
  return DETAIL_PATTERNS.some(p => p.test(url));
}

const PAGINATION_PATTERNS = [
  /[?&](page|pagina|p|offset|skip)=\d+/i,
  /\/page\/\d+/i, /\/pagina\/\d+/i, /\/p\/\d+/i,
];

function looksLikePagination(url: string): boolean {
  return PAGINATION_PATTERNS.some(p => p.test(url));
}

function classifyUrl(url: string): 'category' | 'detail' | 'pagination' | 'other' {
  if (looksLikePagination(url)) return 'pagination';
  if (looksLikeDetail(url)) return 'detail';
  if (looksLikeCategory(url)) return 'category';
  return 'other';
}

function extractUrlPatterns(links: { url: string }[]): string[] {
  const patternMap = new Map<string, string[]>();
  for (const link of links) {
    try {
      const path = new URL(link.url).pathname;
      const pattern = path.replace(/\d+/g, '{id}');
      if (!patternMap.has(pattern)) patternMap.set(pattern, []);
      patternMap.get(pattern)!.push(link.url);
    } catch { /* skip */ }
  }
  const sorted = Array.from(patternMap.entries()).sort((a, b) => b[1].length - a[1].length);
  return sorted.slice(0, 10).map(([p]) => p);
}

function extractPageStructure($: cheerio.CheerioAPI): PageStructure {
  const title = $('title').text() || '';
  const mainContainers: ContainerInfo[] = [];
  const cardPatterns: CardPattern[] = [];

  for (const selector of CONTAINER_SELECTORS) {
    try {
      $(selector).slice(0, 3).each((_, el) => {
        const $el = $(el);
        mainContainers.push({
          tag: el.type === 'tag' ? el.tagName : 'unknown',
          classes: ($el.attr('class') || '').split(/\s+/).filter(Boolean),
          id: $el.attr('id') || '',
          childrenCount: $el.children().length,
        });
      });
    } catch { /* skip */ }
  }

  for (const tag of ['li', 'article', 'div']) {
    const classCounts = new Map<string, number>();
    $(tag).each((_, el) => {
      const cls = $(el).attr('class');
      if (cls) {
        const sorted = cls.split(/\s+/).filter(Boolean).sort().join(' ');
        classCounts.set(sorted, (classCounts.get(sorted) || 0) + 1);
      }
    });
    for (const [classes, count] of Array.from(classCounts)) {
      if (count >= 3) {
        cardPatterns.push({
          tag,
          classes: classes.split(' '),
          count,
        });
      }
    }
  }

  cardPatterns.sort((a, b) => b.count - a.count);

  return { title, mainContainers, cardPatterns: cardPatterns.slice(0, 5) };
}

function detectPaginationPatterns($: cheerio.CheerioAPI, url: string): string[] {
  const patterns = new Set<string>();
  for (const selector of PAGINATION_SELECTORS) {
    try {
      $(selector).slice(0, 5).each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          const full = normalizeUrl(href, url);
          if (full) patterns.add(full);
        }
      });
    } catch { /* skip */ }
  }
  return Array.from(patterns);
}

interface LinkExtractionResult {
  info: LinkInfo;
  newLinks: string[];
}

function isPlaceholderHref(href: string): boolean {
  const trimmed = href.trim();
  return trimmed === '#' || trimmed === '' || trimmed.startsWith('javascript:') || trimmed === '#!' || /^#[a-zA-Z]/.test(trimmed);
}

function detectSpaContent(html: string): boolean {
  const lower = html.toLowerCase();
  const hasVlance = lower.includes('/vlance/') || lower.includes('vlanceconfigcontainer');
  const hasFirebase = lower.includes('firebase') && (lower.includes('container.js') || lower.includes('paginacaolotes'));
  if (hasVlance || hasFirebase) return true;

  const $ = cheerio.load(html);
  const placeholderLinks = $('a[href="#"]').length;
  const realLinks = $('a[href]').length - placeholderLinks;
  const scriptCount = $('script[src]').length;
  const emptyContainers = $('#lotes-lista:empty, #leiloes:empty, [id*="lotes"]:empty, [id*="leilao"]:empty').length;
  if (emptyContainers > 0 && scriptCount > 5 && realLinks < 10) return true;
  if (placeholderLinks > 5 && realLinks < 5 && scriptCount > 5) return true;

  return false;
}

async function waitForDynamicContentExplorer(page: Page): Promise<boolean> {
  const selectors = [
    '.link-lote[href]:not([href="#"])',
    '#lotes-lista li',
    '#leiloes li',
    '.portfolio-item a[href]:not([href="#"])',
    '[id*="lote"] a[href]:not([href="#"])',
    '.card-container a[href]:not([href="#"])',
    '.product a[href]:not([href="#"])',
  ];

  try {
    const selectorExpr = selectors.join(', ');
    await page.waitForSelector(selectorExpr, { timeout: 15000 });
    console.log(`[Explorer] Conteúdo dinâmico renderizado`);
    await sleep(2000);
    return true;
  } catch {
    return false;
  }
}

function extractLinkInfo($: cheerio.CheerioAPI, currentUrl: string, domain: string, allLinks: Set<string>): LinkExtractionResult {
  const linksData: SampleLink[] = [];
  const newLinks: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (isPlaceholderHref(href)) return;
    const fullUrl = normalizeUrl(href, currentUrl);
    if (!fullUrl || !isSameDomain(fullUrl, domain) || !isValidPageUrl(fullUrl)) return;

    const parentClasses: string[] = [];
    let parent = $(el).parent();
    for (let i = 0; i < 3; i++) {
      if (parent.length) {
        const cls = parent.attr('class');
        if (cls) parentClasses.push(...cls.split(/\s+/).filter(Boolean));
        parent = parent.parent();
      }
    }

    linksData.push({
      url: fullUrl,
      text: $(el).text().trim().slice(0, 100),
      classes: ($(el).attr('class') || '').split(/\s+/).filter(Boolean),
      parentClasses: parentClasses.slice(0, 10),
      hasImage: $(el).find('img').length > 0,
    });

    if (!allLinks.has(fullUrl)) {
      allLinks.add(fullUrl);
      newLinks.push(fullUrl);
    }
  });

  return {
    info: {
      totalLinks: linksData.length,
      sampleLinks: linksData.slice(0, 30),
      uniquePatterns: extractUrlPatterns(linksData),
    },
    newLinks,
  };
}

const CF_INDICATORS = [
  'Just a moment', 'Checking your browser', 'cf-browser-verification',
  'challenge-platform', 'Attention Required', 'Access denied',
  'Enable JavaScript and cookies to continue',
];

function detectCloudflare(html: string): boolean {
  return CF_INDICATORS.some(ind => html.includes(ind));
}

interface FetchResult {
  html: string | null;
  status: number;
  cloudflare: boolean;
  blocked: boolean;
  blockReason?: string;
}

const FETCH_STRATEGIES = [
  {
    name: 'standard',
    headers: (ua: string) => ({
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    }),
    delay: 0,
  },
  {
    name: 'with-referer',
    headers: (ua: string) => ({
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.google.com/',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    }),
    delay: 3000,
  },
  {
    name: 'delayed-retry',
    headers: (ua: string) => ({
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
    }),
    delay: 7000,
  },
];

async function fetchPageWithDiagnostics(url: string): Promise<FetchResult> {
  let cookieJar = '';

  for (let i = 0; i < FETCH_STRATEGIES.length; i++) {
    const strategy = FETCH_STRATEGIES[i];
    if (strategy.delay > 0) await sleep(strategy.delay);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const ua = randomUserAgent();
      const headers: Record<string, string> = { ...strategy.headers(ua) };
      if (cookieJar) {
        headers['Cookie'] = cookieJar;
      }

      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });

      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean);
        cookieJar = cookies.join('; ');
      }

      const status = response.status;

      if (status === 403 || status === 503) {
        const text = await response.text();
        const isCf = detectCloudflare(text);
        if (isCf) {
          console.log(`[Explorer/Fetch] Cloudflare detected on ${url} (strategy: ${strategy.name}, status: ${status})`);
          if (i < FETCH_STRATEGIES.length - 1) continue;
          return { html: null, status, cloudflare: true, blocked: true, blockReason: `Cloudflare challenge (HTTP ${status})` };
        }
        if (i < FETCH_STRATEGIES.length - 1) continue;
        return { html: null, status, cloudflare: false, blocked: true, blockReason: `HTTP ${status} - Access denied` };
      }

      if (status !== 200) {
        return { html: null, status, cloudflare: false, blocked: status === 401 || status === 407, blockReason: status >= 400 ? `HTTP ${status}` : undefined };
      }

      const text = await response.text();
      if (detectCloudflare(text)) {
        console.log(`[Explorer/Fetch] Cloudflare challenge page on ${url} (strategy: ${strategy.name})`);
        if (i < FETCH_STRATEGIES.length - 1) continue;
        return { html: null, status: 200, cloudflare: true, blocked: true, blockReason: 'Cloudflare challenge page returned with HTTP 200' };
      }

      return { html: text, status, cloudflare: false, blocked: false };
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      if (i < FETCH_STRATEGIES.length - 1) continue;
      return { html: null, status: 0, cloudflare: false, blocked: isTimeout, blockReason: isTimeout ? 'Request timeout — possible access block' : 'Network error' };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { html: null, status: 0, cloudflare: false, blocked: false };
}

async function fetchPage(url: string): Promise<string | null> {
  const result = await fetchPageWithDiagnostics(url);
  return result.html;
}

async function exploreWithFetch(
  baseUrl: string,
  domain: string,
  maxPages: number,
): Promise<ExplorationResult> {
  const visitedUrls = new Set<string>();
  const allLinks = new Set<string>();
  const detailUrls = new Set<string>();
  const categoryUrls = new Set<string>();
  const paginationSamples: string[] = [];
  const results: PageData[] = [];

  const urlsToVisit: string[] = [baseUrl];
  let detailSamples = 0;
  const maxDetailSamples = 20;
  let cloudflareDetected = false;
  let accessBlocked = false;
  let accessBlockReason: string | undefined;
  let blockedCount = 0;

  while (urlsToVisit.length > 0 && visitedUrls.size < maxPages) {
    const currentUrl = urlsToVisit.shift()!;
    if (visitedUrls.has(currentUrl)) continue;

    const urlType = classifyUrl(currentUrl);

    if (urlType === 'detail') {
      if (detailSamples >= maxDetailSamples) {
        detailUrls.add(currentUrl);
        continue;
      }
      detailSamples++;
    }

    const fetchResult = await fetchPageWithDiagnostics(currentUrl);

    if (fetchResult.cloudflare) cloudflareDetected = true;
    if (fetchResult.blocked) {
      blockedCount++;
      accessBlocked = true;
      if (!accessBlockReason) accessBlockReason = fetchResult.blockReason;
    }

    if (!fetchResult.html) continue;

    visitedUrls.add(currentUrl);
    const $ = cheerio.load(fetchResult.html);

    const { info: linkInfo, newLinks } = extractLinkInfo($, currentUrl, domain, allLinks);
    const pageData: PageData = {
      url: currentUrl,
      type: urlType,
      structure: extractPageStructure($),
      links: linkInfo,
      pagination: detectPaginationPatterns($, currentUrl),
    };
    results.push(pageData);
    paginationSamples.push(...pageData.pagination);

    for (const link of newLinks) {
      if (visitedUrls.has(link) || urlsToVisit.includes(link)) continue;
      const linkType = classifyUrl(link);
      if (linkType === 'pagination') {
        urlsToVisit.unshift(link);
      } else if (linkType === 'category') {
        categoryUrls.add(link);
        urlsToVisit.splice(Math.min(urlsToVisit.length, 2), 0, link);
      } else if (linkType === 'detail') {
        detailUrls.add(link);
        if (detailSamples < maxDetailSamples) urlsToVisit.push(link);
      } else {
        const insertPos = Math.min(Math.floor(urlsToVisit.length / 2), 10);
        urlsToVisit.splice(insertPos, 0, link);
      }
    }
  }

  if (blockedCount > 0) {
    console.log(`[Explorer/Fetch] ${blockedCount} page(s) blocked. Cloudflare: ${cloudflareDetected}. Reason: ${accessBlockReason}`);
  }

  return {
    pagesExplored: results.length,
    data: results,
    allLinksFound: Array.from(allLinks).slice(0, 500),
    detailUrlsFound: Array.from(detailUrls).slice(0, 200),
    categoryUrlsFound: Array.from(categoryUrls).slice(0, 80),
    paginationSamples: Array.from(new Set(paginationSamples)),
    stats: {
      totalLinks: allLinks.size,
      detailCount: detailUrls.size,
      categoryCount: categoryUrls.size,
    },
    usedPlaywright: false,
    cloudflare_detected: cloudflareDetected,
    access_blocked: accessBlocked,
    access_block_reason: accessBlockReason,
  };
}

async function exploreWithPlaywright(
  baseUrl: string,
  domain: string,
  maxPages: number,
): Promise<ExplorationResult> {
  const visitedUrls = new Set<string>();
  const allLinks = new Set<string>();
  const detailUrls = new Set<string>();
  const categoryUrls = new Set<string>();
  const paginationSamples: string[] = [];
  const results: PageData[] = [];

  const urlsToVisit: string[] = [baseUrl];
  let detailSamples = 0;
  const maxDetailSamples = 20;
  let cloudflareDetected = false;
  let accessBlocked = false;
  let accessBlockReason: string | undefined;
  let blockedCount = 0;
  let spaDetected = false;

  const poolHandle = await browserPool.acquire();
  const page: Page = poolHandle.page;

  try {
    while (urlsToVisit.length > 0 && visitedUrls.size < maxPages) {
      const currentUrl = urlsToVisit.shift()!;
      if (visitedUrls.has(currentUrl)) continue;

      const urlType = classifyUrl(currentUrl);
      if (urlType === 'detail') {
        if (detailSamples >= maxDetailSamples) {
          detailUrls.add(currentUrl);
          continue;
        }
        detailSamples++;
      }

      try {
        console.log(`[Explorer/Playwright] Navegando: ${currentUrl}`);
        const response = await page.goto(currentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        const responseStatus = response ? response.status() : 0;
        if (response) {
          console.log(`[Explorer/Playwright] Status: ${responseStatus}`);
        }

        if (responseStatus === 403 || responseStatus === 503) {
          blockedCount++;
          accessBlocked = true;
        }

        const htmlCheck = await page.content();
        const isBlocked = detectCloudflare(htmlCheck);

        if (isBlocked) {
          cloudflareDetected = true;
          console.log('[Explorer/Playwright] Cloudflare detectado, tentando aguardar...');

          await sleep(10000);
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

          const htmlAfterWait = await page.content();
          if (detectCloudflare(htmlAfterWait)) {
            console.log('[Explorer/Playwright] Cloudflare ainda presente após primeira espera, tentando reload...');
            await sleep(5000);
            await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
            await sleep(5000);

            const htmlAfterReload = await page.content();
            if (detectCloudflare(htmlAfterReload)) {
              blockedCount++;
              accessBlocked = true;
              if (!accessBlockReason) accessBlockReason = 'Cloudflare challenge não superado pelo Playwright';
              console.log('[Explorer/Playwright] Cloudflare não superado, pulando página');
              continue;
            }
          }
        }

        const isSpa = detectSpaContent(htmlCheck);
        if (isSpa) {
          if (!spaDetected) {
            console.log(`[Explorer/Playwright] SPA/Firebase detectado em ${currentUrl}. Aguardando conteúdo dinâmico...`);
            spaDetected = true;
          }
          await waitForDynamicContentExplorer(page);
        } else {
          await sleep(3000);
        }
        visitedUrls.add(currentUrl);

        const html = await page.content();
        const $ = cheerio.load(html);

        const { info: linkInfo, newLinks } = extractLinkInfo($, currentUrl, domain, allLinks);
        const pageData: PageData = {
          url: currentUrl,
          type: urlType,
          structure: extractPageStructure($),
          links: linkInfo,
          pagination: detectPaginationPatterns($, currentUrl),
        };
        results.push(pageData);
        paginationSamples.push(...pageData.pagination);

        for (const link of newLinks) {
          if (visitedUrls.has(link) || urlsToVisit.includes(link)) continue;
          const linkType = classifyUrl(link);
          if (linkType === 'pagination') {
            urlsToVisit.unshift(link);
          } else if (linkType === 'category') {
            categoryUrls.add(link);
            urlsToVisit.splice(Math.min(urlsToVisit.length, 2), 0, link);
          } else if (linkType === 'detail') {
            detailUrls.add(link);
            if (detailSamples < maxDetailSamples) urlsToVisit.push(link);
          } else {
            const insertPos = Math.min(Math.floor(urlsToVisit.length / 2), 10);
            urlsToVisit.splice(insertPos, 0, link);
          }
        }
      } catch (e) {
        console.error(`[Explorer/Playwright] Erro em ${currentUrl}:`, e);
        continue;
      }
    }
  } finally {
    try { await poolHandle.context.close(); } catch {}
    await browserPool.release(poolHandle.browser);
  }

  if (blockedCount > 0) {
    console.log(`[Explorer/Playwright] ${blockedCount} page(s) blocked. Cloudflare: ${cloudflareDetected}. Reason: ${accessBlockReason}`);
  }

  return {
    pagesExplored: results.length,
    data: results,
    allLinksFound: Array.from(allLinks).slice(0, 500),
    detailUrlsFound: Array.from(detailUrls).slice(0, 200),
    categoryUrlsFound: Array.from(categoryUrls).slice(0, 80),
    paginationSamples: Array.from(new Set(paginationSamples)),
    stats: {
      totalLinks: allLinks.size,
      detailCount: detailUrls.size,
      categoryCount: categoryUrls.size,
    },
    usedPlaywright: true,
    cloudflare_detected: cloudflareDetected,
    access_blocked: accessBlocked,
    access_block_reason: accessBlockReason,
    spa_detected: spaDetected,
  };
}

export async function explore(options: ExplorerOptions): Promise<ExplorationResult> {
  const { baseUrl, maxPages = 60, usePlaywright = true } = options;
  const domain = extractDomain(baseUrl);

  const isBrowserUnavailable = (msg: string) =>
    msg.includes("Executable doesn't exist") ||
    msg.toLowerCase().includes('playwright') ||
    msg.includes('BrowserPool') ||
    msg.includes('acquire timeout');

  if (usePlaywright) {
    try {
      return await exploreWithPlaywright(baseUrl, domain, maxPages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isBrowserUnavailable(msg)) {
        console.warn('[Explorer] Playwright não disponível, usando fetch como fallback:', msg.slice(0, 120));
        const result = await exploreWithFetch(baseUrl, domain, maxPages);
        result.warnings = ['Navegador não disponível. Usando fetch como fallback.'];
        return result;
      }
      throw e;
    }
  }

  const result = await exploreWithFetch(baseUrl, domain, maxPages);

  if (result.pagesExplored < 5 || result.allLinksFound.length < 15) {
    console.log('[Explorer] Resultados insuficientes com fetch, tentando Playwright...');
    try {
      return await exploreWithPlaywright(baseUrl, domain, maxPages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isBrowserUnavailable(msg)) {
        console.warn('[Explorer] Playwright não disponível:', msg.slice(0, 120));
        result.warnings = ['Navegador não disponível. Resultados podem ser limitados para sites com JavaScript.'];
        return result;
      }
      throw e;
    }
  }

  return result;
}
