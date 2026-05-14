import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import OpenAI from "openai";
import { z } from "zod";
import { browserPool } from "./internal-scraper/browser-pool.js";
import { checkDuplicateLeilao, normalizeUrl } from "./directus";
import { getOpenAIApiKey, isOpenAIKeyConfigured, trackUsage } from "./openai-usage";

const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim() || "";
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim() || "";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_CRON = "0 */4 * * *";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_SKIP_HOSTS = ["venda-imoveis.caixa.gov.br"];
const HTTP_TIMEOUT_MS = 15_000;
const PLAYWRIGHT_TIMEOUT_MS = 35_000;
const OPENAI_TIMEOUT_MS = 45_000;
const ITEM_TIMEOUT_MS = 120_000;
const OPENAI_RETRIES = 2;
const ERROR_OUTPUT_LIMIT = 4000;
const MAX_TEXT_CHARS = 60_000;

type FetchMode = "http" | "http_playwright" | "playwright";
type UrlProcessingOutcome =
  | "created"
  | "duplicate"
  | "not_individual"
  | "dry_run_created"
  | "dry_run_duplicate"
  | "dry_run_not_individual"
  | "error"
  | "skipped";

export interface UrlConsultaQueueItem {
  id: number;
  url: string | null;
  site_origem: number | null;
  status_processamento: string | null;
  classifica: string | null;
  date_created?: string | null;
}

export interface AuctionExtractorConfig {
  enabled: boolean;
  cronExpression: string;
  batchSize: number;
  concurrency: number;
  fetchMode: FetchMode;
  model: string;
  skipHosts: string[];
}

export interface AuctionExtractorRunOptions {
  limit?: number;
  dryRun?: boolean;
  source?: "manual" | "cron";
  runId?: string;
}

export interface AuctionExtractorRunSummary {
  runId: string;
  source: "manual" | "cron";
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  limit: number;
  processed: number;
  created: number;
  duplicates: number;
  notIndividual: number;
  errors: number;
  skipped: number;
  cancelled: boolean;
  items: Array<{
    id: number;
    url: string;
    outcome: UrlProcessingOutcome;
    leilaoId?: number;
    message?: string;
    preview?: Record<string, unknown>;
  }>;
}

export interface AuctionExtractorStatus {
  config: AuctionExtractorConfig;
  running: boolean;
  currentRun: {
    runId: string;
    source: "manual" | "cron";
    dryRun: boolean;
    startedAt: string;
    currentItem?: string | null;
    processed: number;
    total: number;
  } | null;
  lastRun: AuctionExtractorRunSummary | null;
  queue: {
    pending: number;
    processed: number;
    errors: number;
    totalIndividual: number;
  };
  cronActive: boolean;
}

const extractionSchema = z.object({
  is_individual_item: z.boolean().optional().default(false),
  reason: z.string().optional().default(""),
  nome_do_anuncio: z.union([z.string(), z.number()]).optional().default(""),
  descricao: z.union([z.string(), z.number()]).optional().default(""),
  area_imovel: z.union([z.string(), z.number()]).optional().default(""),
  tipo_do_imovel: z.union([z.string(), z.number()]).optional().default(""),
  tipo_de_leilao: z.union([z.string(), z.number()]).optional().default(""),
  nome_leiloeiro: z.union([z.string(), z.number()]).optional().default(""),
  numero_do_processo: z.union([z.string(), z.number()]).optional().default(""),
  valor_avalaiacao_imovel: z.union([z.string(), z.number()]).optional().default(""),
  valor_leilao: z.union([z.string(), z.number()]).optional().default(""),
  valor_do_leilao: z.union([z.string(), z.number()]).optional().default(""),
  valor_praca1: z.union([z.string(), z.number()]).optional().default(""),
  valor_praca2: z.union([z.string(), z.number()]).optional().default(""),
  valor_praca3: z.union([z.string(), z.number()]).optional().default(""),
  desconto: z.union([z.string(), z.number()]).optional().default(""),
  praca_1: z.union([z.string(), z.number()]).optional().default(""),
  praca_2: z.union([z.string(), z.number()]).optional().default(""),
  praca_3: z.union([z.string(), z.number()]).optional().default(""),
  link_edital: z.union([z.string(), z.number()]).optional().default(""),
  link_matricula: z.union([z.string(), z.number()]).optional().default(""),
  cep: z.union([z.string(), z.number()]).optional().default(""),
  cidade: z.union([z.string(), z.number()]).optional().default(""),
  estado_uf: z.union([z.string(), z.number()]).optional().default(""),
  bairro: z.union([z.string(), z.number()]).optional().default(""),
  logradouro: z.union([z.string(), z.number()]).optional().default(""),
  numero: z.union([z.string(), z.number()]).optional().default(""),
  link_imagem: z.union([z.string(), z.number()]).optional().default(""),
});

