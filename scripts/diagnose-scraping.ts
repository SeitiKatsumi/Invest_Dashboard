import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DeterministicCrawler } from '../server/internal-scraper/index.js';
import type { ScrapingConfig } from '../server/internal-scraper/types.js';
import { browserPool } from '../server/internal-scraper/browser-pool.js';
import { previewAuctionPageExtraction } from '../server/auction-extractor.js';

type SiteRow = {
  id: number;
  nome_site: string | null;
  url_site: string | null;
  url_listagem: string | null;
  liga_desliga: string | null;
  scraping_config: string | Record<string, unknown> | null;
  last_scraping_at: string | null;
  last_scraping_urls_found: number | null;
  scraping_config_locked?: boolean | number | string | null;
  scraping_config_source?: string | null;
  scraping_config_verified_at?: string | null;
};

type PreviewResult = Awaited<ReturnType<typeof previewAuctionPageExtraction>>;

type DiagnosisStatus =
  | 'ok'
  | 'no_config'
  | 'no_start_url'
  | 'invalid_config'
  | 'no_urls'
  | 'no_valid_preview'
  | 'crawl_error'
  | 'preview_error';

type SiteDiagnosis = {
  siteId: number;
  name: string;
  startUrl: string | null;
  status: DiagnosisStatus;
  urlsFound: number;
  pagesProcessed: number;
  lastScrapingUrlsFound: number | null;
  lastScrapingAt: string | null;
  configSource: string | null;
  configVerifiedAt: string | null;
  sampleUrls: string[];
  validPreviewUrl: string | null;
  validPreviewTitle: string | null;
  previewAttempts: Array<{
    url: string;
    outcome: PreviewResult['outcome'] | 'error';
    message: string;
  }>;
  errors: string[];
  elapsedMs: number;
};

const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();

function usage(): string {
  return [
    'Uso: npm run diagnose:scraping -- [opcoes]',
    '',
    'Opcoes:',
    '  --limit <n>              Quantidade de sites grandes a testar (padrao: 20)',
    '  --max-pages <n>          Paginas maximas por site (padrao: 8)',
    '  --preview-attempts <n>   URLs por site testadas na extracao IA (padrao: 8)',
    '  --site-ids <ids>         Lista separada por virgula para testar sites especificos',
    '  --include-mgl            Inclui MGL no lote automatico',
    '  --no-preview             Roda apenas discovery de URLs, sem OpenAI',
    '  --timeout-ms <n>         Timeout por site (padrao: 120000)',
    '  --output <path>          Salva o relatorio JSON no caminho informado',
  ].join('\n');
}

function getArg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function getNumberArg(name: string, fallback: number, min = 1): number {
  const value = Number(getArg(name));
  return Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
}

function getBooleanArg(name: string): boolean {
  return process.argv.includes(name);
}

function parseSiteIds(): number[] {
  const raw = getArg('--site-ids');
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function requireDirectus(): void {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error('DIRECTUS_URL e DIRECTUS_TOKEN precisam estar configurados.');
  }
}

async function directusItems<T>(
  collection: string,
  params: Record<string, string | number> = {},
): Promise<T[]> {
  requireDirectus();

  const url = new URL(`${DIRECTUS_URL}/items/${collection}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Directus ${response.status}: ${body.slice(0, 500)}`);
  }

  const result = await response.json();
  return result.data || [];
}

function asObjectConfig(value: SiteRow['scraping_config']): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return value;
}

