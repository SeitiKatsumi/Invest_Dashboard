import { Site, Leilao, LogScraping, UrlConsulta, DashboardStats } from "@shared/schema";

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

  const response = await fetch(url.toString(), {
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
      fields: "id,tipo_do_imovel,estado_uf,arquivo_imagem,status_publicacao_wp,site,date_created"
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
  let comImagem = 0;
  let semImagem = 0;
  let publicados = 0;
  let naoPublicados = 0;

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
  });

  const leiloesStats = {
    total: leiloes.length,
    comImagem,
    semImagem,
    porTipo,
    porUf,
    porSite,
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

  const urlConsultaStats = {
    total: urlConsulta.length,
    processadas: urlConsulta.filter((u) => u.status_processamento === "processado").length,
    naoProcessadas: urlConsulta.filter((u) => u.status_processamento === "não processado" || !u.status_processamento).length,
    comErro: urlConsulta.filter((u) => u.status_processamento === "erro").length,
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
