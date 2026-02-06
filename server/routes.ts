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
  updateSiteScrapingStats,
  updateSiteStatus,
  bulkUpdateSiteStatus,
} from "./scraping";

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
        } catch (saveError) {
          console.error("Error saving config to Directus:", saveError);
        }
      }

      res.json(result);
    } catch (error) {
      console.error("Error during onboarding:", error);
      res.status(500).json({
        error: "Falha no onboarding",
        message: error instanceof Error ? error.message : "Erro desconhecido",
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
              const siteUrl = s.url_site || s.url_listagem || "";
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
              return { ...job, site_name: matchedSite.nome_site, site_url: matchedSite.url_site || matchedSite.url_listagem };
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

  return httpServer;
}
