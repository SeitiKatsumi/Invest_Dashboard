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

export async function getSitesWithConfig() {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const url = new URL(`${DIRECTUS_URL}/items/input_library_url`);
  url.searchParams.set("limit", "-1");
  url.searchParams.set("fields", "id,nome_site,url_site,url_listagem,liga_desliga,status,scraping_config");
  url.searchParams.set("sort", "nome_site");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch sites: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.data || [];
}
