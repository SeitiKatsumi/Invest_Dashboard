import {
  explore,
  analyzeAndGenerateConfig,
  DeterministicCrawler,
  jobManager,
} from './internal-scraper/index.js';
import type { ScrapingConfig } from './internal-scraper/types.js';
import { browserPool } from './internal-scraper/browser-pool.js';
import { scoreConfig } from './internal-scraper/config-scorer.js';
import { getOpenAIApiKey, isOpenAIKeyConfigured } from './openai-usage.js';

const SCRAPING_API_URL = process.env.SCRAPING_API_URL?.trim() || "https://api-scrap-invest.server04.11mind.com.br";
const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();
const N8N_WEBHOOK_URL = "https://n8n-invest.server04.11mind.com.br/webhook/retornascrapapi";

async function scrapingApiFetch(endpoint: string, options?: RequestInit) {
  const url = `${SCRAPING_API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Scraping API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function getScrapingApiStatus() {
  return scrapingApiFetch("/api/status");
}

export async function startOnboarding(siteUrl: string, openaiApiKey: string, maxPages?: number, model?: string) {
  return scrapingApiFetch("/api/onboard", {
    method: "POST",
    body: JSON.stringify({
      url: siteUrl,
      openai_api_key: openaiApiKey,
      model: model || "gpt-4o-mini",
      max_pages_to_explore: maxPages || 30,
      target_description: "links de imóveis ou propriedades",
    }),
  });
}

export async function startScraping(
  siteUrl: string,
  config: Record<string, unknown>,
  maxPages?: number,
  concurrentRequests?: number
) {
  return scrapingApiFetch("/api/scrape", {
    method: "POST",
    body: JSON.stringify({
      url: siteUrl,
      config,
      max_pages: maxPages || 100,
      output_format: "json",
      target_description: "links de imóveis ou propriedades",
      use_heuristics: true,
      callback_url: N8N_WEBHOOK_URL,
      concurrent_requests: concurrentRequests || 10,
    }),
  });
}

export async function getJobs(limit?: number) {
  return scrapingApiFetch(`/api/jobs?limit=${limit || 50}`);
}

export async function getJob(jobId: string) {
  return scrapingApiFetch(`/api/jobs/${jobId}`);
}

export async function deleteJob(jobId: string) {
  return scrapingApiFetch(`/api/jobs/${jobId}`, { method: "DELETE" });
}

export async function getConfigs() {
  return scrapingApiFetch("/api/configs");
}

export async function getConfig(configId: string) {
  return scrapingApiFetch(`/api/configs/${configId}`);
}

export async function deleteConfig(configId: string) {
  return scrapingApiFetch(`/api/configs/${configId}`, { method: "DELETE" });
}

export type ErrorCategory = 'cloudflare' | 'timeout' | 'access_denied' | 'config_invalid' | 'spa_dynamic_content' | 'empty_result' | 'ok' | 'unknown';

export function classifyScrapingError(site: {
  scraping_config?: string | Record<string, unknown> | null;
  scraping_error?: string | null;
  scraping_error_analysis?: string | null;
}): ErrorCategory {
  const cfg = typeof site.scraping_config === 'string'
    ? (() => { try { return JSON.parse(site.scraping_config); } catch { return null; } })()
    : site.scraping_config;

  const validationStatus = cfg?.validation_status as string | undefined;
  const isAccessBlocked = validationStatus === 'not_validated_access_blocked';
  const isSpaValidation = validationStatus === 'not_validated_spa_dynamic_content';

  const error = (site.scraping_error || '').toLowerCase();
  const analysis = (site.scraping_error_analysis || '').toLowerCase();
  const combined = `${error} ${analysis}`;

  const hasSignal = !!(site.scraping_error || isAccessBlocked || isSpaValidation);
  if (!hasSignal) return 'ok';

  if (isSpaValidation) return 'spa_dynamic_content';
  if (/cloudflare|captcha|challenge/i.test(combined)) return 'cloudflare';
  if (/timeout|timed out|expirou|abort/i.test(combined)) return 'timeout';
  if (/403|blocked|denied|forbidden|access denied/i.test(combined)) return 'access_denied';
  if (/config invalidada|config inválida|mini-scrape.*config/i.test(combined)) return 'config_invalid';
  if (/spa.?dynamic|conteúdo dinâmico|firebase|vlance|spa detectad/i.test(combined)) return 'spa_dynamic_content';
  if (/sem resultado|empty|0 urls|retornou 0|encontrou 0/i.test(combined)) return 'empty_result';

  if (isAccessBlocked) return 'access_denied';

  return 'unknown';
}

export async function saveSiteScrapingConfig(siteId: number, config: Record<string, unknown>) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scraping_config: JSON.stringify(config),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to save scraping config: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function saveSiteScrapingError(siteId: number, error: string, analysis: string | null) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scraping_error: error,
      scraping_error_analysis: analysis || null,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.warn(`Could not save scraping error to Directus (fields may not exist yet): ${response.status} - ${err}`);
    return null;
  }

  return response.json();
}

export async function clearSiteScrapingError(siteId: number) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    return null;
  }

  try {
    const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scraping_error: null,
        scraping_error_analysis: null,
      }),
    });

    if (!response.ok) {
      console.warn(`Could not clear scraping error in Directus (fields may not exist yet): ${response.status}`);
      return null;
    }

    return response.json();
  } catch (e) {
    console.warn("Could not clear scraping error:", e);
    return null;
  }
}

export async function updateSiteScrapingStats(siteId: number, lastScrapingAt: string, urlsFound: number) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      last_scraping_at: lastScrapingAt,
      last_scraping_urls_found: urlsFound,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update scraping stats: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function updateSiteName(siteId: number, nomeSite: string) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      nome_site: nomeSite,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update site name: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function getAuctionCountsBySite(): Promise<Record<number, number>> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
  url.searchParams.set("aggregate[count]", "id");
  url.searchParams.set("groupBy[]", "site");
  url.searchParams.set("filter[status][_eq]", "published");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch auction counts: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const counts: Record<number, number> = {};
  for (const row of result.data || []) {
    if (row.site != null) {
      counts[row.site] = parseInt(row.count?.id || row.count || "0", 10);
    }
  }
  return counts;
}

export async function updateSiteListingUrl(siteId: number, urlListagem: string) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url_listagem: urlListagem,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update listing URL: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function updateSiteStatus(siteId: number, ligaDesliga: "ligado" | "desligado") {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      liga_desliga: ligaDesliga,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update site status: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function bulkUpdateSiteStatus(siteIds: number[], ligaDesliga: "ligado" | "desligado") {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  if (!siteIds || siteIds.length === 0) {
    throw new Error("At least one site ID is required");
  }

  const maxConcurrency = 10;
  const updatePromises: Promise<{ siteId: number; status: "fulfilled" | "rejected"; result?: unknown; error?: string }>[] = [];
  
  for (let i = 0; i < siteIds.length; i++) {
    // Control concurrency by waiting for previous batch if we reach max
    if (i >= maxConcurrency) {
      await Promise.race(updatePromises.slice(i - maxConcurrency, i));
    }

    const siteId = siteIds[i];
    const promise = updateSiteStatus(siteId, ligaDesliga)
      .then(() => ({ siteId, status: "fulfilled" as const }))
      .catch((error) => ({
        siteId,
        status: "rejected" as const,
        error: error instanceof Error ? error.message : "Unknown error",
      }));

    updatePromises.push(promise);
  }

  // Wait for all remaining promises to settle
  const results = await Promise.allSettled(updatePromises);

  const processed = results.map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      return {
        siteId: -1,
        status: "rejected" as const,
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
      };
    }
  });

  const succeeded = processed.filter((r) => r.status === "fulfilled").length;
  const failed = processed.filter((r) => r.status === "rejected").length;

  return {
    total: siteIds.length,
    succeeded,
    failed,
    results: processed,
  };
}

export async function getSitesWithConfig() {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const baseFields = "id,nome_site,url_site,url_listagem,liga_desliga,status,scraping_config,last_scraping_at,last_scraping_urls_found";
  const extendedFields = `${baseFields},scraping_error,scraping_error_analysis,scraping_engine`;

  const url = new URL(`${DIRECTUS_URL}/items/input_library_url`);
  url.searchParams.set("limit", "-1");
  url.searchParams.set("fields", extendedFields);
  url.searchParams.set("sort", "nome_site");

  let response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    url.searchParams.set("fields", baseFields);
    response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch sites: ${response.status} - ${error}`);
    }
  }

  const result = await response.json();
  const sites = result.data || [];
  return sites.map((site: Record<string, unknown>) => ({
    ...site,
    scraping_engine: site.scraping_engine || "internal",
  }));
}

