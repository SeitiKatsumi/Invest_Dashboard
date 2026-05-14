import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, Loader2, Play, RefreshCw, Square, TriangleAlert, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

interface ExtractorStatus {
  config: {
    enabled: boolean;
    cronExpression: string;
    batchSize: number;
    concurrency: number;
    fetchMode: string;
    model: string;
  };
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
  lastRun: {
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
  } | null;
  queue: {
    pending: number;
    processed: number;
    errors: number;
    totalIndividual: number;
  };
  cronActive: boolean;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Nunca";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "green" | "red" | "blue" | "amber";
}) {
  const toneClass = {
    green: "text-green-600 dark:text-green-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
    amber: "text-amber-600 dark:text-amber-400",
  }[tone || "blue"];

  return (
    <div className="min-w-0 rounded-md bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function AuctionExtractorPanel() {
  const [limit, setLimit] = useState("1");
  const [dryRun, setDryRun] = useState(true);
  const { toast } = useToast();

  const { data: status, isFetching, refetch } = useQuery<ExtractorStatus>({
    queryKey: ["/api/extractor/status"],
    refetchInterval: 5000,
    staleTime: 0,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/extractor/run", {
        limit: Number(limit) || undefined,
        dryRun,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/extractor/status"] });
      toast({
        title: dryRun ? "Dry-run iniciado" : "Extração iniciada",
        description: `Lote solicitado com limite ${Number(limit) || status?.config.batchSize || 25}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao iniciar extrator", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/extractor/cancel");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/extractor/status"] });
      toast({ title: "Cancelamento solicitado" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao cancelar", description: error.message, variant: "destructive" });
    },
  });

  const progress = useMemo(() => {
    if (!status?.currentRun?.total) return 0;
    return Math.round((status.currentRun.processed / status.currentRun.total) * 100);
  }, [status?.currentRun]);

  const lastRunTone = status?.lastRun?.errors ? "destructive" : "secondary";

  return (
    <Card data-testid="auction-extractor-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bot className="h-5 w-5 text-primary" />
          Extração interna
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={status?.running ? "default" : "secondary"} className="gap-1">
            {status?.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {status?.running ? "Executando" : "Pronto"}
          </Badge>
          <Badge variant={status?.cronActive ? "default" : "outline"}>
            {status?.config.enabled ? "Cron ativo" : "Cron pausado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <StatTile label="Pendentes" value={status?.queue.pending ?? 0} tone="amber" />
          <StatTile label="Processadas" value={status?.queue.processed ?? 0} tone="green" />
          <StatTile label="Erros" value={status?.queue.errors ?? 0} tone="red" />
          <StatTile label="Imóveis na fila" value={status?.queue.totalIndividual ?? 0} tone="blue" />
        </div>

        {status?.running && status.currentRun && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                Lote {status.currentRun.processed}/{status.currentRun.total}
              </span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            {status.currentRun.currentItem && (
              <p className="truncate text-xs text-muted-foreground" title={status.currentRun.currentItem}>
                {status.currentRun.currentItem}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-[140px_160px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="extractor-limit">Limite</Label>
              <Input
                id="extractor-limit"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                data-testid="input-extractor-limit"
              />
            </div>
            <label className="flex h-10 items-center gap-2 self-end rounded-md border px-3">
              <Checkbox
                checked={dryRun}
                onCheckedChange={(checked) => setDryRun(checked === true)}
                data-testid="checkbox-extractor-dry-run"
              />
              <span className="text-sm font-medium">Dry-run</span>
            </label>
            <div className="min-w-0 self-end text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{status?.config.model || "gpt-4o-mini"}</span>
              <span> · lote {status?.config.batchSize ?? 25}</span>
              <span> · conc. {status?.config.concurrency ?? 2}</span>
              <span> · {status?.config.fetchMode || "http_playwright"}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Atualizar"
              data-testid="button-extractor-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={status?.running || runMutation.isPending}
              className="gap-2"
              data-testid="button-extractor-run"
            >
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Executar
            </Button>
            <Button
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={!status?.running || cancelMutation.isPending}
              className="gap-2"
              data-testid="button-extractor-cancel"
            >
              {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Cancelar
            </Button>
          </div>
        </div>

        {status?.lastRun && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <Badge variant={lastRunTone}>
              {status.lastRun.errors > 0 ? <XCircle className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
              Último lote
            </Badge>
            <span>{formatDateTime(status.lastRun.completedAt)}</span>
            <span className="text-muted-foreground">
              {status.lastRun.created} {status.lastRun.dryRun ? "simulados" : "criados"} · {status.lastRun.duplicates} duplicatas · {status.lastRun.notIndividual} não-imóveis · {status.lastRun.errors} erros
            </span>
            {status.lastRun.cancelled && (
              <Badge variant="outline" className="gap-1">
                <TriangleAlert className="h-3 w-3" />
                Cancelado
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
