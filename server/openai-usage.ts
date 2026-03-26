const DIRECTUS_URL = process.env.DIRECTUS_URL || '';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || '';

interface UsageEntry {
  timestamp: string;
  model: string;
  operation: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  site_url?: string;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  'gpt-4.1': { input: 2.00 / 1_000_000, output: 8.00 / 1_000_000 },
  'gpt-4.1-mini': { input: 0.40 / 1_000_000, output: 1.60 / 1_000_000 },
  'gpt-4.1-nano': { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
};

let runtimeApiKey: string | null = null;

export function getOpenAIApiKey(): string {
  return runtimeApiKey || process.env.OPENAI_API_KEY || '';
}

export function setOpenAIApiKey(key: string): void {
  runtimeApiKey = key;
  process.env.OPENAI_API_KEY = key;
}

export function isOpenAIKeyConfigured(): boolean {
  return !!(runtimeApiKey || process.env.OPENAI_API_KEY);
}

export function getMaskedKey(): string {
  const key = getOpenAIApiKey();
  if (!key || key.length < 8) return '';
  return key.slice(0, 7) + '...' + key.slice(-4);
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
  return promptTokens * pricing.input + completionTokens * pricing.output;
}

export function trackUsage(
  model: string,
  operation: string,
  promptTokens: number,
  completionTokens: number,
  siteUrl?: string,
): void {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) return;

  const cost = estimateCost(model, promptTokens, completionTokens);

  fetch(`${DIRECTUS_URL}/items/openai_usage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      operation,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated_cost_usd: cost,
      site_url: siteUrl || null,
    }),
  }).catch(err => {
    console.error('[OpenAI Usage] Erro ao salvar no Directus:', err.message);
  });
}

export async function getUsageSummary() {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    return emptyResult();
  }

  try {
    const url = new URL(`${DIRECTUS_URL}/items/openai_usage`);
    url.searchParams.set('limit', '-1');
    url.searchParams.set('sort', '-date_created');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[OpenAI Usage] Erro ao ler do Directus:', response.status);
      return emptyResult();
    }

    const result = await response.json();
    const allEntries: any[] = result.data || [];

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recentEntries = allEntries.filter(e => new Date(e.date_created) >= last24h);
    const weekEntries = allEntries.filter(e => new Date(e.date_created) >= last7d);

    const byModel: Record<string, { calls: number; tokens: number; cost: number }> = {};
    const byOperation: Record<string, { calls: number; tokens: number; cost: number }> = {};

    for (const entry of allEntries) {
      if (!byModel[entry.model]) byModel[entry.model] = { calls: 0, tokens: 0, cost: 0 };
      byModel[entry.model].calls++;
      byModel[entry.model].tokens += entry.total_tokens;
      byModel[entry.model].cost += entry.estimated_cost_usd;

      if (!byOperation[entry.operation]) byOperation[entry.operation] = { calls: 0, tokens: 0, cost: 0 };
      byOperation[entry.operation].calls++;
      byOperation[entry.operation].tokens += entry.total_tokens;
      byOperation[entry.operation].cost += entry.estimated_cost_usd;
    }

    return {
      total_calls: allEntries.length,
      total_tokens: allEntries.reduce((s: number, e: any) => s + (e.total_tokens || 0), 0),
      total_cost_usd: allEntries.reduce((s: number, e: any) => s + (e.estimated_cost_usd || 0), 0),
      last_24h: {
        calls: recentEntries.length,
        tokens: recentEntries.reduce((s: number, e: any) => s + (e.total_tokens || 0), 0),
        cost: recentEntries.reduce((s: number, e: any) => s + (e.estimated_cost_usd || 0), 0),
      },
      last_7d: {
        calls: weekEntries.length,
        tokens: weekEntries.reduce((s: number, e: any) => s + (e.total_tokens || 0), 0),
        cost: weekEntries.reduce((s: number, e: any) => s + (e.estimated_cost_usd || 0), 0),
      },
      by_model: byModel,
      by_operation: byOperation,
      recent_entries: allEntries.slice(0, 50).map((e: any) => ({
        timestamp: e.date_created,
        model: e.model,
        operation: e.operation,
        prompt_tokens: e.prompt_tokens,
        completion_tokens: e.completion_tokens,
        total_tokens: e.total_tokens,
        estimated_cost_usd: e.estimated_cost_usd,
        site_url: e.site_url,
      })),
      pricing_table: MODEL_PRICING,
    };
  } catch (err) {
    console.error('[OpenAI Usage] Erro ao ler do Directus:', err);
    return emptyResult();
  }
}

function emptyResult() {
  return {
    total_calls: 0,
    total_tokens: 0,
    total_cost_usd: 0,
    last_24h: { calls: 0, tokens: 0, cost: 0 },
    last_7d: { calls: 0, tokens: 0, cost: 0 },
    by_model: {},
    by_operation: {},
    recent_entries: [],
    pricing_table: MODEL_PRICING,
  };
}
