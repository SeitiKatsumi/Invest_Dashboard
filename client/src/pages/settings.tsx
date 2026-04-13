import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Key,
  Eye,
  EyeOff,
  Save,
  Coins,
  Clock,
  BarChart3,
  Cpu,
  ImageIcon,
  Bot,
  RefreshCw,
  CheckCircle,
  XCircle,
  TrendingUp,
} from "lucide-react";

interface UsageSummary {
  total_calls: number;
  total_tokens: number;
  total_cost_usd: number;
  last_24h: { calls: number; tokens: number; cost: number };
  last_7d: { calls: number; tokens: number; cost: number };
  by_model: Record<string, { calls: number; tokens: number; cost: number }>;
  by_operation: Record<string, { calls: number; tokens: number; cost: number }>;
  recent_entries: Array<{
    timestamp: string;
    model: string;
    operation: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    site_url?: string;
  }>;
  pricing_table: Record<string, { input: number; output: number }>;
}

const OPERATION_LABELS: Record<string, string> = {
  scraping_onboarding: "Onboarding de Scraping",
  image_extraction: "Extração de Imagem",
};

const OPERATION_ICONS: Record<string, typeof Bot> = {
  scraping_onboarding: Bot,
  image_extraction: ImageIcon,
};

function formatCurrency(usd: number): string {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const { data: keyStatus, isLoading: keyLoading } = useQuery<{
    configured: boolean;
    masked_key: string;
  }>({
    queryKey: ["/api/settings/openai"],
  });

  const { data: usage, isLoading: usageLoading, refetch: refetchUsage } = useQuery<UsageSummary>({
    queryKey: ["/api/settings/openai/usage"],
    refetchInterval: 30000,
  });

  const saveKeyMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await apiRequest("POST", "/api/settings/openai", { api_key: apiKey });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/openai"] });
      setNewKey("");
      toast({ title: "Chave salva", description: "A chave da OpenAI foi atualizada com sucesso." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1200px] mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight" data-testid="text-settings-title">Configurações</h1>
            <p className="text-sm text-muted-foreground">Gerencie tokens e monitore uso da IA</p>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card data-testid="card-openai-key">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Chave da OpenAI
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={keyStatus?.configured ? "default" : "destructive"} data-testid="badge-key-status">
                  {keyStatus?.configured ? (
                    <><CheckCircle className="h-3 w-3 mr-1" /> Configurada</>
                  ) : (
                    <><XCircle className="h-3 w-3 mr-1" /> Não configurada</>
                  )}
                </Badge>
                {keyStatus?.masked_key && (
                  <code className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded" data-testid="text-masked-key">
                    {keyStatus.masked_key}
                  </code>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Nova chave API</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      placeholder="sk-..."
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      data-testid="input-api-key"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      data-testid="button-toggle-key-visibility"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    onClick={() => saveKeyMutation.mutate(newKey)}
                    disabled={!newKey || saveKeyMutation.isPending}
                    data-testid="button-save-key"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    Salvar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A chave é usada para onboarding de scraping (GPT-4o mini) e extração de imagem (GPT-4o).
                  A alteração é válida enquanto o servidor estiver rodando.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-usage-summary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Resumo de Uso
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-8 w-8"
                  onClick={() => refetchUsage()}
                  data-testid="button-refresh-usage"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usageLoading ? (
                <div className="space-y-2">
                  <div className="h-16 bg-muted animate-pulse rounded" />
                  <div className="h-16 bg-muted animate-pulse rounded" />
                </div>
              ) : usage ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold" data-testid="text-total-calls">{usage.total_calls}</p>
                    <p className="text-xs text-muted-foreground">Chamadas</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold" data-testid="text-total-tokens">{formatTokens(usage.total_tokens)}</p>
                    <p className="text-xs text-muted-foreground">Tokens</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold" data-testid="text-total-cost">{formatCurrency(usage.total_cost_usd)}</p>
                    <p className="text-xs text-muted-foreground">Custo est.</p>
                  </div>

                  <div className="col-span-3 mt-2 space-y-2">
                    <div className="flex items-center justify-between text-sm px-1">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" /> Últimas 24h
                      </span>
                      <span data-testid="text-24h-summary">
                        {usage.last_24h.calls} chamadas · {formatTokens(usage.last_24h.tokens)} tokens · {formatCurrency(usage.last_24h.cost)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm px-1">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <TrendingUp className="h-3.5 w-3.5" /> Últimos 7 dias
                      </span>
                      <span data-testid="text-7d-summary">
                        {usage.last_7d.calls} chamadas · {formatTokens(usage.last_7d.tokens)} tokens · {formatCurrency(usage.last_7d.cost)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum dado de uso disponível</p>
              )}
            </CardContent>
          </Card>
        </div>

        {usage && Object.keys(usage.by_model).length > 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            <Card data-testid="card-usage-by-model">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="h-5 w-5" />
                  Uso por Modelo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(usage.by_model).map(([model, stats]) => (
                    <div key={model} className="flex items-center justify-between border-b pb-2 last:border-0" data-testid={`row-model-${model}`}>
                      <div>
                        <p className="font-medium text-sm">{model}</p>
                        <p className="text-xs text-muted-foreground">{stats.calls} chamadas</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatTokens(stats.tokens)} tokens</p>
                        <p className="text-xs text-muted-foreground">{formatCurrency(stats.cost)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-usage-by-operation">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5" />
                  Uso por Operação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(usage.by_operation).map(([op, stats]) => {
                    const Icon = OPERATION_ICONS[op] || Bot;
                    return (
                      <div key={op} className="flex items-center justify-between border-b pb-2 last:border-0" data-testid={`row-operation-${op}`}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">{OPERATION_LABELS[op] || op}</p>
                            <p className="text-xs text-muted-foreground">{stats.calls} chamadas</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">{formatTokens(stats.tokens)} tokens</p>
                          <p className="text-xs text-muted-foreground">{formatCurrency(stats.cost)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {usage && usage.recent_entries.length > 0 && (
          <Card data-testid="card-recent-entries">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-5 w-5" />
                Chamadas Recentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Data</th>
                      <th className="pb-2 pr-4">Operação</th>
                      <th className="pb-2 pr-4">Modelo</th>
                      <th className="pb-2 pr-4 text-right">Prompt</th>
                      <th className="pb-2 pr-4 text-right">Resposta</th>
                      <th className="pb-2 pr-4 text-right">Total</th>
                      <th className="pb-2 text-right">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.recent_entries.map((entry, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-entry-${idx}`}>
                        <td className="py-2 pr-4 whitespace-nowrap">{formatDate(entry.timestamp)}</td>
                        <td className="py-2 pr-4">
                          <span className="text-xs">{OPERATION_LABELS[entry.operation] || entry.operation}</span>
                          {entry.site_url && (
                            <span className="block text-xs text-muted-foreground truncate max-w-[200px]">{entry.site_url}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline" className="text-xs">{entry.model}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">{entry.prompt_tokens.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{entry.completion_tokens.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right tabular-nums font-medium">{entry.total_tokens.toLocaleString()}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(entry.estimated_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {usage && (
          <Card data-testid="card-pricing-reference">
            <CardHeader>
              <CardTitle className="text-base">Referência de Preços (por 1M tokens)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {Object.entries(usage.pricing_table).map(([model, pricing]) => (
                  <div key={model} className="rounded-lg border p-3" data-testid={`card-pricing-${model}`}>
                    <p className="font-medium text-sm mb-1">{model}</p>
                    <p className="text-xs text-muted-foreground">Input: ${(pricing.input * 1_000_000).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Output: ${(pricing.output * 1_000_000).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
