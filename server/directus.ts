import { Site, Leilao, LogScraping, UrlConsulta, DashboardStats, LeilaoInsert } from "@shared/schema";

const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();

function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

interface DirectusResponse<T> {
  data: T;
  meta?: {
    total_count?: number;
    filter_count?: number;
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(500 * attempt);
    }
  }

  throw lastError;
}

async function directusFetch<T>(
  endpoint: string,
  params?: Record<string, string | number>
): Promise<DirectusResponse<T>> {
  if (!DIRECTUS_URL) {
    throw new Error("DIRECTUS_URL environment variable is not set or is empty");
  }
  if (!DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_TOKEN environment variable is not set or is empty");
  }
  if (!validateUrl(DIRECTUS_URL)) {
    throw new Error(`DIRECTUS_URL is not a valid URL: "${DIRECTUS_URL}"`);
  }

  const fullUrl = `${DIRECTUS_URL}/items/${endpoint}`;
  const url = new URL(fullUrl);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
  }

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Directus API error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function getAggregate(
  collection: string,
  aggregate: string,
  filter?: string
): Promise<number> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const url = new URL(`${DIRECTUS_URL}/items/${collection}`);
  url.searchParams.set("aggregate[count]", "*");
  if (filter) {
    url.searchParams.set("filter", filter);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    return 0;
  }

  const data = await response.json();
  return data.data?.[0]?.count || 0;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  // Fetch all data in parallel
  const [
    sitesResponse,
    leiloesResponse,
    logsResponse,
    urlConsultaResponse,
  ] = await Promise.all([
    directusFetch<Site[]>("input_library_url", { limit: -1 }),
    directusFetch<Leilao[]>("leiloes_imovel", { 
      limit: -1,
      fields: "id,status,tipo_do_imovel,estado_uf,arquivo_imagem,status_publicacao_wp,site,date_created"
    }),
    directusFetch<LogScraping[]>("logs_scraping", { 
      limit: -1,
      fields: "id,status_scraping,motivo_do_erro,site,date_created",
      sort: "-date_created"
    }),
    directusFetch<UrlConsulta[]>("url_consulta", { 
      limit: -1,
      fields: "id,status_processamento,classifica"
    }),
  ]);

  const sites = sitesResponse.data || [];
  const leiloes = leiloesResponse.data || [];
  const logs = logsResponse.data || [];
  const urlConsulta = urlConsultaResponse.data || [];

  // Process sites data
  const sitesStats = {
    total: sites.length,
    ligados: sites.filter((s) => s.liga_desliga === "ligado").length,
    desligados: sites.filter((s) => s.liga_desliga === "desligado" || !s.liga_desliga).length,
    list: sites,
  };

  // Create site name lookup
  const siteNameLookup: Record<number, string> = {};
  sites.forEach((site) => {
    siteNameLookup[site.id] = site.nome_site || `Site #${site.id}`;
  });

  // Process leiloes data
  const porTipo: Record<string, number> = {};
  const porUf: Record<string, number> = {};
  const porSite: Record<string, number> = {};
  const ativosPorSite: Record<string, number> = {};
  let comImagem = 0;
  let semImagem = 0;
  let publicados = 0;
  let naoPublicados = 0;
  let ativos = 0;

  leiloes.forEach((leilao) => {
    // Por tipo
    const tipo = leilao.tipo_do_imovel || "Outros";
    porTipo[tipo] = (porTipo[tipo] || 0) + 1;

    // Por UF
    const uf = leilao.estado_uf || "N/A";
    porUf[uf] = (porUf[uf] || 0) + 1;

    // Por site
    if (leilao.site) {
      const siteName = siteNameLookup[leilao.site] || `Site #${leilao.site}`;
      porSite[siteName] = (porSite[siteName] || 0) + 1;
    }

    // Imagem
    if (leilao.arquivo_imagem) {
      comImagem++;
    } else {
      semImagem++;
    }

    // Publicação
    if (leilao.status_publicacao_wp === "publicado") {
      publicados++;
    } else {
      naoPublicados++;
    }

    // Ativos (published no Directus)
    if (leilao.status === "published") {
      ativos++;
      const siteName = leilao.site
        ? (siteNameLookup[leilao.site] || `Site #${leilao.site}`)
        : "Sem site";
      ativosPorSite[siteName] = (ativosPorSite[siteName] || 0) + 1;
    }
  });

  const leiloesStats = {
    total: leiloes.length,
    ativos,
    comImagem,
    semImagem,
    porTipo,
    porUf,
    porSite,
    ativosPorSite,
    publicados,
    naoPublicados,
  };

  // Process logs data
  let sucesso = 0;
  let sucessoParcial = 0;
  let erro = 0;
  let urlInvalida = 0;

  logs.forEach((log) => {
    switch (log.status_scraping) {
      case "successes":
        sucesso++;
        break;
      case "successes_partial":
        sucessoParcial++;
        break;
      case "erro":
        erro++;
        break;
      case "url_inválida":
        urlInvalida++;
        break;
    }
  });

  // Get recent logs with site info
  const recentLogs = logs.slice(0, 20).map((log) => {
    if (log.site && typeof log.site === "number") {
      const siteData = sites.find((s) => s.id === log.site);
      return { ...log, site: siteData || log.site };
    }
    return log;
  });

  const logsStats = {
    total: logs.length,
    sucesso,
    sucessoParcial,
    erro,
    urlInvalida,
    recentLogs,
  };

  // Process URL consulta
  const porCategoria: Record<string, number> = {};
  urlConsulta.forEach((u) => {
    const cat = u.classifica || "não classificado";
    porCategoria[cat] = (porCategoria[cat] || 0) + 1;
  });

  // Filter only "imóvel individual" for processing status
  const imoveisIndividuais = urlConsulta.filter((u) => u.classifica === "imóvel individual");
  
  const urlConsultaStats = {
    total: urlConsulta.length,
    totalImoveisIndividuais: imoveisIndividuais.length,
    processadas: imoveisIndividuais.filter((u) => u.status_processamento === "processado").length,
    naoProcessadas: imoveisIndividuais.filter((u) => u.status_processamento === "não processado" || !u.status_processamento).length,
    comErro: imoveisIndividuais.filter((u) => u.status_processamento === "erro").length,
    porCategoria,
  };

  // Process temporal data for leilões (last 14 days)
  const leiloesTemporal: { date: string; count: number }[] = [];
  const dateCountMap: Record<string, number> = {};
  const now = new Date();
  
  // Initialize last 14 days
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    dateCountMap[dateStr] = 0;
  }
  
  // Count leilões by date_created
  leiloes.forEach((leilao) => {
    if (leilao.date_created) {
      const dateStr = new Date(leilao.date_created).toISOString().split("T")[0];
      if (dateCountMap[dateStr] !== undefined) {
        dateCountMap[dateStr]++;
      }
    }
  });
  
  // Convert to array format
  Object.entries(dateCountMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      leiloesTemporal.push({ date, count });
    });

  return {
    sites: sitesStats,
    leiloes: leiloesStats,
    logs: logsStats,
    urlConsulta: urlConsultaStats,
    leiloesTemporal,
  };
}

