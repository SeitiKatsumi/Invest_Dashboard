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
  const extendedFields = `${baseFields},scraping_error,scraping_error_analysis`;

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
  return result.data || [];
}
