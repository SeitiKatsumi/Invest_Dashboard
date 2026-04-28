import type { Express } from "express";
import { createServer, type Server } from "http";
import { getDashboardStats, getDetailedLogs, getSites, createLeilao, findSiteByUrl, findDuplicates, deleteLeilaoItems, previewLimpeza, executeLimpeza } from "./directus";
import { getEstimate, startScan, getScanStatus, abortScan, cleanupItems, resetScan, scanEmitter } from "./classifier";
import { leilaoInsertSchema, type WhatsAppAgendamento, type WhatsAppAgendamentoStatus } from "@shared/schema";
import { extractAuctionDataFromImage } from "./openai";
import { getOpenAIApiKey, setOpenAIApiKey, isOpenAIKeyConfigured, getMaskedKey, getUsageSummary } from "./openai-usage";
import {
  initScheduler,
  getScheduleStatus,
  getScheduleConfig,
  updateScheduleConfig,
  triggerManualRun,
  cancelCurrentRun,
  getLastRunResult,
  getDayNames,
} from "./scraper-scheduler";
import {
  initArchiver,
  getArchiverStatus,
  runArchiver,
  getLastArchiverRun,
  previewEligible,
} from "./auction-archiver";
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
  updateSiteEngine,
  startInternalOnboarding,
  startInternalScraping,
  getInternalJobs,
  getInternalJob,
  deleteInternalJob,
  getBrowserPoolStats,
  drainBrowserPool,
  scoreConfig,
  persistBatchReportToDirectus,
  classifyScrapingError,
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
  createAgendamento,
  listAgendamentos,
  cancelAgendamento,
} from "./whatsapp";

function isCollectionMissingError(msg: string): boolean {
  return (
    msg.includes("FORBIDDEN") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.toLowerCase().includes("not found")
  );
}

