import * as cheerio from 'cheerio';
import type {
  ExplorerOptions, ExplorationResult, PageData,
  PageStructure, LinkInfo, SampleLink, ContainerInfo, CardPattern,
} from './types.js';
import {
  normalizeUrl, extractDomain, isSameDomain, isValidPageUrl,
  randomUserAgent, sleep,
} from './utils.js';

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
  const sorted = [...patternMap.entries()].sort((a, b) => b[1].length - a[1].length);
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
    for (const [classes, count] of classCounts) {
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
  return [...patterns];
}

function extractLinkInfo($: cheerio.CheerioAPI, currentUrl: string, domain: string, allLinks: Set<string>): LinkInfo {
  const linksData: SampleLink[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
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

    allLinks.add(fullUrl);
  });

  return {
    totalLinks: linksData.length,
    sampleLinks: linksData.slice(0, 30),
    uniquePatterns: extractUrlPatterns(linksData),
  };
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status !== 200) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
  const maxDetailSamples = 10;

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

    const html = await fetchPage(currentUrl);
    if (!html) continue;

    visitedUrls.add(currentUrl);
    const $ = cheerio.load(html);

    const pageData: PageData = {
      url: currentUrl,
      type: urlType,
      structure: extractPageStructure($),
      links: extractLinkInfo($, currentUrl, domain, allLinks),
      pagination: detectPaginationPatterns($, currentUrl),
    };
    results.push(pageData);
    paginationSamples.push(...pageData.pagination);

    for (const link of allLinks) {
      if (visitedUrls.has(link) || urlsToVisit.includes(link)) continue;
      const linkType = classifyUrl(link);
      if (linkType === 'category') {
        categoryUrls.add(link);
        urlsToVisit.unshift(link);
      } else if (linkType === 'detail') {
        detailUrls.add(link);
        if (detailSamples < maxDetailSamples) urlsToVisit.push(link);
      } else {
        const insertPos = Math.min(Math.floor(urlsToVisit.length / 2), 10);
        urlsToVisit.splice(insertPos, 0, link);
      }
    }
  }

  return {
    pagesExplored: results.length,
    data: results,
    allLinksFound: [...allLinks].slice(0, 300),
    detailUrlsFound: [...detailUrls].slice(0, 100),
    categoryUrlsFound: [...categoryUrls].slice(0, 50),
    paginationSamples: [...new Set(paginationSamples)],
    stats: {
      totalLinks: allLinks.size,
      detailCount: detailUrls.size,
      categoryCount: categoryUrls.size,
    },
    usedPlaywright: false,
  };
}

async function exploreWithPlaywright(
  baseUrl: string,
  domain: string,
  maxPages: number,
): Promise<ExplorationResult> {
  const { chromium } = await import('playwright');

  const visitedUrls = new Set<string>();
  const allLinks = new Set<string>();
  const detailUrls = new Set<string>();
  const categoryUrls = new Set<string>();
  const paginationSamples: string[] = [];
  const results: PageData[] = [];

  const urlsToVisit: string[] = [baseUrl];
  let detailSamples = 0;
  const maxDetailSamples = 10;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

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
          waitUntil: 'networkidle',
          timeout: 45000,
        });

        if (response) {
          console.log(`[Explorer/Playwright] Status: ${response.status()}`);
        }

        const htmlCheck = await page.content();
        const cfIndicators = [
          'Just a moment', 'Checking your browser', 'cf-browser-verification',
          'challenge-platform', 'Attention Required', 'Access denied',
        ];
        const isBlocked = cfIndicators.some(ind => htmlCheck.includes(ind));

        if (isBlocked) {
          console.log('[Explorer/Playwright] Detectado bloqueio, aguardando...');
          await sleep(10000);
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        }

        await sleep(3000);
        visitedUrls.add(currentUrl);

        const html = await page.content();
        const $ = cheerio.load(html);

        const pageData: PageData = {
          url: currentUrl,
          type: urlType,
          structure: extractPageStructure($),
          links: extractLinkInfo($, currentUrl, domain, allLinks),
          pagination: detectPaginationPatterns($, currentUrl),
        };
        results.push(pageData);
        paginationSamples.push(...pageData.pagination);

        for (const link of allLinks) {
          if (visitedUrls.has(link) || urlsToVisit.includes(link)) continue;
          const linkType = classifyUrl(link);
          if (linkType === 'category') {
            categoryUrls.add(link);
            urlsToVisit.unshift(link);
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
    await browser.close();
  }

  return {
    pagesExplored: results.length,
    data: results,
    allLinksFound: [...allLinks].slice(0, 300),
    detailUrlsFound: [...detailUrls].slice(0, 100),
    categoryUrlsFound: [...categoryUrls].slice(0, 50),
    paginationSamples: [...new Set(paginationSamples)],
    stats: {
      totalLinks: allLinks.size,
      detailCount: detailUrls.size,
      categoryCount: categoryUrls.size,
    },
    usedPlaywright: true,
  };
}

export async function explore(options: ExplorerOptions): Promise<ExplorationResult> {
  const { baseUrl, maxPages = 30, usePlaywright = true } = options;
  const domain = extractDomain(baseUrl);

  if (usePlaywright) {
    try {
      return await exploreWithPlaywright(baseUrl, domain, maxPages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Executable doesn't exist") || msg.toLowerCase().includes('playwright')) {
        console.warn('[Explorer] Playwright não disponível, usando fetch como fallback:', msg.slice(0, 100));
        const result = await exploreWithFetch(baseUrl, domain, maxPages);
        result.warnings = ['Navegador não disponível. Usando fetch como fallback.'];
        return result;
      }
      throw e;
    }
  }

  const result = await exploreWithFetch(baseUrl, domain, maxPages);

  if (result.pagesExplored < 3 || result.allLinksFound.length < 10) {
    console.log('[Explorer] Resultados insuficientes com fetch, tentando Playwright...');
    try {
      return await exploreWithPlaywright(baseUrl, domain, maxPages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Executable doesn't exist") || msg.toLowerCase().includes('playwright')) {
        console.warn('[Explorer] Playwright não disponível:', msg.slice(0, 100));
        result.warnings = ['Navegador não disponível. Resultados podem ser limitados para sites com JavaScript.'];
        return result;
      }
      throw e;
    }
  }

  return result;
}
