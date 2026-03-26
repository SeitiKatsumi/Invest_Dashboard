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

const MAX_ENTRIES = 5000;
const usageHistory: UsageEntry[] = [];

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
  const entry: UsageEntry = {
    timestamp: new Date().toISOString(),
    model,
    operation,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    estimated_cost_usd: estimateCost(model, promptTokens, completionTokens),
    site_url: siteUrl,
  };

  usageHistory.push(entry);

  if (usageHistory.length > MAX_ENTRIES) {
    usageHistory.splice(0, usageHistory.length - MAX_ENTRIES);
  }
}

export function getUsageSummary() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentEntries = usageHistory.filter(e => new Date(e.timestamp) >= last24h);
  const weekEntries = usageHistory.filter(e => new Date(e.timestamp) >= last7d);

  const byModel: Record<string, { calls: number; tokens: number; cost: number }> = {};
  const byOperation: Record<string, { calls: number; tokens: number; cost: number }> = {};

  for (const entry of usageHistory) {
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
    total_calls: usageHistory.length,
    total_tokens: usageHistory.reduce((s, e) => s + e.total_tokens, 0),
    total_cost_usd: usageHistory.reduce((s, e) => s + e.estimated_cost_usd, 0),
    last_24h: {
      calls: recentEntries.length,
      tokens: recentEntries.reduce((s, e) => s + e.total_tokens, 0),
      cost: recentEntries.reduce((s, e) => s + e.estimated_cost_usd, 0),
    },
    last_7d: {
      calls: weekEntries.length,
      tokens: weekEntries.reduce((s, e) => s + e.total_tokens, 0),
      cost: weekEntries.reduce((s, e) => s + e.estimated_cost_usd, 0),
    },
    by_model: byModel,
    by_operation: byOperation,
    recent_entries: usageHistory.slice(-50).reverse(),
    pricing_table: MODEL_PRICING,
  };
}