const COLLECTION_MISSING_HINT = "Verifique se a coleção 'whatsapp_agendamentos' existe no Directus.";

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

  app.get("/api/settings/openai", async (_req, res) => {
    res.json({
      configured: isOpenAIKeyConfigured(),
      masked_key: getMaskedKey(),
    });
  });

  app.post("/api/settings/openai", async (req, res) => {
    try {
      const { api_key } = req.body;
      if (!api_key || typeof api_key !== 'string' || !api_key.startsWith('sk-')) {
        return res.status(400).json({ error: "Chave inválida. A chave da OpenAI deve começar com 'sk-'" });
      }

      setOpenAIApiKey(api_key);
      res.json({ success: true, masked_key: getMaskedKey() });
    } catch (error) {
      res.status(500).json({ error: "Falha ao salvar chave" });
    }
  });

  app.get("/api/settings/openai/usage", async (_req, res) => {
    res.json(await getUsageSummary());
  });

  app.post("/api/extract-from-image", async (req, res) => {
    try {
      const { image } = req.body;
      
      if (!image) {
        return res.status(400).json({ error: "Imagem é obrigatória" });
      }

      if (!isOpenAIKeyConfigured()) {
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
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.startsWith("DUPLICATA:")) {
        return res.status(409).json({ error: message });
      }
      res.status(500).json({
        error: "Failed to create leilao",
        message,
      });
    }
  });

  // ======= DUPLICATES API ROUTES =======

  app.get("/api/leiloes/duplicates", async (_req, res) => {
    try {
      const result = await findDuplicates();
      res.json(result);
    } catch (error) {
      console.error("Error finding duplicates:", error);
      res.status(500).json({
        error: "Falha ao buscar duplicatas",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.delete("/api/leiloes/duplicates", async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "IDs são obrigatórios" });
      }

      const validIds = ids.filter((id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0);
      if (validIds.length === 0) {
        return res.status(400).json({ error: "Nenhum ID válido fornecido" });
      }

      const result = await deleteLeilaoItems(validIds);
      res.json(result);
    } catch (error) {
      console.error("Error deleting duplicates:", error);
      res.status(500).json({
        error: "Falha ao excluir duplicatas",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.delete("/api/leiloes/duplicates/auto", async (_req, res) => {
    try {
      const duplicates = await findDuplicates();
      const idsToDelete: number[] = [];

      for (const group of duplicates.groups) {
        const sorted = [...group.items].sort(
          (a, b) => new Date(a.date_created || 0).getTime() - new Date(b.date_created || 0).getTime()
        );
        for (let i = 1; i < sorted.length; i++) {
          idsToDelete.push(sorted[i].id);
        }
      }

      if (idsToDelete.length === 0) {
        return res.json({ deleted: 0, errors: [], message: "Nenhuma duplicata encontrada" });
      }

      const result = await deleteLeilaoItems(idsToDelete);
      res.json({ ...result, totalGroups: duplicates.totalDuplicates });
    } catch (error) {
      console.error("Error auto-deleting duplicates:", error);
      res.status(500).json({
        error: "Falha ao excluir duplicatas automaticamente",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  // ======= CLASSIFIER API ROUTES =======

  app.get("/api/classificador/estimate", async (_req, res) => {
    try {
      const estimate = await getEstimate();
      res.json(estimate);
    } catch (error) {
      console.error("Error getting estimate:", error);
      res.status(500).json({
        error: "Falha ao calcular estimativa",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.post("/api/classificador/scan", async (_req, res) => {
    try {
      await startScan();
      res.json({ message: "Escaneamento iniciado" });
    } catch (error) {
      console.error("Error starting scan:", error);
      res.status(500).json({
        error: "Falha ao iniciar escaneamento",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.get("/api/classificador/status", async (_req, res) => {
    const status = getScanStatus();
    if (!status) {
      return res.json({ status: "idle" });
    }
    res.json(status);
  });

  app.get("/api/classificador/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const currentStatus = getScanStatus();
    if (currentStatus) {
      res.write(`data: ${JSON.stringify(currentStatus)}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ status: "idle" })}\n\n`);
    }

    const onScan = (data: any) => {
      try {
        const payload = { ...data };
        if (payload.nonPropertyIds) {
          payload.nonPropertyCount = payload.nonPropertyIds.length;
          delete payload.nonPropertyIds;
        }
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {}
    };

    scanEmitter.on("scan", onScan);

    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch {}
    }, 15000);

    req.on("close", () => {
      scanEmitter.off("scan", onScan);
      clearInterval(heartbeat);
    });
  });

  app.post("/api/classificador/abort", async (_req, res) => {
    const aborted = abortScan();
    res.json({ aborted });
  });

  app.post("/api/classificador/reset", async (_req, res) => {
    const success = resetScan();
    if (!success) {
      return res.status(409).json({ error: "Não é possível resetar durante escaneamento em andamento" });
    }
    res.json({ reset: true });
  });

  app.delete("/api/classificador/cleanup", async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "IDs são obrigatórios" });
      }
      const result = await cleanupItems(ids);
      res.json(result);
    } catch (error) {
      console.error("Error cleaning up items:", error);
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      const isValidation = message.includes("Nenhum") || message.includes("escaneamento");
      res.status(isValidation ? 400 : 500).json({
        error: isValidation ? "Requisição inválida" : "Falha ao excluir itens",
        message,
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
      const sitesWithCategory = sites.map((site: Record<string, unknown>) => ({
        ...site,
        error_category: classifyScrapingError(site as {
          scraping_config?: string | Record<string, unknown> | null;
          scraping_error?: string | null;
          scraping_error_analysis?: string | null;
        }),
      }));
      res.json(sitesWithCategory);
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
      const { siteId, siteUrl, maxPages, model, engine: rawEngine } = req.body;
      const engine = rawEngine || "internal";
      if (!siteUrl) {
        return res.status(400).json({ error: "URL do site é obrigatória" });
      }
      if (!isOpenAIKeyConfigured()) {
        return res.status(500).json({ error: "OPENAI_API_KEY não configurada" });
      }

      const useInternal = engine === "internal";

      if (useInternal) {
        const result = await startInternalOnboarding(
          siteUrl, getOpenAIApiKey(), siteId, maxPages, model
        );

        let configConfidence: ReturnType<typeof scoreConfig> | undefined;
        let miniScrapeResult: { urls_found: number; valid: boolean } | undefined;
        const diagnostics: Record<string, unknown> = {};

        diagnostics.cloudflare_detected = result.cloudflare_detected || false;
        diagnostics.access_blocked = result.access_blocked || false;
        diagnostics.access_block_reason = result.access_block_reason;
        diagnostics.exploration_links_found = result.exploration_links_found || 0;
        diagnostics.spa_detected = result.spa_detected || false;
        diagnostics.spa_warning = result.spa_warning || null;

        const isAccessBlocked = result.access_blocked || result.cloudflare_detected;
        const isSpaDetected = !!result.spa_detected;
        const isFallbackConfig = !!(result.config && result.error);
        if (isFallbackConfig) {
          diagnostics.fallback_config = true;
          diagnostics.fallback_reason = result.error;
        }

        if (result.config) {
          configConfidence = scoreConfig(result.config as Record<string, unknown>);

          try {
            const { DeterministicCrawler } = await import('./internal-scraper/index.js');
            const testCrawler = new DeterministicCrawler(result.config as Record<string, unknown>, { concurrentRequests: 3, useHeuristics: false });
            const testResult = await testCrawler.crawl(siteUrl, 5, true);
            miniScrapeResult = { urls_found: testResult.total_urls, valid: testResult.total_urls > 0 };

            if (testResult.total_urls === 0) {
              const crawlErrors = (testResult.errors || []).join(' ');
              const isMiniScrapeAccessBlocked = isAccessBlocked
                || /timeout|abort|ECONNREFUSED|ECONNRESET|403|503|cloudflare|blocked|denied/i.test(crawlErrors);

              if (isSpaDetected || testResult.spa_detected) {
                diagnostics.config_validation = 'not_validated_spa_dynamic_content';
                diagnostics.config_validation_message = `SPA/Firebase detectado. Mini-scrape encontrou 0 URLs — conteúdo é renderizado dinamicamente via JavaScript. Config salva como não validada.`;
              } else if (isMiniScrapeAccessBlocked) {
                diagnostics.config_validation = 'not_validated_access_blocked';
                diagnostics.config_validation_message = `Mini-scrape encontrou 0 URLs, mas detectou bloqueio de acesso (${result.cloudflare_detected ? 'Cloudflare' : crawlErrors.slice(0, 80) || 'HTTP 403/bloqueio'}). Config salva como não validada — necessita validação manual.`;
              } else {
                diagnostics.config_validation = 'config_invalid';
                diagnostics.config_validation_message = `Mini-scrape de teste encontrou 0 URLs. Confiança da config: ${configConfidence.confidence}%. Config invalidada — nenhum resultado encontrado.`;
              }
            } else {
              diagnostics.config_validation = 'validated';
              diagnostics.config_validation_message = `Mini-scrape encontrou ${testResult.total_urls} URLs. Config validada.`;
            }
          } catch (testErr) {
            console.warn('[Onboarding] Mini-scrape test failed:', testErr);
            const testErrMsg = testErr instanceof Error ? testErr.message : String(testErr);
            const isMiniScrapeAccessError = isAccessBlocked
              || /timeout|abort|ECONNREFUSED|ECONNRESET|403|503|cloudflare/i.test(testErrMsg);

            if (isMiniScrapeAccessError) {
              diagnostics.config_validation = 'not_validated_access_blocked';
              diagnostics.config_validation_message = `Mini-scrape falhou (${testErrMsg.slice(0, 100)}), provável bloqueio de acesso. Config salva como não validada.`;
            } else {
              diagnostics.config_validation = 'test_failed';
            }
          }

          diagnostics.confidence_score = configConfidence?.confidence;
          diagnostics.confidence_flags = configConfidence?.flags;
          diagnostics.mini_scrape = miniScrapeResult;
        }

        const isConfigInvalid = diagnostics.config_validation === 'config_invalid';
        const isNotValidatedDueToAccess = diagnostics.config_validation === 'not_validated_access_blocked';
        const isNotValidatedDueToSpa = diagnostics.config_validation === 'not_validated_spa_dynamic_content';

        if (siteId && result.config && !isConfigInvalid) {
          try {
            const configObj = typeof result.config === "object" && result.config !== null
              ? result.config as Record<string, unknown>
              : {};

            if (isNotValidatedDueToSpa) {
              (configObj as Record<string, unknown>).validation_status = 'not_validated_spa_dynamic_content';
              (configObj as Record<string, unknown>).validation_note = String(diagnostics.config_validation_message || 'SPA/Firebase — conteúdo dinâmico');
            } else if (isNotValidatedDueToAccess) {
              (configObj as Record<string, unknown>).validation_status = 'not_validated_access_blocked';
              (configObj as Record<string, unknown>).validation_note = String(diagnostics.config_validation_message || 'Não validada por bloqueio de acesso');
            }

            await saveSiteScrapingConfig(siteId, configObj);

            if (isNotValidatedDueToSpa) {
              await saveSiteScrapingError(
                siteId,
                `SPA/Firebase detectado — config gerada mas não validada. Conteúdo renderizado via JavaScript.`,
                String(diagnostics.spa_warning || diagnostics.config_validation_message || '')
              );
            } else if (isNotValidatedDueToAccess) {
              await saveSiteScrapingError(
                siteId,
                `Config gerada mas não validada — ${result.cloudflare_detected ? 'Cloudflare detectado' : 'acesso bloqueado'}. Necessita validação manual.`,
                String(diagnostics.config_validation_message || '')
              );
            } else {
              await clearSiteScrapingError(siteId);
            }

            await updateSiteEngine(siteId, "internal");
          } catch (saveError) {
            console.error("Error saving config to Directus:", saveError);
          }
        }

        if (siteId && result.config && isConfigInvalid) {
          try {
            await saveSiteScrapingError(siteId, String(diagnostics.config_validation_message || "Config invalidada por mini-scrape"), null);
          } catch (saveError) {
            console.error("Error saving config validation error:", saveError);
          }
        }

        if (siteId && !result.config) {
          try {
            const errorMsg = result.error || "Onboarding interno não retornou configuração";
            await saveSiteScrapingError(siteId, errorMsg, null);
          } catch (saveError) {
            console.error("Error saving scraping error to Directus:", saveError);
          }
        }

        res.json({ ...result, ...diagnostics });
      } else {
        const result = await startOnboarding(siteUrl, getOpenAIApiKey(), maxPages, model);

        if (siteId && result.config) {
          try {
            await saveSiteScrapingConfig(siteId, result.config);
            await clearSiteScrapingError(siteId);
            await updateSiteEngine(siteId, "external");
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
      }
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
      const { siteUrl, config, maxPages, concurrentRequests, engine: rawScrapeEngine, siteId } = req.body;
      const engine = rawScrapeEngine || "internal";
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

      const useInternal = engine === "internal";

      if (useInternal) {
        const result = await startInternalScraping(
          siteUrl, parsedConfig, siteId, maxPages, concurrentRequests
        );
        res.json(result);
      } else {
        const result = await startScraping(siteUrl, parsedConfig, maxPages, concurrentRequests);
        res.json(result);
      }
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

      let sites: any[] = [];
      try {
        sites = await getSitesWithConfig();
      } catch {}

      let externalJobs: any[] = [];
      try {
        const jobsResult = await getJobs(limit);
        externalJobs = (jobsResult?.jobs || []).map((job: any) => ({
          ...job,
          engine: "external",
        }));
      } catch (e) {
        console.warn("Could not fetch external jobs:", e);
      }

      const internalJobs = getInternalJobs(limit).map((job) => ({
        job_id: job.id,
        status: job.status === "processing" ? "running" : job.status,
        url: job.siteUrl,
        site_url: job.siteUrl,
        site_id: job.siteId,
        progress: job.progress,
        urls_found: job.totalUrls,
        pages_processed: job.pagesProcessed,
        error: job.error,
        started_at: job.startedAt,
        completed_at: job.completedAt,
        engine: "internal",
        result_classification: job.resultClassification,
        confidence_score: job.confidenceScore,
        result: job.result && "urls_found" in job.result ? {
          total_urls: job.result.total_urls,
          urls_found: job.result.urls_found,
          pages_processed: job.result.pages_processed,
        } : undefined,
      }));

      const allJobs = [...internalJobs, ...externalJobs];

      allJobs.sort((a, b) => {
        const da = new Date(a.started_at || a.created_at || 0).getTime();
        const db = new Date(b.started_at || b.created_at || 0).getTime();
        return db - da;
      });

      const enrichedJobs = allJobs.slice(0, limit).map((job: any) => {
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
              if (job.status === "completed" && job.completed_at && matchedSite.id && job.engine !== "internal") {
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

      res.json({ jobs: enrichedJobs });
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
      const jobId = req.params.jobId;
      if (jobId.startsWith("int_")) {
        const job = getInternalJob(jobId);
        if (!job) return res.status(404).json({ error: "Job não encontrado" });
        const normalizedStatus = job.status === "processing" ? "running" : job.status;
        res.json({
          job_id: job.id,
          status: normalizedStatus,
          url: job.siteUrl,
          created_at: job.startedAt,
          completed_at: job.completedAt,
          result: job.result,
          result_classification: job.resultClassification,
          confidence_score: job.confidenceScore,
          urls_found: job.totalUrls,
          progress: {
            percent: job.progress,
            message: job.progressMessage,
            pagesProcessed: job.pagesProcessed,
            totalUrls: job.totalUrls,
          },
          engine: "internal",
        });
      } else {
        const job = await getJob(jobId);
        res.json(job);
      }
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
      const jobId = req.params.jobId;
      if (jobId.startsWith("int_")) {
        const deleted = deleteInternalJob(jobId);
        res.json({ success: deleted });
      } else {
        const result = await deleteJob(jobId);
        res.json(result);
      }
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

      let externalJobs: any[] = [];
      try {
        const jobsResult = await getJobs(100);
        externalJobs = jobsResult?.jobs || [];
      } catch {}

      const internalCompletedJobs = getInternalJobs(100)
        .filter((j) => j.status === "completed")
        .filter((j) => {
          if (j.siteId === siteId) return true;
          try {
            return new URL(j.siteUrl).hostname.replace(/^www\./, "") === siteDomain;
          } catch { return false; }
        })
        .map((j) => ({
          job_id: j.id,
          status: j.status,
          completed_at: j.completedAt,
          result: j.result && "urls_found" in j.result ? { urls_found: j.result.urls_found, total_urls: j.result.total_urls } : undefined,
          url: j.siteUrl,
          engine: "internal",
        }));

      const externalCompletedJobs = externalJobs
        .filter((j: any) => j.status === "completed")
        .filter((j: any) => {
          const jobUrl = j.url || j.site_url || j.result?.urls_found?.[0] || j.config_used?.url || j.result?.config_used?.url || "";
          if (!jobUrl) return false;
          try {
            return new URL(jobUrl).hostname.replace(/^www\./, "") === siteDomain;
          } catch { return false; }
        });

      const allCompleted = [...internalCompletedJobs, ...externalCompletedJobs]
        .sort((a: any, b: any) => {
          const da = new Date(a.completed_at || 0).getTime();
          const db = new Date(b.completed_at || 0).getTime();
          return db - da;
        });

      if (allCompleted.length === 0) {
        return res.json({ urls: [], total: 0 });
      }

      const lastJob = allCompleted[0];
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

  app.patch("/api/scraping/sites/:siteId/engine", async (req, res) => {
    try {
      const siteId = parseInt(req.params.siteId);
      const { engine } = req.body;
      if (!siteId || !engine || !["external", "internal"].includes(engine)) {
        return res.status(400).json({ error: "siteId e engine (external/internal) são obrigatórios" });
      }
      await updateSiteEngine(siteId, engine);
      res.json({ success: true, engine });
    } catch (error) {
      console.error("Error updating site engine:", error);
      res.status(500).json({
        error: "Falha ao atualizar motor de scraping",
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

  app.get("/api/scraping/resource-stats", async (_req, res) => {
    try {
      const poolStats = getBrowserPoolStats();
      const memUsage = process.memoryUsage();
      res.json({
        browserPool: poolStats,
        memory: {
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
        },
        activeJobs: getInternalJobs(200).filter(j => j.status === 'processing' || j.status === 'pending').length,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get resource stats" });
    }
  });

  app.post("/api/scraping/drain-pool", async (_req, res) => {
    try {
      await drainBrowserPool();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to drain browser pool" });
    }
  });

  app.post("/api/scraping/score-config", async (req, res) => {
    try {
      const { config } = req.body;
      if (!config) {
        return res.status(400).json({ error: "config é obrigatório" });
      }
      let parsedConfig = config;
      if (typeof config === "string") {
        try { parsedConfig = JSON.parse(config); } catch { return res.status(400).json({ error: "Config JSON inválido" }); }
      }
      const score = scoreConfig(parsedConfig);
      res.json(score);
    } catch (error) {
      res.status(500).json({ error: "Failed to score config" });
    }
  });

  app.get("/api/scraping/batch-report", async (_req, res) => {
    try {
      const allJobs = getInternalJobs(500);
      const completedJobs = allJobs.filter(j => j.status === 'completed' || j.status === 'failed');

      const report = {
        total_jobs: completedJobs.length,
        by_classification: {
          success: completedJobs.filter(j => j.resultClassification === 'success').length,
          empty: completedJobs.filter(j => j.resultClassification === 'empty').length,
          config_suspect: completedJobs.filter(j => j.resultClassification === 'config_suspect').length,
          config_invalid: completedJobs.filter(j => j.resultClassification === 'config_invalid').length,
          error: completedJobs.filter(j => j.status === 'failed').length,
          unclassified: completedJobs.filter(j => !j.resultClassification && j.status === 'completed').length,
        },
        avg_confidence: completedJobs.filter(j => j.confidenceScore !== undefined).length > 0
          ? Math.round(completedJobs.filter(j => j.confidenceScore !== undefined).reduce((sum, j) => sum + (j.confidenceScore || 0), 0) / completedJobs.filter(j => j.confidenceScore !== undefined).length)
          : null,
        total_urls_found: completedJobs.reduce((sum, j) => sum + j.totalUrls, 0),
        top_errors: Object.entries(
          completedJobs
            .filter(j => j.error)
            .reduce((acc: Record<string, number>, j) => {
              const key = (j.error || '').slice(0, 80);
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {})
        ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([error, count]) => ({ error, count })),
        sites_needing_attention: completedJobs
          .filter(j => j.resultClassification === 'empty' || j.resultClassification === 'config_suspect' || j.resultClassification === 'config_invalid' || j.status === 'failed')
          .map(j => ({
            site_id: j.siteId,
            site_url: j.siteUrl,
            classification: j.resultClassification || 'error',
            error: j.error,
            confidence: j.confidenceScore,
          })),
        jobs: completedJobs.map(j => ({
          id: j.id,
          site_id: j.siteId,
          site_url: j.siteUrl,
          status: j.status,
          classification: j.resultClassification,
          confidence: j.confidenceScore,
          urls_found: j.totalUrls,
          pages_processed: j.pagesProcessed,
          error: j.error,
          started_at: j.startedAt,
          completed_at: j.completedAt,
        })),
      };

      res.json(report);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate batch report" });
    }
  });

  app.post("/api/scraping/batch-report", async (req, res) => {
    try {
      const report = req.body;
      if (!report || !report.batch_id) {
        return res.status(400).json({ error: "batch_id é obrigatório" });
      }

      await persistBatchReportToDirectus(report);
      res.json({ success: true, message: "Relatório salvo no Directus" });
    } catch (error) {
      console.error("Error saving batch report:", error);
      res.status(500).json({ error: "Falha ao salvar relatório" });
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

  app.post("/api/whatsapp/disparar-multi", async (req, res) => {
    try {
      const { items, grupo_ids } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items é obrigatório (array de imóveis)" });
      }
      if (!Array.isArray(grupo_ids) || grupo_ids.length === 0) {
        return res.status(400).json({ error: "grupo_ids é obrigatório" });
      }

      const sanitizedGrupoIds: number[] = (grupo_ids as unknown[])
        .map((n) => Number(n))
        .filter((n): n is number => Number.isFinite(n));
      const grupos = await getGrupos();
      const selectedGrupos = grupos.filter((g) => sanitizedGrupoIds.includes(g.id));
      const groupJids = selectedGrupos.map((g) => g.jid);
      if (groupJids.length === 0) {
        return res.status(400).json({ error: "Nenhum grupo válido selecionado" });
      }

      let totalSent = 0;
      let totalFailed = 0;
      const perItem: Array<{
        leilaoId: number;
        ok: boolean;
        sent: number;
        failed: number;
        error?: string;
      }> = [];

      const groupCount = groupJids.length;
      for (const item of items) {
        const leilaoId = Number(item?.leilao_id);
        const mensagem: string | null = typeof item?.mensagem === "string" ? item.mensagem : null;
        if (!Number.isFinite(leilaoId) || leilaoId <= 0) {
          perItem.push({ leilaoId: 0, ok: false, sent: 0, failed: 0, error: "leilao_id inválido" });
          totalFailed += groupCount;
          continue;
        }

        try {
          const leilao = await getLeilaoById(leilaoId);
          if (!leilao) {
            perItem.push({ leilaoId, ok: false, sent: 0, failed: 0, error: "Leilão não encontrado" });
            totalFailed += groupCount;
            continue;
          }

          let imageUrl: string | null = leilao.link_imagem || null;
          if (!imageUrl && leilao.arquivo_imagem) {
            const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
            const assetId = leilao.arquivo_imagem;
            try {
              const imgResp = await fetch(`${DIRECTUS_URL}/assets/${assetId}`, {
                headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN?.trim()}` },
              });
              if (imgResp.ok) {
                const buf = Buffer.from(await imgResp.arrayBuffer());
                imageUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
              }
            } catch (e) {
              console.warn("Could not fetch Directus asset for WhatsApp:", e);
            }
          }

          const result = await sendLeilaoToGroups(leilao, groupJids, imageUrl, mensagem);

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

          totalSent += result.sent.length;
          totalFailed += result.failed.length;
          perItem.push({
            leilaoId,
            ok: result.failed.length === 0,
            sent: result.sent.length,
            failed: result.failed.length,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro desconhecido";
          perItem.push({ leilaoId, ok: false, sent: 0, failed: 0, error: msg });
          totalFailed += groupCount;
        }
      }

      res.json({
        success: true,
        totalSent,
        totalFailed,
        items: perItem,
      });
    } catch (error) {
      console.error("Error in disparar-multi:", error);
      res.status(500).json({
        error: "Falha no disparo múltiplo",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.post("/api/whatsapp/agendamentos", async (req, res) => {
    try {
      const { items, grupo_ids } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items é obrigatório (array de imóveis a agendar)" });
      }
      if (!Array.isArray(grupo_ids) || grupo_ids.length === 0) {
        return res.status(400).json({ error: "grupo_ids é obrigatório" });
      }

      const grupos = await getGrupos();
      const validGrupoIds = new Set(grupos.map((g) => g.id));
      const sanitizedGrupoIds: number[] = (grupo_ids as unknown[])
        .map((n) => Number(n))
        .filter((n): n is number => Number.isFinite(n) && validGrupoIds.has(n));
      if (sanitizedGrupoIds.length === 0) {
        return res.status(400).json({ error: "Nenhum grupo válido informado" });
      }

      const now = Date.now();
      const created: WhatsAppAgendamento[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const leilaoId = Number(item?.leilao_id);
        const mensagem = typeof item?.mensagem === "string" ? item.mensagem.trim() : "";
        const scheduledAtRaw = item?.scheduled_at;

        if (!Number.isFinite(leilaoId) || leilaoId <= 0) {
          errors.push({ index: i, error: "leilao_id inválido" });
          continue;
        }
        if (!mensagem) {
          errors.push({ index: i, error: "mensagem obrigatória" });
          continue;
        }
        const scheduledDate = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
        if (!scheduledDate || isNaN(scheduledDate.getTime())) {
          errors.push({ index: i, error: "scheduled_at inválido" });
          continue;
        }
        if (scheduledDate.getTime() <= now) {
          errors.push({ index: i, error: "scheduled_at deve estar no futuro" });
          continue;
        }

        try {
          const leilao = await getLeilaoById(leilaoId);
          if (!leilao) {
            errors.push({ index: i, error: `Leilão ${leilaoId} não encontrado` });
            continue;
          }

          const ag = await createAgendamento({
            leilao_id: leilao.id,
            leilao_nome: leilao.nome_do_anuncio || `Leilão #${leilao.id}`,
            grupo_ids: sanitizedGrupoIds,
            mensagem,
            scheduled_at: scheduledDate.toISOString(),
          });
          created.push(ag);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro desconhecido";
          errors.push({ index: i, error: msg });
        }
      }

      if (created.length === 0) {
        const collectionMissing = errors.some((e) => isCollectionMissingError(e.error));
        return res.status(400).json({
          error: "Nenhum agendamento foi criado",
          details: errors,
          hint: collectionMissing ? COLLECTION_MISSING_HINT : undefined,
        });
      }

      res.json({ success: true, created, errors });
    } catch (error) {
      console.error("Error creating agendamentos:", error);
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      res.status(500).json({
        error: "Falha ao criar agendamentos",
        message: msg,
        hint: isCollectionMissingError(msg) ? COLLECTION_MISSING_HINT : undefined,
      });
    }
  });

  app.get("/api/whatsapp/agendamentos", async (req, res) => {
    try {
      const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
      let limit: number | undefined;
      if (typeof req.query.limit === "string") {
        const parsed = parseInt(req.query.limit, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          limit = Math.min(parsed, 500);
        }
      }
      const validStatuses: WhatsAppAgendamentoStatus[] = [
        "pendente",
        "executando",
        "concluido",
        "erro",
        "cancelado",
      ];
      const status: WhatsAppAgendamentoStatus | undefined =
        statusParam && (validStatuses as string[]).includes(statusParam)
          ? (statusParam as WhatsAppAgendamentoStatus)
          : undefined;
      const result = await listAgendamentos({ status, limit });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      console.error("Error fetching agendamentos:", error);
      res.status(500).json({
        error: "Falha ao buscar agendamentos",
        message: msg,
        hint: isCollectionMissingError(msg) ? COLLECTION_MISSING_HINT : undefined,
      });
    }
  });

  app.delete("/api/whatsapp/agendamentos/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const updated = await cancelAgendamento(id);
      res.json({ success: true, agendamento: updated });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      console.error("Error cancelling agendamento:", error);
      const isCollectionMissing = msg.includes("FORBIDDEN") || msg.includes("403") || msg.includes("404");
      const status = msg.includes("não encontrado") ? 404 : 400;
      res.status(status).json({
        error: msg,
        hint: isCollectionMissing
          ? "Verifique se a coleção 'whatsapp_agendamentos' existe no Directus."
          : undefined,
      });
    }
  });

  app.get("/api/scheduler/status", async (_req, res) => {
    try {
      const status = await getScheduleStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Falha ao obter status do agendamento" });
    }
  });

  app.get("/api/scheduler/config", (_req, res) => {
    res.json(getScheduleConfig());
  });

  app.put("/api/scheduler/config", (req, res) => {
    try {
      const updated = updateScheduleConfig(req.body);
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Falha ao atualizar configuração" });
    }
  });

  app.post("/api/scheduler/run", async (req, res) => {
    try {
      const dayIndex = req.body.dayIndex;
      const result = await triggerManualRun(dayIndex);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Falha ao iniciar execução" });
    }
  });

  app.post("/api/scheduler/cancel", (_req, res) => {
    const cancelled = cancelCurrentRun();
    res.json({ cancelled });
  });

  app.get("/api/scheduler/last-run", (_req, res) => {
    res.json(getLastRunResult());
  });

  app.get("/api/scheduler/days", (_req, res) => {
    res.json(getDayNames());
  });

  app.get("/api/archiver/preview", async (_req, res) => {
    try {
      const result = await previewEligible();
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao verificar elegíveis";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/archiver/status", (_req, res) => {
    try {
      const status = getArchiverStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Falha ao obter status do arquivamento" });
    }
  });

  app.post("/api/archiver/run", async (_req, res) => {
    try {
      const result = await runArchiver();
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao executar arquivamento";
      if (message.includes("already running")) {
        res.status(409).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  app.get("/api/archiver/last-run", (_req, res) => {
    res.json(getLastArchiverRun());
  });

  // ======= LIMPEZA (SELECTIVE CLEANUP) API ROUTES =======

  app.get("/api/limpeza/preview", async (req, res) => {
    try {
      const siteId = parseInt(req.query.site_id as string, 10);
      const dateFrom = req.query.date_from as string;
      const dateTo = req.query.date_to as string;

      if (!siteId || isNaN(siteId) || siteId < 1) {
        return res.status(400).json({ error: "site_id é obrigatório e deve ser um número positivo" });
      }
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ error: "date_from e date_to são obrigatórios" });
      }
      if (isNaN(new Date(dateFrom).getTime()) || isNaN(new Date(dateTo).getTime())) {
        return res.status(400).json({ error: "Datas inválidas" });
      }
      if (new Date(dateFrom) > new Date(dateTo)) {
        return res.status(400).json({ error: "date_from deve ser anterior a date_to" });
      }

      const result = await previewLimpeza(siteId, dateFrom, dateTo);
      res.json(result);
    } catch (error) {
      console.error("Error previewing limpeza:", error);
      res.status(500).json({
        error: "Falha ao buscar preview da limpeza",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.post("/api/limpeza/execute", async (req, res) => {
    try {
      const { site_id, date_from, date_to } = req.body;

      if (!site_id || typeof site_id !== "number" || site_id < 1) {
        return res.status(400).json({ error: "site_id é obrigatório e deve ser um número positivo" });
      }
      if (!date_from || !date_to) {
        return res.status(400).json({ error: "date_from e date_to são obrigatórios" });
      }
      if (isNaN(new Date(date_from).getTime()) || isNaN(new Date(date_to).getTime())) {
        return res.status(400).json({ error: "Datas inválidas" });
      }
      if (new Date(date_from) > new Date(date_to)) {
        return res.status(400).json({ error: "date_from deve ser anterior a date_to" });
      }

      const result = await executeLimpeza(site_id, date_from, date_to);
      res.json(result);
    } catch (error) {
      console.error("Error executing limpeza:", error);
      res.status(500).json({
        error: "Falha ao executar limpeza",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  await initScheduler();
  initArchiver();

  return httpServer;
}
