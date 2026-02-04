import type { Express } from "express";
import { createServer, type Server } from "http";
import { getDashboardStats, getDetailedLogs, getSites, createLeilao, findSiteByUrl } from "./directus";
import { leilaoInsertSchema } from "@shared/schema";
import { extractAuctionDataFromImage } from "./openai";

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

  return httpServer;
}