export async function updateSiteEngine(siteId: number, engine: "external" | "internal") {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/input_library_url/${siteId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scraping_engine: engine }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update scraping_engine in Directus: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function getSiteErrorContext(siteId: number): Promise<{
  scraping_error?: string;
  scraping_error_analysis?: string;
  previous_config?: Record<string, unknown>;
} | null> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) return null;

  try {
    const siteUrl = new URL(`${DIRECTUS_URL}/items/input_library_url/${siteId}`);
    siteUrl.searchParams.set("fields", "scraping_error,scraping_error_analysis,scraping_config");

    const siteResponse = await fetch(siteUrl.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const context: Record<string, unknown> = {};

    if (siteResponse.ok) {
      const result = await siteResponse.json();
      const data = result.data;
      if (data) {
        if (data.scraping_error) context.scraping_error = data.scraping_error;
        if (data.scraping_error_analysis) context.scraping_error_analysis = data.scraping_error_analysis;
        if (data.scraping_config) {
          try {
            context.previous_config = typeof data.scraping_config === "string"
              ? JSON.parse(data.scraping_config)
              : data.scraping_config;
          } catch {}
        }
      }
    }

    try {
      const logsUrl = new URL(`${DIRECTUS_URL}/items/logs_scraping`);
      logsUrl.searchParams.set("filter[site][_eq]", String(siteId));
      logsUrl.searchParams.set("filter[status_scraping][_in]", "erro,url_inválida");
      logsUrl.searchParams.set("sort", "-date_created");
      logsUrl.searchParams.set("limit", "5");
      logsUrl.searchParams.set("fields", "motivo_do_erro,status_scraping,date_created");

      const logsResponse = await fetch(logsUrl.toString(), {
        headers: {
          Authorization: `Bearer ${DIRECTUS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      if (logsResponse.ok) {
        const logsResult = await logsResponse.json();
        const logs = logsResult.data || [];
        const errorReasons = logs
          .map((l: { motivo_do_erro?: string }) => l.motivo_do_erro)
          .filter(Boolean);
        if (errorReasons.length > 0) {
          context.scraping_error = [
            context.scraping_error,
            ...errorReasons,
          ].filter(Boolean).join("\n---\n");
        }
      }
    } catch {}

    return Object.keys(context).length > 0 ? context as {
      scraping_error?: string;
      scraping_error_analysis?: string;
      previous_config?: Record<string, unknown>;
    } : null;
  } catch {
    return null;
  }
}

export async function startInternalOnboarding(
  siteUrl: string,
  openaiApiKey: string,
  siteId?: number,
  maxPages?: number,
  model?: string,
): Promise<{
  config?: ScrapingConfig;
  error?: string;
  exploration_summary?: Record<string, unknown>;
  cloudflare_detected?: boolean;
  access_blocked?: boolean;
  access_block_reason?: string;
  exploration_links_found?: number;
  spa_detected?: boolean;
  spa_warning?: string;
  [key: string]: unknown;
}> {
  const { extractDomain } = await import('./internal-scraper/utils.js');
  const domain = extractDomain(siteUrl);

  let previousErrors: {
    scraping_error?: string;
    scraping_error_analysis?: string;
    previous_config?: Record<string, unknown>;
  } | undefined;
  if (siteId) {
    const ctx = await getSiteErrorContext(siteId);
    if (ctx) previousErrors = ctx;
  }

  const explorationResult = await explore({
    baseUrl: siteUrl,
    maxPages: maxPages || 60,
    usePlaywright: true,
  });

  const spaDetected = explorationResult.spa_detected || false;
  const detailCount = explorationResult.stats?.detailCount || 0;
  const categoryCount = explorationResult.stats?.categoryCount || 0;
  const hasCategoriesButNoDetails = categoryCount > 0 && detailCount === 0;

  if (spaDetected) {
    console.log(`[InternalOnboarding] SPA/Firebase detectado para ${domain}. Detalhes: ${detailCount}, Categorias: ${categoryCount}`);
  }
  if (hasCategoriesButNoDetails && spaDetected) {
    console.log(`[InternalOnboarding] AVISO: Encontradas ${categoryCount} categorias mas 0 URLs de detalhe — conteúdo provavelmente renderizado via JavaScript.`);
  }

  const explorationDiagnostics = {
    cloudflare_detected: explorationResult.cloudflare_detected || false,
    access_blocked: explorationResult.access_blocked || false,
    access_block_reason: explorationResult.access_block_reason,
    exploration_links_found: explorationResult.allLinksFound.length,
    spa_detected: spaDetected,
  };

  const analysisResult = await analyzeAndGenerateConfig(
    explorationResult,
    domain,
    openaiApiKey,
    {
      model: model || "gpt-4o-mini",
      targetDescription: "links de imóveis ou propriedades",
      previousErrors,
    },
  );

  if (!analysisResult.success || !analysisResult.config) {
    const isFullyBlocked = explorationDiagnostics.access_blocked || explorationDiagnostics.cloudflare_detected;

    if (isFullyBlocked) {
      console.log(`[InternalOnboarding] Exploração bloqueada para ${domain}. Gerando config tentativa baseada em padrões conhecidos.`);
      const { generateId } = await import('./internal-scraper/utils.js');
      const now = new Date().toISOString();
      const fallbackConfig: ScrapingConfig = {
        id: `${Date.now().toString(36)}${generateId(6)}`.slice(0, 12),
        domain,
        allowlist_patterns: [
          `/lote/\\d+`, `/imovel/\\d+`, `/item/\\d+`, `/produto/\\d+`,
          `/anuncio/\\d+`, `/property/\\d+`, `/listing/\\d+`,
          `/lote/[^/]+/\\d+`, `/imovel/[^/]+/\\d+`, `/item/[^/]+/\\d+`,
        ],
        blocklist_patterns: [
          '\\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2|pdf|zip)(\\?|$)',
          '(facebook|twitter|instagram|linkedin|youtube|whatsapp)\\.com',
          '(mailto:|tel:|javascript:|#)',
          '/(login|register|cart|checkout|share)(/|$)',
        ],
        pagination_pattern: '(\\?|&)(page|pagina|p)=\\d+',
        pagination_type: 'query_param',
        listing_page_indicators: ['/imoveis', '/leiloes', '/eventos', '/buscar', '/search'],
        detail_page_indicators: ['/lote/\\d+', '/imovel/\\d+', '/item/\\d+'],
        max_listing_pages: 200,
        max_detail_pages: 5000,
        link_selectors: ['a[href]'],
        category_patterns: ['/categoria/', '/eventos/', '/leilao/'],
        created_at: now,
        updated_at: now,
        analysis_notes: `Config tentativa gerada automaticamente — exploração bloqueada por ${explorationDiagnostics.cloudflare_detected ? 'Cloudflare' : 'acesso negado'}. Necessita validação manual.`,
        tokens_used: 0,
      };

      return {
        config: fallbackConfig,
        error: `Exploração bloqueada (${explorationDiagnostics.access_block_reason || 'acesso negado'}). Config tentativa gerada com padrões genéricos.`,
        exploration_summary: analysisResult.exploration_summary as Record<string, unknown> | undefined,
        ...explorationDiagnostics,
      };
    }

    return {
      error: analysisResult.error || "Análise não retornou configuração",
      exploration_summary: analysisResult.exploration_summary as Record<string, unknown> | undefined,
      ...explorationDiagnostics,
    };
  }

  const result: Record<string, unknown> = {
    config: analysisResult.config,
    exploration_summary: analysisResult.exploration_summary as Record<string, unknown> | undefined,
    ...explorationDiagnostics,
  };

  if (spaDetected && hasCategoriesButNoDetails) {
    result.spa_warning = `SPA/Firebase detectado. ${categoryCount} páginas de categoria encontradas, mas 0 URLs de detalhe de lotes. Conteúdo dinâmico pode não ter sido totalmente renderizado.`;
  }

  return result;
}

export async function startInternalScraping(
  siteUrl: string,
  config: Record<string, unknown>,
  siteId?: number,
  maxPages?: number,
  concurrentRequests?: number,
  _autoRetried?: boolean,
): Promise<{ job_id: string }> {
  const job = jobManager.createJob('scrape', siteUrl, siteId, N8N_WEBHOOK_URL);

  const configConfidence = scoreConfig(config);

  (async () => {
    try {
      jobManager.updateProgress(job.id, 5, 'Inicializando crawler...');

      const crawlerConfig: ScrapingConfig = {
        domain: "",
        listing_url: "",
        listing_selector: "",
        link_selector: "",
        pagination_type: "none",
        ...(config as Record<string, unknown>),
      } as ScrapingConfig;

      const crawler = new DeterministicCrawler(crawlerConfig, {
        concurrentRequests: concurrentRequests || 5,
        onProgress: (progress: number, message: string) => {
          jobManager.updateProgress(job.id, progress, message);
        },
      });

      const result = await crawler.crawl(siteUrl, maxPages || 100, true);

      let classification: 'success' | 'empty' | 'config_suspect' = 'success';
      if (result.total_urls === 0) {
        classification = 'empty';
      } else if (configConfidence.confidence < 30) {
        classification = 'config_suspect';
      }

      if (result.spa_detected && result.total_urls === 0 && siteId) {
        const spaErrorMsg = `SPA/Firebase detectado. Conteúdo dinâmico não renderizou URLs de detalhe. Categorias encontradas: ${result.categories_found}`;
        await saveSiteScrapingError(siteId, spaErrorMsg, `SPA detectado — vlance/Firebase. O conteúdo é carregado via JavaScript e não foi possível extrair lotes individuais.`);
        console.log(`[InternalScraping] SPA detectado para site ${siteId}: ${spaErrorMsg}`);
      }

      const shouldAutoRetry = !_autoRetried
        && siteId
        && (classification === 'empty' || classification === 'config_suspect')
        && isOpenAIKeyConfigured();

      if (shouldAutoRetry) {
        console.log(`[InternalScraping] Auto re-onboarding para site ${siteId} (${classification}, ${result.total_urls} URLs, confiança ${configConfidence.confidence}%)`);
        jobManager.updateProgress(job.id, 50, `Resultado insuficiente (${classification}). Re-executando onboarding automático...`);

        try {
          const errorMsg = classification === 'empty'
            ? `Scraping retornou 0 URLs com config atual (confiança: ${configConfidence.confidence}%)`
            : `Config suspeita (confiança: ${configConfidence.confidence}%). Apenas ${result.total_urls} URLs encontradas.`;
          await saveSiteScrapingError(siteId!, errorMsg, `Auto re-onboarding ativado. Classificação: ${classification}`);

          const reOnboardResult = await startInternalOnboarding(
            siteUrl,
            getOpenAIApiKey(),
            siteId,
            undefined,
            undefined,
          );

          if (reOnboardResult.config) {
            const newConfidence = scoreConfig(reOnboardResult.config as Record<string, unknown>);
            console.log(`[InternalScraping] Re-onboarding gerou nova config (confiança: ${newConfidence.confidence}%). Re-executando crawl...`);
            jobManager.updateProgress(job.id, 70, `Nova config gerada (confiança: ${newConfidence.confidence}%). Re-executando crawl...`);

            try {
              await saveSiteScrapingConfig(siteId!, reOnboardResult.config as Record<string, unknown>);
              await updateSiteEngine(siteId!, "internal");
              console.log(`[InternalScraping] Nova config persistida para site ${siteId}`);
            } catch (saveErr) {
              console.error(`[InternalScraping] Erro ao salvar nova config:`, saveErr);
            }

            const newCrawlerConfig: ScrapingConfig = {
              domain: "",
              listing_url: "",
              listing_selector: "",
              link_selector: "",
              pagination_type: "none",
              ...(reOnboardResult.config as Record<string, unknown>),
            } as ScrapingConfig;

            const retryCrawler = new DeterministicCrawler(newCrawlerConfig, {
              concurrentRequests: concurrentRequests || 5,
              onProgress: (progress: number, message: string) => {
                const adjustedProgress = 70 + Math.round(progress * 0.3);
                jobManager.updateProgress(job.id, adjustedProgress, message);
              },
            });

            const retryResult = await retryCrawler.crawl(siteUrl, maxPages || 100, true);

            let retryClassification: 'success' | 'empty' | 'config_suspect' = 'success';
            if (retryResult.total_urls === 0) {
              retryClassification = 'empty';
            } else if (newConfidence.confidence < 30) {
              retryClassification = 'config_suspect';
            }

            const finalResult = retryResult.total_urls > result.total_urls ? retryResult : result;
            const finalClassification = retryResult.total_urls > result.total_urls ? retryClassification : classification;
            const finalConfidence = retryResult.total_urls > result.total_urls ? newConfidence.confidence : configConfidence.confidence;

            console.log(`[InternalScraping] Auto-retry resultado: ${result.total_urls} → ${retryResult.total_urls} URLs (usando ${retryResult.total_urls > result.total_urls ? 'nova' : 'original'})`);

            jobManager.completeJob(job.id, finalResult, finalClassification, finalConfidence);

            const completedJob = jobManager.getJob(job.id);
            if (completedJob) {
              persistJobToDirectus({
                id: completedJob.id,
                type: completedJob.type,
                siteUrl: completedJob.siteUrl,
                siteId: completedJob.siteId,
                status: completedJob.status,
                resultClassification: completedJob.resultClassification,
                confidenceScore: completedJob.confidenceScore,
                totalUrls: completedJob.totalUrls,
                urlsFound: completedJob.urlsFound,
                pagesProcessed: completedJob.pagesProcessed,
                error: completedJob.error,
                result: finalResult as unknown as Record<string, unknown>,
                startedAt: completedJob.startedAt,
                completedAt: completedJob.completedAt,
                engine: 'internal',
                progressMessage: `Auto-retry: ${result.total_urls} → ${retryResult.total_urls} URLs`,
              });
            }

            if (finalResult.total_urls > 0) {
              await clearSiteScrapingError(siteId!);
            }

            if (siteId) {
              try {
                await updateSiteScrapingStats(siteId, new Date().toISOString(), finalResult.total_urls);
              } catch (e) {
                console.error(`[InternalScraping] Failed to update stats for site ${siteId}:`, e);
              }
            }
            return;
          } else {
            console.log(`[InternalScraping] Re-onboarding falhou para site ${siteId}: ${reOnboardResult.error}`);
          }
        } catch (retryErr) {
          console.error(`[InternalScraping] Erro no auto re-onboarding para site ${siteId}:`, retryErr);
        }
      }

      jobManager.completeJob(job.id, result, classification, configConfidence.confidence);

      const completedJob = jobManager.getJob(job.id);
      if (completedJob) {
        persistJobToDirectus({
          id: completedJob.id,
          type: completedJob.type,
          siteUrl: completedJob.siteUrl,
          siteId: completedJob.siteId,
          status: completedJob.status,
          resultClassification: completedJob.resultClassification,
          confidenceScore: completedJob.confidenceScore,
          totalUrls: completedJob.totalUrls,
          urlsFound: completedJob.urlsFound,
          pagesProcessed: completedJob.pagesProcessed,
          error: completedJob.error,
          result: result as unknown as Record<string, unknown>,
          startedAt: completedJob.startedAt,
          completedAt: completedJob.completedAt,
          engine: 'internal',
        });
      }

      if (siteId) {
        try {
          await updateSiteScrapingStats(siteId, new Date().toISOString(), result.total_urls);
        } catch (e) {
          console.error(`[InternalScraping] Failed to update stats for site ${siteId}:`, e);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      jobManager.failJob(job.id, msg);

      const failedJob = jobManager.getJob(job.id);
      if (failedJob) {
        persistJobToDirectus({
          id: failedJob.id,
          type: failedJob.type,
          siteUrl: failedJob.siteUrl,
          siteId: failedJob.siteId,
          status: failedJob.status,
          resultClassification: 'error',
          totalUrls: 0,
          urlsFound: [],
          pagesProcessed: 0,
          error: msg,
          startedAt: failedJob.startedAt,
          completedAt: failedJob.completedAt,
          engine: 'internal',
        });
      }
    }
  })();

  return { job_id: job.id };
}

async function persistJobToDirectus(job: {
  id: string;
  type: string;
  siteUrl: string;
  siteId?: number;
  status: string;
  resultClassification?: string;
  confidenceScore?: number;
  totalUrls: number;
  urlsFound: string[];
  pagesProcessed: number;
  error?: string;
  result?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  engine: string;
  progressMessage?: string;
  batchId?: string;
  siteName?: string;
}): Promise<void> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) return;

  try {
    const startTime = new Date(job.startedAt).getTime();
    const endTime = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
    const durationSeconds = Math.round((endTime - startTime) / 1000);

    const configUsed = job.result && typeof job.result === 'object' && 'config_used' in job.result
      ? job.result.config_used
      : null;

    const warnings = job.result && typeof job.result === 'object' && 'warnings' in job.result
      ? job.result.warnings
      : null;

    const payload = {
      job_id: job.id,
      site: job.siteId || null,
      site_url: job.siteUrl,
      site_name: job.siteName || null,
      engine: job.engine || 'internal',
      job_type: job.type || 'scrape',
      status: job.status,
      result_classification: job.resultClassification || null,
      confidence_score: job.confidenceScore || null,
      urls_found: job.totalUrls || 0,
      urls_list: job.urlsFound || [],
      pages_processed: job.pagesProcessed || 0,
      config_used: configUsed,
      error_message: job.error || null,
      warnings: warnings,
      started_at: job.startedAt,
      completed_at: job.completedAt || null,
      duration_seconds: durationSeconds,
      batch_id: job.batchId || null,
    };

    await fetch(`${DIRECTUS_URL}/items/scraping_jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[Directus] Falha ao persistir job:', e instanceof Error ? e.message : e);
  }
}

export async function persistBatchReportToDirectus(report: {
  batch_id: string;
  total_sites: number;
  total_completed: number;
  total_urls_found: number;
  by_classification: Record<string, number>;
  avg_confidence: number;
  top_errors: Array<{ error: string; count: number }>;
  sites_needing_attention: Array<Record<string, unknown>>;
  duration_seconds: number;
  engine?: string;
}): Promise<void> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) return;

  try {
    const payload = {
      batch_id: report.batch_id,
      total_sites: report.total_sites || 0,
      total_completed: report.total_completed || 0,
      total_urls_found: report.total_urls_found || 0,
      by_classification: report.by_classification || {},
      avg_confidence: report.avg_confidence || null,
      top_errors: report.top_errors || [],
      sites_needing_attention: report.sites_needing_attention || [],
      duration_seconds: report.duration_seconds || 0,
    };

    await fetch(`${DIRECTUS_URL}/items/scraping_batch_reports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[Directus] Falha ao persistir batch report:', e instanceof Error ? e.message : e);
  }
}

export function getBrowserPoolStats() {
  return browserPool.stats;
}

export async function drainBrowserPool() {
  await browserPool.drainIdle();
}

export { scoreConfig } from './internal-scraper/config-scorer.js';

export function getInternalJobs(limit?: number) {
  return jobManager.listJobs(limit || 50);
}

export function getInternalJob(jobId: string) {
  return jobManager.getJob(jobId);
}

export function deleteInternalJob(jobId: string) {
  return jobManager.deleteJob(jobId);
}
