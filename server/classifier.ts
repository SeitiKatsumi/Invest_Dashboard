import { getOpenAIApiKey, isOpenAIKeyConfigured } from "./openai-usage.js";
import { trackUsage } from "./openai-usage.js";
import { deleteLeilaoItems } from "./directus.js";

const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();

const BATCH_SIZE = 100;
const SYSTEM_PROMPT = `Você é um classificador de leilões. Sua tarefa é determinar se cada item é um IMÓVEL ou NÃO-IMÓVEL.

IMÓVEL inclui: casa, apartamento, terreno, lote, sala comercial, galpão, fazenda, sítio, chácara, prédio, cobertura, flat, kitnet, sobrado, edícula, barracão, box de estacionamento, vaga de garagem, área rural, gleba, fração ideal, direitos sobre imóvel, edificação, loja, escritório, ponto comercial, hotel, pousada, resort.

NÃO-IMÓVEL inclui: veículo, carro, moto, caminhão, ônibus, embarcação, aeronave, máquina, equipamento, móvel, eletrodoméstico, eletrônico, animal, mercadoria, estoque, material, peça, ferramenta, sucata, crédito, direito creditório, título, cota, ação, joia, obra de arte, objeto, commodity, óleo, combustível, cadeira, mesa, alimento.

Responda APENAS com um JSON array onde cada elemento é 0 (imóvel) ou 1 (não-imóvel), na mesma ordem dos itens recebidos. Sem explicação, sem texto extra. Exemplo: [0,0,1,0,1]`;

interface ClassifierItem {
  id: number;
  nome_do_anuncio: string;
  tipo_do_imovel: string | null;
  site: number | null;
}

interface ScanProgress {
  status: "running" | "completed" | "error";
  processed: number;
  total: number;
  nonPropertyIds: ClassifierItem[];
  tokensUsed: number;
  estimatedCost: number;
  error?: string;
}

let currentScan: ScanProgress | null = null;
let scanAborted = false;

export function getScanStatus(): ScanProgress | null {
  return currentScan;
}

export function abortScan(): boolean {
  if (currentScan && currentScan.status === "running") {
    scanAborted = true;
    return true;
  }
  return false;
}

export async function getEstimate(): Promise<{
  totalRecords: number;
  estimatedBatches: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
  url.searchParams.set("aggregate[count]", "id");
  url.searchParams.set("filter[nome_do_anuncio][_nnull]", "true");
  url.searchParams.set("filter[nome_do_anuncio][_nempty]", "true");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) throw new Error(`Directus error: ${response.status}`);
  const result = await response.json();
  const totalRecords = parseInt(result.data?.[0]?.count?.id ?? result.data?.[0]?.count ?? "0", 10);
  const estimatedBatches = Math.ceil(totalRecords / BATCH_SIZE);
  const avgInputTokens = 350;
  const avgOutputTokens = 50;
  const estimatedTokens = estimatedBatches * (avgInputTokens + avgOutputTokens);
  const estimatedCostUsd = estimatedBatches * (avgInputTokens * 0.15 / 1_000_000 + avgOutputTokens * 0.60 / 1_000_000);

  return { totalRecords, estimatedBatches, estimatedTokens, estimatedCostUsd };
}