export async function getSites(): Promise<Site[]> {
  const response = await directusFetch<Site[]>("input_library_url", { 
    limit: -1,
    fields: "id,nome_site,url_site,url_listagem,liga_desliga,status",
    sort: "nome_site"
  });
  return response.data || [];
}

export async function findSiteByUrl(url: string): Promise<Site | null> {
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, "");
    
    const sites = await getSites();
    
    for (const site of sites) {
      if (site.url_site) {
        try {
          const siteUrl = new URL(site.url_site);
          const siteDomain = siteUrl.hostname.replace(/^www\./, "");
          if (domain.includes(siteDomain) || siteDomain.includes(domain)) {
            return site;
          }
        } catch {
          if (site.url_site.includes(domain)) {
            return site;
          }
        }
      }
      
      if (site.url_listagem) {
        try {
          const listUrl = new URL(site.url_listagem);
          const listDomain = listUrl.hostname.replace(/^www\./, "");
          if (domain.includes(listDomain) || listDomain.includes(domain)) {
            return site;
          }
        } catch {
          if (site.url_listagem.includes(domain)) {
            return site;
          }
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export function normalizeUrl(url: string): string {
  if (!url) return '';
  let normalized = url.trim().toLowerCase();
  normalized = normalized.replace(/#.*$/, '');
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.replace(/[?&](?:utm_\w+|fbclid|gclid|ref)=[^&]*/g, '');
  normalized = normalized.replace(/\?$/, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

export async function checkDuplicateLeilao(linkAnuncio: string): Promise<Leilao | null> {
  if (!linkAnuncio || !DIRECTUS_URL || !DIRECTUS_TOKEN) return null;

  const normalized = normalizeUrl(linkAnuncio);
  if (!normalized) return null;

  const domainPath = normalized.split('/')[0];
  let page = 1;
  const pageSize = 500;

  while (true) {
    const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
    url.searchParams.set('filter[link_anuncio][_contains]', domainPath);
    url.searchParams.set('fields', 'id,link_anuncio,nome_do_anuncio,site,date_created');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Falha ao verificar duplicatas no Directus (status ${response.status}). Criação bloqueada por segurança.`);
    }

    const result = await response.json();
    const items = result.data || [];

    for (const item of items) {
      if (item.link_anuncio && normalizeUrl(item.link_anuncio) === normalized) {
        return item;
      }
    }

    if (items.length < pageSize) break;
    page++;
  }

  return null;
}

export async function createLeilao(data: LeilaoInsert): Promise<Leilao> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const cleanData = {
    ...data,
    status: data.status || "published",
    praca_1: data.praca_1 && data.praca_1.trim() !== "" ? data.praca_1 : null,
    praca_2: data.praca_2 && data.praca_2.trim() !== "" ? data.praca_2 : null,
    praca_3: data.praca_3 && data.praca_3.trim() !== "" ? data.praca_3 : null,
  };

  if (cleanData.link_anuncio) {
    const existing = await checkDuplicateLeilao(cleanData.link_anuncio);
    if (existing) {
      throw new Error(`DUPLICATA: Já existe um leilão com este link (ID #${existing.id} - "${existing.nome_do_anuncio || 'Sem nome'}"). O registro não foi criado.`);
    }
    const normalized = normalizeUrl(cleanData.link_anuncio);
    if (normalized) {
      const protocol = cleanData.link_anuncio.match(/^https?:\/\//)?.[0] || 'https://';
      cleanData.link_anuncio = protocol + normalized;
    }
  }

  const response = await fetch(`${DIRECTUS_URL}/items/leiloes_imovel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cleanData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create leilao: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.data;
}

export interface DuplicateGroup {
  normalizedUrl: string;
  items: { id: number; link_anuncio: string; nome_do_anuncio: string | null; site: number | null; date_created: string | null }[];
  count: number;
  excessCount: number;
}

export async function findDuplicates(): Promise<{ groups: DuplicateGroup[]; totalDuplicates: number; totalExcess: number }> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const allItems: { id: number; link_anuncio: string; nome_do_anuncio: string | null; site: number | null; date_created: string | null }[] = [];
  let page = 1;
  const pageSize = 10000;

  while (true) {
    const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
    url.searchParams.set('fields', 'id,link_anuncio,nome_do_anuncio,site,date_created');
    url.searchParams.set('filter[link_anuncio][_nnull]', 'true');
    url.searchParams.set('filter[link_anuncio][_nempty]', 'true');
    url.searchParams.set('sort', 'date_created');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Directus retornou erro ${response.status} ao buscar leilões (página ${page})`);
    }

    const result = await response.json();
    const items = result.data || [];
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < pageSize) break;
    page++;
  }

  const urlMap = new Map<string, typeof allItems>();

  for (const item of allItems) {
    if (!item.link_anuncio) continue;
    const normalized = normalizeUrl(item.link_anuncio);
    if (!normalized) continue;

    if (!urlMap.has(normalized)) {
      urlMap.set(normalized, []);
    }
    urlMap.get(normalized)!.push(item);
  }

  const groups: DuplicateGroup[] = [];
  let totalExcess = 0;

  for (const [normalizedUrl, items] of urlMap) {
    if (items.length > 1) {
      items.sort((a, b) => new Date(a.date_created || 0).getTime() - new Date(b.date_created || 0).getTime());
      const excess = items.length - 1;
      totalExcess += excess;
      groups.push({
        normalizedUrl,
        items,
        count: items.length,
        excessCount: excess,
      });
    }
  }

  groups.sort((a, b) => b.count - a.count);

  return {
    groups,
    totalDuplicates: groups.length,
    totalExcess,
  };
}

export async function deleteLeilaoItems(ids: number[]): Promise<{ deleted: number; errors: string[] }> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  let deleted = 0;
  const errors: string[] = [];
  const batchSize = 50;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const promises = batch.map(async (id) => {
      try {
        const response = await fetch(`${DIRECTUS_URL}/items/leiloes_imovel/${id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${DIRECTUS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });
        if (!response.ok) {
          errors.push(`ID ${id}: ${response.status}`);
        } else {
          deleted++;
        }
      } catch (err) {
        errors.push(`ID ${id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    });

    await Promise.all(promises);
  }

  return { deleted, errors };
}

export interface LimpezaPreviewItem {
  id: number;
  nome_do_anuncio: string | null;
  link_anuncio: string | null;
  date_created: string | null;
  has_image: boolean;
}

export interface LimpezaPreviewResult {
  total: number;
  items: LimpezaPreviewItem[];
  imagesCount: number;
}

export async function previewLimpeza(
  siteId: number,
  dateFrom: string,
  dateTo: string
): Promise<LimpezaPreviewResult> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const allItems: LimpezaPreviewItem[] = [];
  let page = 1;
  const pageSize = 500;

  while (true) {
    const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
    url.searchParams.set('filter[site][_eq]', String(siteId));
    url.searchParams.set('filter[date_created][_gte]', dateFrom);
    url.searchParams.set('filter[date_created][_lte]', dateTo);
    url.searchParams.set('fields', 'id,nome_do_anuncio,link_anuncio,date_created,arquivo_imagem');
    url.searchParams.set('sort', '-date_created');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Directus API error: ${response.status}`);
    }

    const result = await response.json();
    const items = result.data || [];
    if (items.length === 0) break;

    for (const item of items) {
      allItems.push({
        id: item.id,
        nome_do_anuncio: item.nome_do_anuncio || null,
        link_anuncio: item.link_anuncio || null,
        date_created: item.date_created || null,
        has_image: !!item.arquivo_imagem,
      });
    }

    if (items.length < pageSize) break;
    page++;
  }

  return {
    total: allItems.length,
    items: allItems,
    imagesCount: allItems.filter(i => i.has_image).length,
  };
}

export interface LimpezaExecuteResult {
  totalDeleted: number;
  imagesDeleted: number;
  errors: number;
  errorDetails: string[];
}

export async function executeLimpeza(
  siteId: number,
  dateFrom: string,
  dateTo: string
): Promise<LimpezaExecuteResult> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const result: LimpezaExecuteResult = {
    totalDeleted: 0,
    imagesDeleted: 0,
    errors: 0,
    errorDetails: [],
  };

  let page = 1;
  const pageSize = 500;
  const allItems: { id: number; arquivo_imagem: string | null }[] = [];

  while (true) {
    const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
    url.searchParams.set('filter[site][_eq]', String(siteId));
    url.searchParams.set('filter[date_created][_gte]', dateFrom);
    url.searchParams.set('filter[date_created][_lte]', dateTo);
    url.searchParams.set('fields', 'id,arquivo_imagem');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Directus API error fetching items: ${response.status}`);
    }

    const data = await response.json();
    const items = data.data || [];
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < pageSize) break;
    page++;
  }

  if (allItems.length === 0) {
    return result;
  }

  const batchSize = 20;
  for (let i = 0; i < allItems.length; i += batchSize) {
    const batch = allItems.slice(i, i + batchSize);

    const promises = batch.map(async (item) => {
      try {
        const delUrl = `${DIRECTUS_URL}/items/leiloes_imovel/${item.id}`;
        const delRes = await fetch(delUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${DIRECTUS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });

        if (delRes.ok) {
          result.totalDeleted++;

          if (item.arquivo_imagem) {
            try {
              const imgUrl = `${DIRECTUS_URL}/files/${item.arquivo_imagem}`;
              const imgRes = await fetch(imgUrl, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
              });
              if (imgRes.ok) {
                result.imagesDeleted++;
              } else {
                result.errors++;
                result.errorDetails.push(`ID ${item.id}: falha ao excluir imagem ${item.arquivo_imagem} (HTTP ${imgRes.status})`);
              }
            } catch (imgErr) {
              result.errors++;
              result.errorDetails.push(`ID ${item.id}: erro ao excluir imagem - ${imgErr instanceof Error ? imgErr.message : 'Unknown error'}`);
            }
          }
        } else {
          result.errors++;
          result.errorDetails.push(`ID ${item.id}: HTTP ${delRes.status}`);
        }
      } catch (err) {
        result.errors++;
        result.errorDetails.push(`ID ${item.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    });

    await Promise.all(promises);
  }

  return result;
}

export async function getDetailedLogs(): Promise<{ logs: LogScraping[]; total: number }> {
  // Fetch sites for name lookup
  const sitesResponse = await directusFetch<Site[]>("input_library_url", { 
    limit: -1,
    fields: "id,nome_site,url_site"
  });
  const sites = sitesResponse.data || [];
  
  // Create site lookup
  const siteLookup: Record<number, Site> = {};
  sites.forEach((site) => {
    siteLookup[site.id] = site;
  });

  // Fetch logs with more fields
  const logsResponse = await directusFetch<LogScraping[]>("logs_scraping", {
    limit: -1,
    fields: "id,status,status_scraping,motivo_do_erro,site,date_created,date_updated",
    sort: "-date_created"
  });
  
  const logs = logsResponse.data || [];
  
  // Enrich logs with site information
  const enrichedLogs = logs.map((log) => {
    if (log.site && typeof log.site === "number") {
      const siteData = siteLookup[log.site];
      return { ...log, site: siteData || log.site };
    }
    return log;
  });

  return {
    logs: enrichedLogs,
    total: logs.length,
  };
}