type ExtractedAuctionPage = z.infer<typeof extractionSchema>;

let cronTask: ScheduledTask | null = null;
let runningPromise: Promise<AuctionExtractorRunSummary> | null = null;
let activeAbortController: AbortController | null = null;
let lastRun: AuctionExtractorRunSummary | null = null;
let currentRunState: AuctionExtractorStatus["currentRun"] = null;
const inFlightUrlIds = new Set<number>();

function envBoolean(value: string | undefined, fallback = false): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(value.toLowerCase());
}

function envNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function getAuctionExtractorConfig(): AuctionExtractorConfig {
  const rawFetchMode = process.env.AUCTION_EXTRACTOR_FETCH_MODE || "http_playwright";
  const fetchMode: FetchMode = rawFetchMode === "http" || rawFetchMode === "playwright"
    ? rawFetchMode
    : "http_playwright";

  return {
    enabled: envBoolean(process.env.AUCTION_EXTRACTOR_ENABLED, false),
    cronExpression: process.env.AUCTION_EXTRACTOR_CRON || DEFAULT_CRON,
    batchSize: envNumber(process.env.AUCTION_EXTRACTOR_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 100),
    concurrency: envNumber(process.env.AUCTION_EXTRACTOR_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 8),
    fetchMode,
    model: process.env.AUCTION_EXTRACTOR_MODEL || DEFAULT_MODEL,
    skipHosts: (process.env.AUCTION_EXTRACTOR_SKIP_HOSTS || DEFAULT_SKIP_HOSTS.join(","))
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/^www\./, ""))
      .filter(Boolean),
  };
}

function assertDirectusConfigured(): void {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }
}

function createRunId(): string {
  return `extract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncate(value: unknown, max = ERROR_OUTPUT_LIMIT): string {
  const text = value instanceof Error ? value.message : String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... [truncated ${text.length - max} chars]`;
}

async function directusRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  assertDirectusConfigured();
  const response = await fetch(`${DIRECTUS_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Directus ${response.status}: ${truncate(body, 1000)}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function countUrlConsulta(params: Record<string, string>): Promise<number> {
  const query = new URLSearchParams();
  query.set("aggregate[count]", "id");
  for (const [key, value] of Object.entries(params)) {
    query.set(key, value);
  }

  const result = await directusRequest<{ data?: Array<{ count?: { id?: string | number } }> }>(
    `/items/url_consulta?${query.toString()}`,
  );
  return Number(result.data?.[0]?.count?.id || 0);
}

async function getQueueStats(): Promise<AuctionExtractorStatus["queue"]> {
  try {
    const base = { "filter[classifica][_eq]": "imóvel individual" };
    const [pending, processed, errors, totalIndividual] = await Promise.all([
      countUrlConsulta({ ...base, "filter[status_processamento][_eq]": "não processado" }),
      countUrlConsulta({ ...base, "filter[status_processamento][_eq]": "processado" }),
      countUrlConsulta({ ...base, "filter[status_processamento][_eq]": "erro" }),
      countUrlConsulta(base),
    ]);
    return { pending, processed, errors, totalIndividual };
  } catch {
    return { pending: 0, processed: 0, errors: 0, totalIndividual: 0 };
  }
}

async function fetchPendingUrls(limit: number): Promise<UrlConsultaQueueItem[]> {
  const query = new URLSearchParams();
  query.set("limit", String(limit));
  query.set("sort", "date_created");
  query.set("fields", "id,url,site_origem,status_processamento,classifica,date_created");
  query.set("filter[status_processamento][_eq]", "não processado");
  query.set("filter[classifica][_eq]", "imóvel individual");

  const result = await directusRequest<{ data?: UrlConsultaQueueItem[] }>(
    `/items/url_consulta?${query.toString()}`,
  );

  return (result.data || []).filter((item) => !inFlightUrlIds.has(item.id));
}

async function updateUrlConsulta(
  id: number,
  patch: { status_processamento: "processado" | "erro"; erro_output?: string | null },
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await directusRequest(`/items/url_consulta/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function getSiteBaseUrl(siteId: number | null): Promise<string | null> {
  if (!siteId) return null;
  try {
    const result = await directusRequest<{ data?: { url_site?: string | null; url_listagem?: string | null } }>(
      `/items/input_library_url/${siteId}?fields=url_site,url_listagem`,
    );
    return result.data?.url_site || result.data?.url_listagem || null;
  } catch {
    return null;
  }
}

export function normalizeAuctionUrl(rawUrl: string, baseUrl?: string | null): string {
  const cleaned = rawUrl.trim().replace(/&amp;/g, "&");
  if (!cleaned) return "";

  try {
    const base = baseUrl ? ensureProtocol(baseUrl) : undefined;
    const parsed = base ? new URL(cleaned, base) : new URL(ensureProtocol(cleaned));
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid|ttclid)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return cleaned;
  }
}