async function fetchAllRecords(): Promise<ClassifierItem[]> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const allItems: ClassifierItem[] = [];
  let page = 1;
  const pageSize = 10000;

  while (true) {
    const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
    url.searchParams.set("fields", "id,nome_do_anuncio,tipo_do_imovel,site");
    url.searchParams.set("filter[nome_do_anuncio][_nnull]", "true");
    url.searchParams.set("filter[nome_do_anuncio][_nempty]", "true");
    url.searchParams.set("sort", "id");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("page", String(page));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Directus error ${response.status} fetching page ${page}`);
    }

    const result = await response.json();
    const items = result.data || [];
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < pageSize) break;
    page++;
  }

  return allItems;
}

async function classifyBatchWithUsage(titles: string[]): Promise<{ classifications: number[]; promptTokens: number; completionTokens: number }> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error("OpenAI API key not configured");

  const userMessage = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
      max_tokens: titles.length * 3 + 20,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || "[]";
  const promptTokens = data.usage?.prompt_tokens || 0;
  const completionTokens = data.usage?.completion_tokens || 0;

  trackUsage("gpt-4o-mini", "classificacao_imovel", promptTokens, completionTokens);

  const jsonMatch = content.match(/\[[\d\s,]+\]/);
  if (!jsonMatch) {
    console.warn("[Classifier] Could not parse response:", content);
    return { classifications: titles.map(() => 0), promptTokens, completionTokens };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as number[];
    while (parsed.length < titles.length) parsed.push(0);
    return { classifications: parsed, promptTokens, completionTokens };
  } catch {
    console.warn("[Classifier] JSON parse error:", content);
    return { classifications: titles.map(() => 0), promptTokens, completionTokens };
  }
}

export async function startScan(): Promise<void> {
  if (currentScan && currentScan.status === "running") {
    throw new Error("Escaneamento já em andamento");
  }

  if (!isOpenAIKeyConfigured()) {
    throw new Error("OPENAI_API_KEY não configurada");
  }

  scanAborted = false;
  currentScan = {
    status: "running",
    processed: 0,
    total: 0,
    nonPropertyIds: [],
    tokensUsed: 0,
    estimatedCost: 0,
  };

  (async () => {
    try {
      console.log("[Classifier] Fetching all records...");
      const allRecords = await fetchAllRecords();
      currentScan!.total = allRecords.length;
      console.log(`[Classifier] ${allRecords.length} records to classify`);

      for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
        if (scanAborted) {
          currentScan!.status = "completed";
          currentScan!.error = "Escaneamento cancelado pelo usuário";
          console.log("[Classifier] Scan aborted by user");
          return;
        }

        const batch = allRecords.slice(i, i + BATCH_SIZE);
        const titles = batch.map((item) => item.nome_do_anuncio || "Sem título");

        try {
          const { classifications, promptTokens, completionTokens } = await classifyBatchWithUsage(titles);
          currentScan!.tokensUsed += promptTokens + completionTokens;
          currentScan!.estimatedCost += promptTokens * 0.15 / 1_000_000 + completionTokens * 0.60 / 1_000_000;

          for (let j = 0; j < classifications.length; j++) {
            if (classifications[j] === 1 && batch[j]) {
              currentScan!.nonPropertyIds.push(batch[j]);
            }
          }
        } catch (err) {
          console.error(`[Classifier] Batch error at offset ${i}:`, err);
        }

        currentScan!.processed = Math.min(i + BATCH_SIZE, allRecords.length);
      }

      currentScan!.status = "completed";
      console.log(`[Classifier] Scan complete: ${currentScan!.nonPropertyIds.length} non-property items found`);
    } catch (err) {
      console.error("[Classifier] Scan error:", err);
      if (currentScan) {
        currentScan.status = "error";
        currentScan.error = err instanceof Error ? err.message : "Erro desconhecido";
      }
    }
  })();
}

export async function cleanupItems(ids: number[]): Promise<{ deleted: number; errors: string[] }> {
  const validIds = ids.filter((id) => typeof id === "number" && Number.isInteger(id) && id > 0);
  if (validIds.length === 0) {
    throw new Error("Nenhum ID válido fornecido");
  }

  if (!currentScan || currentScan.status !== "completed" || !currentScan.nonPropertyIds.length) {
    throw new Error("Nenhum escaneamento concluído disponível para limpeza");
  }

  const allowedIds = new Set(currentScan.nonPropertyIds.map((i) => i.id));
  const filteredIds = validIds.filter((id) => allowedIds.has(id));
  if (filteredIds.length === 0) {
    throw new Error("Nenhum dos IDs fornecidos está na lista de não-imóveis");
  }

  const result = await deleteLeilaoItems(filteredIds);

  currentScan.nonPropertyIds = currentScan.nonPropertyIds.filter((i) => !filteredIds.includes(i.id));

  return result;
}

export function resetScan(): boolean {
  if (currentScan && currentScan.status === "running") {
    return false;
  }
  currentScan = null;
  return true;
}
