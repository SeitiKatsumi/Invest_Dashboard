import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Archive, Play, Clock, CheckCircle2, AlertTriangle, Loader2, ImageOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ArchiverRunResult {
  executedAt: string;
  totalScanned: number;
  totalExpired: number;
  totalArchived: number;
  imagesDeleted: number;
  errors: number;
  errorDetails: string[];
}

interface ArchiverStatus {
  lastRun: ArchiverRunResult | null;
  nextRun: string | null;
  cronActive: boolean;
  isRunning: boolean;
}

export function ArchiverPanel() {
  const { toast } = useToast();

  const { data: status, isLoading, isError } = useQuery<ArchiverStatus>({
    queryKey: ["/api/archiver/status"],
    refetchInterval: 30000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/archiver/run");
      return res.json();
    },
    onSuccess: (data: ArchiverRunResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/archiver/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Arquivamento concluído",
        description: `${data.totalScanned} verificados, ${data.totalArchived} arquivados, ${data.imagesDeleted} imagens excluídas`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro no arquivamento",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-archiver-panel">
        <CardContent className="p-6 text-center space-y-2">
          <AlertTriangle className="h-8 w-8 mx-auto text-red-500" />
          <p className="text-sm text-muted-foreground">Erro ao carregar status do arquivamento</p>
        </CardContent>
      </Card>
    );
  }

  const lastRun = status?.lastRun;
  const isRunning = status?.isRunning || runMutation.isPending;

  return (
    <Card data-testid="card-archiver-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-lg">Arquivamento Automático</CardTitle>
          </div>
          <Badge variant={status?.cronActive ? "default" : "secondary"} data-testid="badge-archiver-cron-status">
            {status?.cronActive ? "Ativo" : "Inativo"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Última execução
            </div>
            <p className="text-sm font-medium" data-testid="text-archiver-last-run">
              {formatDate(lastRun?.executedAt)}
            </p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Próxima execução
            </div>
            <p className="text-sm font-medium" data-testid="text-archiver-next-run">
              {formatDate(status?.nextRun)}
            </p>
          </div>
        </div>

        {lastRun && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>{lastRun.totalScanned} verificados</span>
              <span>{lastRun.totalExpired} vencidos</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-orange-500/10 p-3 text-center">
                <p className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-archiver-archived-count">
                  {lastRun.totalArchived}
                </p>
                <p className="text-xs text-muted-foreground">Arquivados</p>
              </div>
              <div className="rounded-lg bg-blue-500/10 p-3 text-center">
                <p className="text-xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-archiver-images-count">
                  {lastRun.imagesDeleted}
                </p>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <ImageOff className="h-3 w-3" />
                  Imagens
                </p>
              </div>
              <div className="rounded-lg bg-red-500/10 p-3 text-center">
                <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-archiver-errors-count">
                  {lastRun.errors}
                </p>
                <p className="text-xs text-muted-foreground">Erros</p>
              </div>
            </div>
          </div>
        )}

        {lastRun && lastRun.errors > 0 && lastRun.errorDetails.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Erros recentes
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
              {lastRun.errorDetails.slice(0, 5).map((err, i) => (
                <li key={i} className="truncate">{err}</li>
              ))}
            </ul>
          </div>
        )}

        {!lastRun && (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            Nenhuma execução registrada ainda
          </div>
        )}

        <Button
          className="w-full gap-2"
          variant="outline"
          onClick={() => runMutation.mutate()}
          disabled={isRunning}
          data-testid="button-archiver-run"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Executando...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Executar agora
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