function ensureProtocol(url: string): string {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(url) ? url : `https://${url}`;
}

function absolutizeOptionalUrl(value: unknown, baseUrl: string): string {
  const text = toText(value);
  if (!text) return "";
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return text;
  }
}

function getHostname(value: string): string {
  try {
    return new URL(ensureProtocol(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function getWwwFallbackUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(ensureProtocol(rawUrl));
    if (!parsed.hostname || parsed.hostname.toLowerCase().startsWith("www.")) return null;
    parsed.hostname = `www.${parsed.hostname}`;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isSkippedHost(url: string, config = getAuctionExtractorConfig()): boolean {
  const host = getHostname(url);
  return !!host && config.skipHosts.some((skipHost) => host === skipHost || host.endsWith(`.${skipHost}`));
}

async function fetchWithTimeout(url: string, timeoutMs: number, signal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
      },
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

function createLinkedAbortController(parentSignal?: AbortSignal, timeoutMs = ITEM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onAbort, { once: true });

  return {
    controller,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout!);
  }
}

function isHtmlInsufficient(html: string): boolean {
  const compact = html.replace(/\s+/g, " ").trim().toLowerCase();
  if (compact.length < 500) return true;
  return /enable javascript|habilite o javascript|checking your browser|cf-browser-verification|access denied|403 forbidden|captcha|recaptcha|verifica[cç][aã]o de seguran[cç]a|nao sou um robo|não sou um robô/.test(compact);
}

async function fetchHtmlHttp(url: string, signal: AbortSignal): Promise<{ html: string; url: string }> {
  const response = await fetchWithTimeout(url, HTTP_TIMEOUT_MS, signal);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching auction page`);
  }
  return {
    html: await response.text(),
    url: response.url || url,
  };
}

async function fetchHtmlHttpWithWwwFallback(url: string, signal: AbortSignal): Promise<{ html: string; url: string }> {
  try {
    return await fetchHtmlHttp(url, signal);
  } catch (error) {
    const fallbackUrl = getWwwFallbackUrl(url);
    if (!fallbackUrl) throw error;

    try {
      return await fetchHtmlHttp(fallbackUrl, signal);
    } catch (fallbackError) {
      throw new Error(`${truncate(error, 500)}; www fallback failed: ${truncate(fallbackError, 500)}`);
    }
  }
}

async function fetchHtmlPlaywright(url: string, signal: AbortSignal): Promise<{ html: string; url: string }> {
  const timer = setTimeout(() => {
    if (!signal.aborted) {
      console.warn(`[AuctionExtractor] Playwright still loading after ${PLAYWRIGHT_TIMEOUT_MS}ms: ${url}`);
    }
  }, PLAYWRIGHT_TIMEOUT_MS);

  const handle = await withTimeout(
    browserPool.acquire(),
    15_000,
    "Playwright browser acquire timeout",
  );
  try {
    if (signal.aborted) throw new Error("cancelled");
    await handle.page.goto(url, { waitUntil: "domcontentloaded", timeout: PLAYWRIGHT_TIMEOUT_MS });
    await handle.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return {
      html: await withTimeout(handle.page.content(), 5_000, "Playwright page content timeout"),
      url: handle.page.url(),
    };
  } finally {
    clearTimeout(timer);
    try {
      await handle.context.close();
    } catch {}
    await browserPool.release(handle.browser);
  }
}

async function fetchAuctionHtml(url: string, mode: FetchMode, signal: AbortSignal): Promise<{ html: string; strategy: "http" | "playwright"; url: string }> {
  if (mode === "playwright") {
    const result = await fetchHtmlPlaywright(url, signal);
    return { ...result, strategy: "playwright" };
  }

  let httpError: unknown;
  let effectiveUrl = url;
  if (mode === "http" || mode === "http_playwright") {
    try {
      const result = await fetchHtmlHttpWithWwwFallback(url, signal);
      effectiveUrl = result.url || url;
      if (mode === "http" || !isHtmlInsufficient(result.html)) {
        return { ...result, strategy: "http" };
      }
      httpError = new Error("HTTP content looked insufficient; trying Playwright");
    } catch (error) {
      httpError = error;
      if (mode === "http") throw error;
    }
  }

  try {
    const result = await fetchHtmlPlaywright(effectiveUrl, signal);
    return { ...result, strategy: "playwright" };
  } catch (playwrightError) {
    if (httpError) {
      throw new Error(`${truncate(httpError, 500)}; Playwright fallback failed: ${truncate(playwrightError, 500)}`);
    }
    throw playwrightError;
  }
}

function decodeEntities(str = ""): string {
  const map: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
  };
  return str.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (match) => map[match] || match);
}

function cleanText(text = ""): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPdf(url = ""): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

export function cleanAuctionHtmlForExtraction(rawHtml: string): { text: string; pdfUrls: string[] } {
  const pdfRegex = /(?:https?:\/\/[^\s"'<]+|\/[^\s"'<]+)\.pdf(?:\?[^\s"'<]*)?/gi;
  const pdfUrls = [...new Set(rawHtml.match(pdfRegex) || [])];

  let html = rawHtml;
  html = html.replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, " ");
  html = html.replace(/<(header|footer|nav)[\s\S]*?<\/\1>/gi, " ");
  html = html.replace(/<(meta|link)[^>]*>/gi, " ");
  html = html.replace(/<!--[\s\S]*?-->/g, " ");

  html = html.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, url, label) => {
      const labelText = cleanText(label);
      if (isPdf(url)) return `[PDF: ${labelText || "arquivo"}] (${url})`;
      return `${labelText || url} (${url})`;
    },
  );

  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = (tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    if (!src) return "";
    if (isPdf(src)) return `[PDF: ${alt || "arquivo"}] (${src})`;
    if (alt) return `[IMG: ${alt}] (${src})`;
    return `[IMG] (${src})`;
  });

  html = html.replace(
    /<(iframe|embed|object)\b[^>]*(src|data)\s*=\s*["']([^"']+)["'][^>]*>/gi,
    (_match, _tag, _attr, url) => (isPdf(url) ? `[PDF incorporado] (${url})` : ""),
  );

  html = html.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])>/gi, "\n");
  html = html.replace(/<[^>]+>/g, " ");
  html = decodeEntities(html);

  let mainText = cleanText(html);
  const pdfBlock = pdfUrls.length
    ? `\n\n====================\nPDFS ENCONTRADOS:\n${pdfUrls.map((url, index) => `[PDF_${index + 1}] ${url}`).join("\n")}`
    : "";

  const allowedMain = Math.max(MAX_TEXT_CHARS - pdfBlock.length, 2000);
  if (mainText.length > allowedMain) {
    mainText = mainText.slice(0, allowedMain);
  }

  return { text: mainText + pdfBlock, pdfUrls };
}

const EXTRACTION_SYSTEM_PROMPT = `You extract data from auction websites.

Set only one flag first:
- is_individual_item = true ONLY if the page is ONE specific lot/property
  (titulo unico do lote, ID/slug do lote, valores do lote, datas de 1a/2a/3a praca,
   links de edital/matricula e endereco do imovel). Ignore header/footer/relacionados.
- Otherwise set is_individual_item = false.

If is_individual_item = false:
- Return only is_individual_item (false) and an optional short reason.

If is_individual_item = true:
- Fill the attributes in the requested JSON schema. Do not invent; use "" when missing.
- Dates must be ISO-like strings, for example 2025-11-07T12:00:00.
- Monetary values should keep the Brazilian format when present.
- If the auction is not for real estate, is_individual_item must be false.

Return only JSON.`;

function extractionUserPrompt(pageUrl: string, text: string): string {
  return `URL do anuncio: ${pageUrl}

Extraia os campos:
nome_do_anuncio, descricao, area_imovel, tipo_do_imovel, tipo_de_leilao,
nome_leiloeiro, numero_do_processo, valor_avalaiacao_imovel, valor_leilao,
valor_do_leilao, valor_praca1, valor_praca2, valor_praca3, desconto,
praca_1, praca_2, praca_3, link_edital, link_matricula, cep, cidade,
estado_uf, bairro, logradouro, numero, link_imagem, is_individual_item.

Texto limpo da pagina:
${text}`;
}

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: getOpenAIApiKey() });
}

async function callOpenAIExtractor(text: string, pageUrl: string, model: string, signal?: AbortSignal): Promise<ExtractedAuctionPage> {
  if (!isOpenAIKeyConfigured()) {
    throw new Error("OPENAI_API_KEY nao configurada");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= OPENAI_RETRIES + 1; attempt++) {
    if (signal?.aborted) throw new Error("cancelled");
    const linked = createLinkedAbortController(signal, OPENAI_TIMEOUT_MS);
    try {
      const response = await getOpenAIClient().chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            { role: "user", content: extractionUserPrompt(pageUrl, text) },
          ],
          temperature: 0.1,
          max_tokens: 16_384,
          response_format: { type: "json_object" },
        },
        {
          timeout: OPENAI_TIMEOUT_MS,
          signal: linked.controller.signal,
        },
      );

      if (response.usage) {
        trackUsage(
          model,
          "auction_page_extraction",
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          pageUrl,
        );
      }

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("OpenAI returned empty response");

      const parsed = JSON.parse(content);
      const rawOutput = parsed.output && typeof parsed.output === "object" ? parsed.output : parsed;
      const validation = extractionSchema.safeParse(rawOutput);
      if (!validation.success) {
        throw new Error(`Invalid extraction JSON: ${validation.error.message}`);
      }
      return validation.data;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw new Error("cancelled");
      if (attempt <= OPENAI_RETRIES) {
        await sleep(800 * attempt);
      }
    } finally {
      linked.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function toText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function dateForDirectus(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (isoMatch) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`.substring(0, 19);
  }

  const brMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*(?:-|as|às)?\s*(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?/i);
  if (brMatch) {
    const [, rawDay, rawMonth, year, rawHour = "00", rawMinute = "00", rawSecond = "00"] = brMatch;
    const day = rawDay.padStart(2, "0");
    const month = rawMonth.padStart(2, "0");
    const hour = rawHour.padStart(2, "0");
    const minute = rawMinute.padStart(2, "0");
    const second = rawSecond.padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  return text.replace("T", " ").substring(0, 19);
}

const STATE_NAME_TO_UF: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

function normalizeStateUf(value: unknown): string {
  const text = toText(value);
  if (!text) return "";
  const upper = text.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return STATE_NAME_TO_UF[normalized] || upper.slice(0, 2);
}

function foldForSearch(value: unknown): string {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasRealEstateExtractionSignal(output: ExtractedAuctionPage): boolean {
  const type = foldForSearch(output.tipo_do_imovel);
  const title = foldForSearch(output.nome_do_anuncio);
  const area = foldForSearch(output.area_imovel);

  if (/(apartamento|casa|terreno|predio|edificio|galpao|sala|loja|imovel|fazenda|sitio|chacara|lote de terreno|area rural|area urbana)/.test(type)) {
    return true;
  }

  if (/(apartamento|casa|terreno|predio|edificio|galpao|imovel|fazenda|sitio|chacara|area total|area construida)/.test(title)) {
    return true;
  }

  if (area && /(\bm2\b|m²|metro|hectare|ha\b|alqueire)/.test(area)) {
    return true;
  }

  if (toText(output.link_matricula)) return true;
  return false;
}

export function detectNonRealEstateExtraction(
  output: ExtractedAuctionPage,
  pageUrl: string,
  pageText = "",
): string | null {
  const title = foldForSearch(output.nome_do_anuncio);
  const type = foldForSearch(output.tipo_do_imovel);
  const url = foldForSearch(pageUrl);
  const sample = foldForSearch(pageText).slice(0, 20_000);
  const focusedText = `${title} ${type} ${url}`;

  const strongNonRealEstate = /(sucata|veicul|carro|moto|motocicleta|caminhao|caminhonete|utilitario|onibus|renavam|chassi|placa|fiat\/|vw\/|volkswagen|chevrolet|ford\/|honda\/|yamaha)/;
  const weakNonRealEstate = /(maquina|equipamento|expositor|refrigerad|freezer|geladeira|balcao|joia|informatica|notebook|celular|semovente|gado|embarcacao|bem movel|bens moveis)/;

  if (strongNonRealEstate.test(focusedText) && !hasRealEstateExtractionSignal(output)) {
    return "Pagina aparenta ser veiculo/sucata, sem sinais suficientes de imovel";
  }

  if (weakNonRealEstate.test(focusedText) && !hasRealEstateExtractionSignal(output)) {
    return "Pagina aparenta nao ser de imovel";
  }

  if (strongNonRealEstate.test(sample) && !hasRealEstateExtractionSignal(output)) {
    return "Conteudo da pagina indica veiculo/sucata, sem sinais suficientes de imovel";
  }

  return null;
}

export function buildLeilaoPayload(output: ExtractedAuctionPage, pageUrl: string, siteId: number | null): Record<string, unknown> {
  const valorLeilao = toText(output.valor_leilao) || toText(output.valor_do_leilao);

  return {
    status: "published",
    nome_do_anuncio: toText(output.nome_do_anuncio),
    descricao: toText(output.descricao),
    area_imovel: toText(output.area_imovel),
    tipo_do_imovel: toText(output.tipo_do_imovel),
    tipo_de_leilao: toText(output.tipo_de_leilao),
    nome_leiloeiro: toText(output.nome_leiloeiro),
    numero_do_processo: toText(output.numero_do_processo),
    valor_avalaiacao_imovel: toText(output.valor_avalaiacao_imovel),
    valor_leilao: valorLeilao,
    valor_praca1: toText(output.valor_praca1),
    valor_praca2: toText(output.valor_praca2),
    valor_praca3: toText(output.valor_praca3),
    desconto: toText(output.desconto),
    praca_1: dateForDirectus(output.praca_1),
    praca_2: dateForDirectus(output.praca_2),
    praca_3: dateForDirectus(output.praca_3),
    link_edital: absolutizeOptionalUrl(output.link_edital, pageUrl),
    link_matricula: absolutizeOptionalUrl(output.link_matricula, pageUrl),
    cep: toText(output.cep),
    cidade: toText(output.cidade),
    estado_uf: normalizeStateUf(output.estado_uf),
    bairro: toText(output.bairro),
    logradouro: toText(output.logradouro),
    numero: toText(output.numero),
    link_anuncio: pageUrl,
    link_imagem: absolutizeOptionalUrl(output.link_imagem, pageUrl),
    site: siteId,
  };
}

function buildDryRunPreview(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    nome_do_anuncio: payload.nome_do_anuncio,
    descricao: payload.descricao,
    area_imovel: payload.area_imovel,
    tipo_do_imovel: payload.tipo_do_imovel,
    tipo_de_leilao: payload.tipo_de_leilao,
    nome_leiloeiro: payload.nome_leiloeiro,
    numero_do_processo: payload.numero_do_processo,
    valor_avalaiacao_imovel: payload.valor_avalaiacao_imovel,
    valor_leilao: payload.valor_leilao,
    valor_praca1: payload.valor_praca1,
    valor_praca2: payload.valor_praca2,
    valor_praca3: payload.valor_praca3,
    desconto: payload.desconto,
    praca_1: payload.praca_1,
    praca_2: payload.praca_2,
    praca_3: payload.praca_3,
    cep: payload.cep,
    cidade: payload.cidade,
    estado_uf: payload.estado_uf,
    bairro: payload.bairro,
    logradouro: payload.logradouro,
    numero: payload.numero,
    link_edital: payload.link_edital,
    link_matricula: payload.link_matricula,
    link_imagem: payload.link_imagem,
  };
}

async function createLeilaoFromPayload(payload: Record<string, unknown>, dryRun: boolean): Promise<{ id?: number }> {
  if (dryRun) return {};

  const result = await directusRequest<{ data?: { id?: number } }>("/items/leiloes_imovel", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { id: result.data?.id };
}

export async function previewAuctionPageExtraction(
  rawUrl: string,
  siteId: number | null = null,
): Promise<{
  url: string;
  outcome: "would_create" | "not_individual";
  strategy: "http" | "playwright";
  message: string;
  preview?: Record<string, unknown>;
}> {
  const config = getAuctionExtractorConfig();
  const linked = createLinkedAbortController(undefined, ITEM_TIMEOUT_MS);
  try {
    const pageUrl = normalizeAuctionUrl(rawUrl);
    if (isSkippedHost(pageUrl, config)) {
      return {
        url: pageUrl,
        outcome: "not_individual",
        strategy: "http",
        message: "Dominio fora do escopo deste extrator",
      };
    }
    const { html, strategy, url: effectiveUrl } = await fetchAuctionHtml(pageUrl, config.fetchMode, linked.controller.signal);
    const cleaned = cleanAuctionHtmlForExtraction(html);
    const output = await callOpenAIExtractor(cleaned.text, effectiveUrl, config.model, linked.controller.signal);
    const nonRealEstateReason = detectNonRealEstateExtraction(output, effectiveUrl, cleaned.text);

    if (!output.is_individual_item || nonRealEstateReason) {
      return {
        url: effectiveUrl,
        outcome: "not_individual",
        strategy,
        message: nonRealEstateReason || output.reason || "Nao e imovel individual",
      };
    }

    const payload = buildLeilaoPayload(output, effectiveUrl, siteId);
    return {
      url: effectiveUrl,
      outcome: "would_create",
      strategy,
      message: "Preview extraido com sucesso",
      preview: buildDryRunPreview(payload),
    };
  } finally {
    linked.cleanup();
  }
}

async function processQueueItem(
  item: UrlConsultaQueueItem,
  config: AuctionExtractorConfig,
  dryRun: boolean,
  signal: AbortSignal,
): Promise<AuctionExtractorRunSummary["items"][number]> {
  inFlightUrlIds.add(item.id);
  const linked = createLinkedAbortController(signal, ITEM_TIMEOUT_MS);
  try {
    if (linked.controller.signal.aborted) {
      return { id: item.id, url: item.url || "", outcome: "skipped", message: "cancelled" };
    }

    const baseUrl = await getSiteBaseUrl(item.site_origem);
    const pageUrl = normalizeAuctionUrl(item.url || "", baseUrl);
    if (!pageUrl) {
      throw new Error("URL vazia ou invalida");
    }

    if (isSkippedHost(pageUrl, config)) {
      await updateUrlConsulta(item.id, { status_processamento: "processado", erro_output: null }, dryRun);
      return {
        id: item.id,
        url: pageUrl,
        outcome: dryRun ? "dry_run_not_individual" : "not_individual",
        message: "Dominio fora do escopo deste extrator",
      };
    }

    currentRunState = currentRunState ? { ...currentRunState, currentItem: pageUrl } : currentRunState;

    const duplicate = await checkDuplicateLeilao(pageUrl);
    if (duplicate) {
      await updateUrlConsulta(item.id, { status_processamento: "processado", erro_output: null }, dryRun);
      return {
        id: item.id,
        url: pageUrl,
        outcome: dryRun ? "dry_run_duplicate" : "duplicate",
        leilaoId: duplicate.id,
        message: `Duplicata leilao #${duplicate.id}`,
      };
    }

    const { html, strategy, url: effectiveUrl } = await fetchAuctionHtml(pageUrl, config.fetchMode, linked.controller.signal);
    const cleaned = cleanAuctionHtmlForExtraction(html);
    const output = await callOpenAIExtractor(cleaned.text, effectiveUrl, config.model, linked.controller.signal);
    const nonRealEstateReason = detectNonRealEstateExtraction(output, effectiveUrl, cleaned.text);

    if (!output.is_individual_item || nonRealEstateReason) {
      await updateUrlConsulta(item.id, { status_processamento: "processado", erro_output: null }, dryRun);
      return {
        id: item.id,
        url: effectiveUrl,
        outcome: dryRun ? "dry_run_not_individual" : "not_individual",
        message: nonRealEstateReason || output.reason || `Nao e imovel individual (${strategy})`,
      };
    }

    const payload = buildLeilaoPayload(output, effectiveUrl, item.site_origem);
    const created = await createLeilaoFromPayload(payload, dryRun);
    await updateUrlConsulta(item.id, { status_processamento: "processado", erro_output: null }, dryRun);

    return {
      id: item.id,
      url: effectiveUrl,
      outcome: dryRun ? "dry_run_created" : "created",
      leilaoId: created.id,
      message: `Extraido via ${strategy}`,
      preview: dryRun ? buildDryRunPreview(payload) : undefined,
    };
  } catch (error) {
    const message = truncate(error);
    await updateUrlConsulta(item.id, { status_processamento: "erro", erro_output: message }, dryRun).catch(() => {});
    return { id: item.id, url: item.url || "", outcome: "error", message };
  } finally {
    linked.cleanup();
    inFlightUrlIds.delete(item.id);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function runOne(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}

function applyOutcome(summary: AuctionExtractorRunSummary, item: AuctionExtractorRunSummary["items"][number]): void {
  summary.processed++;
  if (item.outcome === "created" || item.outcome === "dry_run_created") summary.created++;
  else if (item.outcome === "duplicate" || item.outcome === "dry_run_duplicate") summary.duplicates++;
  else if (item.outcome === "not_individual" || item.outcome === "dry_run_not_individual") summary.notIndividual++;
  else if (item.outcome === "error") summary.errors++;
  else if (item.outcome === "skipped") summary.skipped++;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAuctionExtractor(options: AuctionExtractorRunOptions = {}): Promise<AuctionExtractorRunSummary> {
  if (runningPromise) {
    throw new Error("Extrator ja esta em execucao");
  }

  const config = getAuctionExtractorConfig();
  const limit = envNumber(String(options.limit || ""), config.batchSize, 1, 100);
  const source = options.source || "manual";
  const dryRun = !!options.dryRun;
  const runId = options.runId || createRunId();
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  activeAbortController = controller;
  currentRunState = {
    runId,
    source,
    dryRun,
    startedAt,
    currentItem: null,
    processed: 0,
    total: 0,
  };

  const run = (async () => {
    const pending = await fetchPendingUrls(limit);
    const summary: AuctionExtractorRunSummary = {
      runId,
      source,
      dryRun,
      startedAt,
      completedAt: startedAt,
      limit,
      processed: 0,
      created: 0,
      duplicates: 0,
      notIndividual: 0,
      errors: 0,
      skipped: 0,
      cancelled: false,
      items: [],
    };

    if (currentRunState?.runId === runId) {
      currentRunState = { ...currentRunState, total: pending.length };
    }

    console.log(`[AuctionExtractor] Run ${runId} iniciado: ${pending.length} URL(s), dryRun=${dryRun}`);

    const results = await mapWithConcurrency(pending, config.concurrency, async (item) => {
      if (controller.signal.aborted) {
        return { id: item.id, url: item.url || "", outcome: "skipped" as const, message: "cancelled" };
      }
      const result = await processQueueItem(item, config, dryRun, controller.signal);
      if (currentRunState) {
        currentRunState.processed++;
      }
      return result;
    });

    for (const result of results) {
      summary.items.push(result);
      applyOutcome(summary, result);
    }

    summary.cancelled = controller.signal.aborted;
    summary.completedAt = new Date().toISOString();
    lastRun = summary;
    console.log(
      `[AuctionExtractor] Run ${runId} finalizado: created=${summary.created}, duplicates=${summary.duplicates}, notIndividual=${summary.notIndividual}, errors=${summary.errors}, dryRun=${dryRun}`,
    );
    return summary;
  })();

  runningPromise = run;

  try {
    return await run;
  } finally {
    runningPromise = null;
    activeAbortController = null;
    currentRunState = null;
  }
}

export function startAuctionExtractorRun(options: AuctionExtractorRunOptions = {}): { runId: string; running: true } {
  if (runningPromise || currentRunState) {
    throw new Error("Extrator ja esta em execucao");
  }
  const runId = createRunId();
  const promise = runAuctionExtractor({ ...options, runId }).catch((error) => {
    console.error("[AuctionExtractor] Run falhou:", truncate(error));
    throw error;
  });
  promise.catch(() => {});

  return { runId, running: true };
}

export function cancelAuctionExtractor(): boolean {
  if (!activeAbortController) return false;
  activeAbortController.abort();
  return true;
}

export async function getAuctionExtractorStatus(): Promise<AuctionExtractorStatus> {
  return {
    config: getAuctionExtractorConfig(),
    running: !!runningPromise,
    currentRun: currentRunState,
    lastRun,
    queue: await getQueueStats(),
    cronActive: !!cronTask,
  };
}

export function initAuctionExtractor(): void {
  const config = getAuctionExtractorConfig();
  if (!config.enabled) {
    console.log("[AuctionExtractor] Worker desabilitado (AUCTION_EXTRACTOR_ENABLED=false)");
    return;
  }

  if (!cron.validate(config.cronExpression)) {
    console.error(`[AuctionExtractor] Cron invalido: ${config.cronExpression}`);
    return;
  }

  cronTask = cron.schedule(config.cronExpression, () => {
    if (runningPromise) {
      console.log("[AuctionExtractor] Run ja em andamento; cron ignorado");
      return;
    }
    runAuctionExtractor({ source: "cron" }).catch((error) => {
      console.error("[AuctionExtractor] Cron run falhou:", truncate(error));
    });
  }, {
    timezone: "America/Sao_Paulo",
  });

  console.log(`[AuctionExtractor] Worker ativo: ${config.cronExpression}`);
}