function getStartUrl(site: SiteRow, config: Record<string, unknown> | null): string | null {
  const listingUrl = typeof site.url_listagem === 'string' ? site.url_listagem.trim() : '';
  if (listingUrl) return listingUrl;

  const configListing = typeof config?.listing_url === 'string' ? config.listing_url.trim() : '';
  if (configListing) return configListing;

  const siteUrl = typeof site.url_site === 'string' ? site.url_site.trim() : '';
  return siteUrl || null;
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isMgl(site: SiteRow): boolean {
  const text = `${site.nome_site || ''} ${site.url_site || ''} ${site.url_listagem || ''}`.toLowerCase();
  return text.includes('mgl.com.br') || text.includes('mgl');
}

function siteName(site: SiteRow): string {
  return site.nome_site || `Site #${site.id}`;
}

async function fetchCandidateSites(options: {
  limit: number;
  siteIds: number[];
  includeMgl: boolean;
}): Promise<SiteRow[]> {
  const fields = [
    'id',
    'nome_site',
    'url_site',
    'url_listagem',
    'liga_desliga',
    'scraping_config',
    'last_scraping_at',
    'last_scraping_urls_found',
    'scraping_config_locked',
    'scraping_config_source',
    'scraping_config_verified_at',
  ].join(',');

  const sites = await directusItems<SiteRow>('input_library_url', {
    limit: -1,
    fields,
    sort: '-last_scraping_urls_found',
  });

  let candidates = sites.filter((site) => site.liga_desliga === 'ligado');

  if (options.siteIds.length > 0) {
    const ids = new Set(options.siteIds);
    candidates = candidates.filter((site) => ids.has(site.id));
  } else {
    candidates = candidates
      .filter((site) => options.includeMgl || !isMgl(site))
      .filter((site) => Boolean(site.scraping_config))
      .sort((a, b) => (b.last_scraping_urls_found || 0) - (a.last_scraping_urls_found || 0))
      .slice(0, options.limit);
  }

  return candidates;
}

async function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timeout de ${timeoutMs}ms excedido`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promiseFactory(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function previewTitle(preview: Record<string, unknown> | undefined): string | null {
  const value = preview?.nome_do_anuncio || preview?.titulo || preview?.title;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pickPreviewUrls(urls: string[], attempts: number): string[] {
  if (attempts <= 0) return [];

  const picked = new Set<string>();
  const add = (url: string | undefined) => {
    if (url) picked.add(url);
  };

  const realEstateWords = /(im[oó]vel|apartamento|casa|terreno|fazenda|rural|sitio|s[ií]tio|galp[aã]o|sala|pr[eé]dio|comercial|residencial|loteamento)/i;

  for (const url of urls.filter((candidate) => realEstateWords.test(candidate))) {
    add(url);
    if (picked.size >= attempts) return Array.from(picked);
  }

  add(urls[0]);
  add(urls[1]);
  add(urls[2]);

  if (urls.length > attempts) {
    const slots = Math.max(1, attempts - picked.size);
    for (let index = 1; index <= slots; index++) {
      const position = Math.floor((urls.length - 1) * (index / (slots + 1)));
      add(urls[position]);
      if (picked.size >= attempts) break;
    }
  }

  for (const url of urls) {
    add(url);
    if (picked.size >= attempts) break;
  }

  return Array.from(picked).slice(0, attempts);
}

async function diagnoseSite(site: SiteRow, options: {
  maxPages: number;
  previewAttempts: number;
  runPreview: boolean;
  timeoutMs: number;
}): Promise<SiteDiagnosis> {
  const started = Date.now();
  const config = asObjectConfig(site.scraping_config);
  const startUrl = getStartUrl(site, config);
  const base: SiteDiagnosis = {
    siteId: site.id,
    name: siteName(site),
    startUrl,
    status: 'ok',
    urlsFound: 0,
    pagesProcessed: 0,
    lastScrapingUrlsFound: site.last_scraping_urls_found ?? null,
    lastScrapingAt: site.last_scraping_at ?? null,
    configSource: site.scraping_config_source || null,
    configVerifiedAt: site.scraping_config_verified_at || null,
    sampleUrls: [],
    validPreviewUrl: null,
    validPreviewTitle: null,
    previewAttempts: [],
    errors: [],
    elapsedMs: 0,
  };

  if (!config) {
    return { ...base, status: 'no_config', elapsedMs: Date.now() - started };
  }
  if (!startUrl) {
    return { ...base, status: 'no_start_url', elapsedMs: Date.now() - started };
  }

  try {
    const result = await withTimeout(async (signal) => {
      const crawler = new DeterministicCrawler(config as ScrapingConfig, {
        concurrentRequests: 3,
        timeout: 30_000,
        maxRetries: 1,
        abortSignal: signal,
      });
      return crawler.crawl(startUrl, options.maxPages, true);
    }, options.timeoutMs);

    base.urlsFound = result.total_urls;
    base.pagesProcessed = result.pages_processed;
    base.sampleUrls = result.urls_found.slice(0, 10);
    base.errors.push(...result.errors.slice(0, 5));

    if (result.total_urls === 0) {
      return { ...base, status: 'no_urls', elapsedMs: Date.now() - started };
    }

    if (!options.runPreview || options.previewAttempts <= 0) {
      return { ...base, status: 'ok', elapsedMs: Date.now() - started };
    }

    const urlsToPreview = pickPreviewUrls(result.urls_found, options.previewAttempts);
    for (const url of urlsToPreview) {
      try {
        const preview = await previewAuctionPageExtraction(url, site.id);
        base.previewAttempts.push({
          url: preview.url,
          outcome: preview.outcome,
          message: preview.message,
        });

        if (preview.outcome === 'would_create') {
          base.validPreviewUrl = preview.url;
          base.validPreviewTitle = previewTitle(preview.preview);
          return { ...base, status: 'ok', elapsedMs: Date.now() - started };
        }
      } catch (error) {
        base.previewAttempts.push({
          url,
          outcome: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { ...base, status: 'no_valid_preview', elapsedMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: DiagnosisStatus = message.includes('JSON') ? 'invalid_config' : 'crawl_error';
    return {
      ...base,
      status,
      errors: [message],
      elapsedMs: Date.now() - started,
    };
  }
}

function statusIcon(status: DiagnosisStatus): string {
  if (status === 'ok') return 'OK';
  if (status === 'no_urls' || status === 'no_valid_preview') return 'WARN';
  return 'FAIL';
}

function printSummary(results: SiteDiagnosis[]): void {
  const counts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  console.log('\nResumo:');
  console.table(counts);

  console.log('\nSites:');
  console.table(results.map((result) => ({
    id: result.siteId,
    site: result.name.slice(0, 36),
    status: `${statusIcon(result.status)} ${result.status}`,
    urls: result.urlsFound,
    pages: result.pagesProcessed,
    preview: result.validPreviewUrl ? 'ok' : '-',
    elapsed_s: Math.round(result.elapsedMs / 1000),
  })));

  const attention = results.filter((result) => result.status !== 'ok');
  if (attention.length > 0) {
    console.log('\nPrecisam de atencao:');
    for (const result of attention) {
      const reason = result.previewAttempts[0]?.message || result.errors[0] || result.status;
      console.log(`- #${result.siteId} ${result.name}: ${result.status} (${reason})`);
    }
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const options = {
    limit: getNumberArg('--limit', 20),
    maxPages: getNumberArg('--max-pages', 8),
    previewAttempts: getNumberArg('--preview-attempts', 8, 0),
    siteIds: parseSiteIds(),
    includeMgl: getBooleanArg('--include-mgl'),
    runPreview: !getBooleanArg('--no-preview'),
    timeoutMs: getNumberArg('--timeout-ms', 120_000, 10_000),
    output: getArg('--output'),
  };

  if (options.runPreview && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY precisa estar configurada para rodar previews de extracao IA.');
  }

  const sites = await fetchCandidateSites(options);
  if (sites.length === 0) {
    console.log('Nenhum site candidato encontrado.');
    return;
  }

  console.log(`Diagnostico de scraping: ${sites.length} site(s), maxPages=${options.maxPages}, preview=${options.runPreview ? options.previewAttempts : 0}`);

  const results: SiteDiagnosis[] = [];
  for (const site of sites) {
    console.log(`\n[#${site.id}] ${siteName(site)}`);
    const result = await diagnoseSite(site, options);
    results.push(result);
    await browserPool.drainAll().catch(() => {});
    console.log(`${statusIcon(result.status)} ${result.status}: ${result.urlsFound} URL(s), ${result.pagesProcessed} pagina(s), ${Math.round(result.elapsedMs / 1000)}s`);
    if (result.validPreviewTitle) {
      console.log(`Preview OK: ${result.validPreviewTitle}`);
    }
  }

  printSummary(results);

  if (options.output) {
    const outputPath = resolve(options.output);
    const outputDir = dirname(outputPath);
    if (outputDir && !existsSync(outputDir)) {
      throw new Error(`Diretorio de output nao existe: ${outputDir}`);
    }
    await writeFile(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      options,
      results,
    }, null, 2));
    console.log(`\nRelatorio salvo em ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await browserPool.drainAll().catch(() => {});
});
