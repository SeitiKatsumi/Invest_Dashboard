import type { Express } from "express";
import { createServer, type Server } from "http";
import { getDashboardStats, getDetailedLogs, getSites, createLeilao, findSiteByUrl } from "./directus";
import { leilaoInsertSchema } from "@shared/schema";
import { extractAuctionDataFromImage } from "./openai";
import {
  getScrapingApiStatus,
  startOnboarding,
  startScraping,
  getJobs,
  getJob,
  deleteJob,
  getSitesWithConfig,
  saveSiteScrapingConfig,
  saveSiteScrapingError,
  clearSiteScrapingError,
  updateSiteScrapingStats,
  updateSiteStatus,
  updateSiteListingUrl,
  updateSiteName,
  getAuctionCountsBySite,
  bulkUpdateSiteStatus,
} from "./scraping";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getConnectionStatus,
  getCurrentQR,
  getGrupos,
  createGrupo,
  updateGrupo,
  deleteGrupo,
  getLeilaoById,
  sendLeilaoToGroups,
  createDisparo,
  getDisparos,
  tryAutoConnect,
  getWhatsAppGroups,
  resolveInviteLink,
  buildLeilaoMessage,
} from "./whatsapp";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Dashboard API endpoint
  app.get("/api/dashboard", async (req, res) => {
    try {
      const stats = await getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({
        error: "Failed to fetch dashboard data",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Detailed logs endpoint
  app.get("/api/logs", async (req, res) => {
    try {
      const logs = await getDetailedLogs();
      res.json(logs);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({
        error: "Failed to fetch logs",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Get all sites for dropdown
  app.get("/api/sites", async (req, res) => {
    try {
      const sites = await getSites();
      res.json(sites);
    } catch (error) {
      console.error("Error fetching sites:", error);
      res.status(500).json({
        error: "Failed to fetch sites",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Find site by URL
  app.get("/api/sites/find-by-url", async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "URL é obrigatória" });
      }
      
      const site = await findSiteByUrl(url);
      res.json({ site });
    } catch (error) {
      console.error("Error finding site by URL:", error);
      res.status(500).json({
        error: "Failed to find site",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Extract auction data from image using GPT-4 Vision
  app.post("/api/extract-from-image", async (req, res) => {
    try {
      const { image } = req.body;
      
      if (!image) {
        return res.status(400).json({ error: "Imagem é obrigatória" });
      }

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "OPENAI_API_KEY não configurada" });
      }

      const extractedData = await extractAuctionDataFromImage(image);
      res.json({ data: extractedData });
    } catch (error) {
      console.error("Error extracting data from image:", error);
      res.status(500).json({
        error: "Falha ao extrair dados da imagem",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  // Create new leilao
  app.post("/api/leiloes", async (req, res) => {
    try {
      const parseResult = leilaoInsertSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Dados inválidos",
          details: parseResult.error.flatten().fieldErrors 
        });
      }

      const leilao = await createLeilao(parseResult.data);
      res.status(201).json(leilao);
    } catch (error) {
      console.error("Error creating leilao:", error);
      res.status(500).json({
        error: "Failed to create leilao",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ======= SCRAPING API ROUTES =======

  app.get("/api/scraping/status", async (req, res) => {
    try {
      const status = await getScrapingApiStatus();
      res.json(status);
    } catch (error) {
      console.error("Error fetching scraping API status:", error);
      res.status(500).json({
        error: "Failed to fetch scraping API status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/scraping/sites", async (req, res) => {
    try {
      const sites = await getSitesWithConfig();
      res.json(sites);
    } catch (error) {
      console.error("Error fetching sites with config:", error);
      res.status(500).json({
        error: "Failed to fetch sites",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/scraping/onboard", async (req, res) => {
    try {
      const { siteId, siteUrl, maxPages, model } = req.body;
      if (!siteUrl) {
        return res.status(400).json({ error: "URL do site é obrigatória" });
      }
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "OPENAI_API_KEY não configurada" });
      }

      const result = await startOnboarding(siteUrl, process.env.OPENAI_API_KEY, maxPages, model);

      if (siteId && result.config) {
        try {
          await saveSiteScrapingConfig(siteId, result.config);
          await clearSiteScrapingError(siteId);
        } catch (saveError) {
          console.error("Error saving config to Directus:", saveError);
        }
      }

      if (siteId && !result.config) {
        try {
          const errorMsg = result.error || result.message || "Onboarding não retornou configuração";
          const analysis = result.analysis || result.agent_analysis || result.details || null;
          await saveSiteScrapingError(siteId, errorMsg, typeof analysis === "string" ? analysis : analysis ? JSON.stringify(analysis) : null);
        } catch (saveError) {
          console.error("Error saving scraping error to Directus:", saveError);
        }
      }

      res.json(result);
    } catch (error) {
      console.error("Error during onboarding:", error);
      const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";

      if (req.body.siteId) {
        try {
          await saveSiteScrapingError(req.body.siteId, errorMsg, null);
        } catch (saveError) {
          console.error("Error saving scraping error to Directus:", saveError);
        }
      }

      res.status(500).json({
        error: "Falha no onboarding",
        message: errorMsg,
      });
    }
  });

  app.post("/api/scraping/scrape", async (req, res) => {
    try {
      const { siteUrl, config, maxPages, concurrentRequests } = req.body;
      if (!siteUrl) {
        return res.status(400).json({ error: "URL do site é obrigatória" });
      }
      if (!config) {
        return res.status(400).json({ error: "Configuração de scraping é obrigatória. Execute o onboarding primeiro." });
      }

      let parsedConfig = config;
      if (typeof config === "string") {
        try {
          parsedConfig = JSON.parse(config);
        } catch {
          return res.status(400).json({ error: "Configuração de scraping inválida (JSON malformado)" });
        }
      }
      if (typeof parsedConfig !== "object" || parsedConfig === null) {
        return res.status(400).json({ error: "Configuração de scraping deve ser um objeto JSON válido" });
      }

      const result = await startScraping(siteUrl, parsedConfig, maxPages, concurrentRequests);
      res.json(result);
    } catch (error) {
      console.error("Error starting scraping:", error);
      res.status(500).json({
        error: "Falha ao iniciar scraping",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.get("/api/scraping/jobs", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const jobsResult = await getJobs(limit);
      const jobsList = jobsResult?.jobs || [];

      let sites: any[] = [];
      try {
        sites = await getSitesWithConfig();
      } catch {}

      const enrichedJobs = jobsList.map((job: any) => {
        let jobUrl = job.url || job.site_url || "";
        if (!jobUrl && job.result?.urls_found?.[0]) {
          try { jobUrl = new URL(job.result.urls_found[0]).origin; } catch {}
        }
        if (!jobUrl && job.result?.config_used?.url) {
          jobUrl = job.result.config_used.url;
        }
        if (jobUrl && sites.length > 0) {
          try {
            const jobDomain = new URL(jobUrl).hostname.replace(/^www\./, "");
            const matchedSite = sites.find((s: any) => {
              const siteUrl = s.url_listagem || s.url_site || "";
              if (!siteUrl) return false;
              try {
                const siteDomain = new URL(siteUrl).hostname.replace(/^www\./, "");
                return siteDomain === jobDomain;
              } catch { return false; }
            });
            if (matchedSite) {
              if (job.status === "completed" && job.completed_at && matchedSite.id) {
                const totalUrls = job.result?.total_urls || job.result?.urls_found?.length || 0;
                const existingDate = matchedSite.last_scraping_at;
                const jobDate = new Date(job.completed_at);
                if (!existingDate || new Date(existingDate) < jobDate) {
                  updateSiteScrapingStats(matchedSite.id, job.completed_at, totalUrls).catch(() => {});
                  matchedSite.last_scraping_at = job.completed_at;
                  matchedSite.last_scraping_urls_found = totalUrls;
                }
              }
              return { ...job, site_name: matchedSite.nome_site, site_url: matchedSite.url_listagem || matchedSite.url_site };
            }
          } catch {}
        }
        return { ...job, site_url: jobUrl || undefined };
      });

      res.json({ ...jobsResult, jobs: enrichedJobs });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({
        error: "Failed to fetch jobs",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/scraping/jobs/:jobId", async (req, res) => {
    try {
      const job = await getJob(req.params.jobId);
      res.json(job);
    } catch (error) {
      console.error("Error fetching job:", error);
      res.status(500).json({
        error: "Failed to fetch job",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.delete("/api/scraping/jobs/:jobId", async (req, res) => {
    try {
      const result = await deleteJob(req.params.jobId);
      res.json(result);
    } catch (error) {
      console.error("Error deleting job:", error);
      res.status(500).json({
        error: "Failed to delete job",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.patch("/api/scraping/sites/:siteId/status", async (req, res) => {
    try {
      const siteId = parseInt(req.params.siteId);
      const { liga_desliga } = req.body;
      if (!siteId || !liga_desliga || !["ligado", "desligado"].includes(liga_desliga)) {
        return res.status(400).json({ error: "siteId e liga_desliga (ligado/desligado) são obrigatórios" });
      }
      await updateSiteStatus(siteId, liga_desliga);
      res.json({ success: true, liga_desliga });
    } catch (error) {
      console.error("Error updating site status:", error);
      res.status(500).json({
        error: "Failed to update site status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.patch("/api/scraping/sites/:siteId/url-listagem", async (req, res) => {
    try {
      const siteId = parseInt(req.params.siteId);
      const { url_listagem } = req.body;
      if (!siteId || !url_listagem || typeof url_listagem !== "string") {
        return res.status(400).json({ error: "siteId e url_listagem são obrigatórios" });
      }
      try {
        const parsed = new URL(url_listagem.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return res.status(400).json({ error: "URL deve usar protocolo http ou https" });
        }
      } catch {
        return res.status(400).json({ error: "URL inválida" });
      }
      await updateSiteListingUrl(siteId, url_listagem.trim());
      res.json({ success: true, url_listagem: url_listagem.trim() });
    } catch (error) {
      console.error("Error updating listing URL:", error);
      res.status(500).json({
        error: "Falha ao atualizar URL de listagem",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.patch("/api/scraping/sites/:siteId/nome-site", async (req, res) => {
    try {
      const siteId = parseInt(req.params.siteId);
      const { nome_site } = req.body;
      if (!siteId || !nome_site || typeof nome_site !== "string" || !nome_site.trim()) {
        return res.status(400).json({ error: "siteId e nome_site são obrigatórios" });
      }
      await updateSiteName(siteId, nome_site.trim());
      res.json({ success: true, nome_site: nome_site.trim() });
    } catch (error) {
      console.error("Error updating site name:", error);
      res.status(500).json({
        error: "Falha ao atualizar nome do site",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/scraping/sites/auction-counts", async (req, res) => {
    try {
      const counts = await getAuctionCountsBySite();
      res.json(counts);
    } catch (error) {
      console.error("Error fetching auction counts:", error);
      res.status(500).json({
        error: "Falha ao buscar contagem de leilões",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/scraping/sites/:siteId/last-job-urls", async (req, res) => {
    try {
      const siteId = parseInt(req.params.siteId);
      if (!siteId) {
        return res.status(400).json({ error: "siteId é obrigatório" });
      }

      const sites = await getSitesWithConfig();
      const site = sites.find((s: any) => s.id === siteId);
      if (!site) {
        return res.status(404).json({ error: "Site não encontrado" });
      }

      const siteUrl = site.url_listagem || site.url_site || "";
      if (!siteUrl) {
        return res.json({ urls: [], total: 0 });
      }

      let siteDomain: string;
      try {
        siteDomain = new URL(siteUrl).hostname.replace(/^www\./, "");
      } catch {
        return res.json({ urls: [], total: 0 });
      }

      const jobsResult = await getJobs(100);
      const jobsList = jobsResult?.jobs || [];

      const completedJobs = jobsList
        .filter((j: any) => j.status === "completed")
        .filter((j: any) => {
          const jobUrl = j.url || j.site_url || j.result?.urls_found?.[0] || j.config_used?.url || "";
          if (!jobUrl) return false;
          try {
            return new URL(jobUrl).hostname.replace(/^www\./, "") === siteDomain;
          } catch { return false; }
        })
        .sort((a: any, b: any) => {
          const da = new Date(a.completed_at || 0).getTime();
          const db = new Date(b.completed_at || 0).getTime();
          return db - da;
        });

      if (completedJobs.length === 0) {
        return res.json({ urls: [], total: 0 });
      }

      const lastJob = completedJobs[0];
      const urls: string[] = lastJob.result?.urls_found || [];
      res.json({ urls, total: urls.length, job_id: lastJob.job_id || lastJob.id });
    } catch (error) {
      console.error("Error fetching last job URLs:", error);
      res.status(500).json({
        error: "Falha ao buscar URLs do último job",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.patch("/api/scraping/sites/bulk-status", async (req, res) => {
    try {
      const { siteIds, liga_desliga } = req.body;
      if (!siteIds || !Array.isArray(siteIds) || siteIds.length === 0) {
        return res.status(400).json({ error: "siteIds (non-empty array) is required" });
      }
      if (!liga_desliga || !["ligado", "desligado"].includes(liga_desliga)) {
        return res.status(400).json({ error: "liga_desliga (ligado/desligado) is required" });
      }
      const result = await bulkUpdateSiteStatus(siteIds, liga_desliga);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Error updating bulk site status:", error);
      res.status(500).json({
        error: "Failed to update bulk site status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/scraping/save-config", async (req, res) => {
    try {
      const { siteId, config } = req.body;
      if (!siteId || !config) {
        return res.status(400).json({ error: "siteId e config são obrigatórios" });
      }
      let parsedConfig = config;
      if (typeof config === "string") {
        try { parsedConfig = JSON.parse(config); } catch { return res.status(400).json({ error: "Config JSON inválido" }); }
      }
      await saveSiteScrapingConfig(siteId, parsedConfig);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving config:", error);
      res.status(500).json({
        error: "Failed to save config",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ==================== WhatsApp Routes ====================

  tryAutoConnect();

  app.get("/api/whatsapp/status", async (req, res) => {
    try {
      res.json(getConnectionStatus());
    } catch (error) {
      res.status(500).json({ error: "Erro ao verificar status" });
    }
  });

  app.post("/api/whatsapp/connect", async (req, res) => {
    try {
      const result = await connectWhatsApp();
      res.json(result);
    } catch (error) {
      console.error("Error connecting WhatsApp:", error);
      res.status(500).json({
        error: "Falha ao conectar WhatsApp",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.post("/api/whatsapp/disconnect", async (req, res) => {
    try {
      await disconnectWhatsApp();
      res.json({ status: "disconnected" });
    } catch (error) {
      console.error("Error disconnecting WhatsApp:", error);
      res.status(500).json({ error: "Falha ao desconectar" });
    }
  });

  app.get("/api/whatsapp/qr", async (req, res) => {
    try {
      const qr = getCurrentQR();
      res.json({ qr, status: getConnectionStatus().status });
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar QR" });
    }
  });

  app.get("/api/whatsapp/my-groups", async (req, res) => {
    try {
      const groups = await getWhatsAppGroups();
      res.json(groups);
    } catch (error) {
      console.error("Error fetching WhatsApp groups:", error);
      res.status(500).json({
        error: "Falha ao buscar grupos do WhatsApp",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.post("/api/whatsapp/resolve-invite", async (req, res) => {
    try {
      const { link } = req.body;
      if (!link) {
        return res.status(400).json({ error: "Link de convite é obrigatório" });
      }
      const result = await resolveInviteLink(link);
      res.json(result);
    } catch (error) {
      console.error("Error resolving invite link:", error);
      res.status(500).json({
        error: "Falha ao resolver link de convite",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.get("/api/whatsapp/grupos", async (req, res) => {
    try {
      const grupos = await getGrupos();
      res.json(grupos);
    } catch (error) {
      console.error("Error fetching grupos:", error);
      res.status(500).json({ error: "Falha ao buscar grupos" });
    }
  });

  app.post("/api/whatsapp/grupos", async (req, res) => {
    try {
      const { nome, jid, regiao, ativo } = req.body;
      if (!nome || !jid) {
        return res.status(400).json({ error: "Nome e JID são obrigatórios" });
      }
      const grupo = await createGrupo({ nome, jid, regiao, ativo });
      res.json(grupo);
    } catch (error) {
      console.error("Error creating grupo:", error);
      res.status(500).json({ error: "Falha ao criar grupo" });
    }
  });

  app.patch("/api/whatsapp/grupos/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const grupo = await updateGrupo(id, req.body);
      res.json(grupo);
    } catch (error) {
      console.error("Error updating grupo:", error);
      res.status(500).json({ error: "Falha ao atualizar grupo" });
    }
  });

  app.delete("/api/whatsapp/grupos/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await deleteGrupo(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting grupo:", error);
      res.status(500).json({ error: "Falha ao remover grupo" });
    }
  });

  app.get("/api/whatsapp/leilao/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const leilao = await getLeilaoById(id);
      if (!leilao) {
        return res.status(404).json({ error: "Leilão não encontrado" });
      }
      res.json(leilao);
    } catch (error) {
      console.error("Error fetching leilao:", error);
      res.status(500).json({ error: "Falha ao buscar leilão" });
    }
  });

  app.get("/api/whatsapp/preview/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const leilao = await getLeilaoById(id);
      if (!leilao) {
        return res.status(404).json({ error: "Leilão não encontrado" });
      }
      const mensagem = buildLeilaoMessage(leilao);
      res.json({ mensagem });
    } catch (error) {
      console.error("Error building preview:", error);
      res.status(500).json({ error: "Falha ao gerar preview" });
    }
  });

  app.post("/api/whatsapp/disparar", async (req, res) => {
    try {
      const { leilaoId, grupoIds, mensagem } = req.body;
      if (!leilaoId || !grupoIds || !Array.isArray(grupoIds) || grupoIds.length === 0) {
        return res.status(400).json({ error: "leilaoId e grupoIds são obrigatórios" });
      }

      const leilao = await getLeilaoById(leilaoId);
      if (!leilao) {
        return res.status(404).json({ error: "Leilão não encontrado" });
      }

      const grupos = await getGrupos();
      const selectedGrupos = grupos.filter((g) => grupoIds.includes(g.id));
      const groupJids = selectedGrupos.map((g) => g.jid);

      if (groupJids.length === 0) {
        return res.status(400).json({ error: "Nenhum grupo válido selecionado" });
      }

      let imageUrl = (leilao as any).link_imagem || null;
      if (!imageUrl && (leilao as any).arquivo_imagem) {
        const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
        const assetId = (leilao as any).arquivo_imagem;
        try {
          const imgResp = await fetch(`${DIRECTUS_URL}/assets/${assetId}`, {
            headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN?.trim()}` },
          });
          if (imgResp.ok) {
            const buf = Buffer.from(await imgResp.arrayBuffer());
            const base64 = buf.toString("base64");
            imageUrl = `data:image/jpeg;base64,${base64}`;
          }
        } catch (e) {
          console.warn("Could not fetch Directus asset for WhatsApp:", e);
        }
      }

      const result = await sendLeilaoToGroups(leilao, groupJids, imageUrl, mensagem || null);

      for (const grupo of selectedGrupos) {
        const wasSent = result.sent.includes(grupo.jid);
        const failInfo = result.failed.find((f) => f.jid === grupo.jid);
        try {
          await createDisparo({
            leilao_id: leilao.id,
            leilao_nome: leilao.nome_do_anuncio || `Leilão #${leilao.id}`,
            grupo_id: grupo.id,
            grupo_nome: grupo.nome,
            status: wasSent ? "enviado" : "erro",
            erro_mensagem: failInfo?.error || null,
          });
        } catch (e) {
          console.error("Error saving disparo record:", e);
        }
      }

      res.json({
        success: true,
        sent: result.sent.length,
        failed: result.failed.length,
        details: result,
      });
    } catch (error) {
      console.error("Error sending WhatsApp:", error);
      res.status(500).json({
        error: "Falha no disparo",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.get("/api/whatsapp/disparos", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const disparos = await getDisparos(limit);
      res.json(disparos);
    } catch (error) {
      console.error("Error fetching disparos:", error);
      res.status(500).json({ error: "Falha ao buscar histórico" });
    }
  });

  return httpServer;
}
