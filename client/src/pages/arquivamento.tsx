import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Archive, Play, Clock, CheckCircle2, AlertTriangle, Loader2, ImageOff, RefreshCw } from "lucide-react";
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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function ArquivamentoPage() {
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Arquivamento | Painel Invest Leilões";
  }, []);

  const { data: status, isLoading, isError, refetch, isFetching } = useQuery<ArchiverStatus>({
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

  const lastRun = status?.lastRun;
  const isRunning = status?.isRunning || runMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1200px] mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Arquivamento Automático</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie o arquivamento de leilões vencidos e exclusão de imagens
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-archiver"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Card data-testid="card-archiver-error">
            <CardContent className="p-8 text-center space-y-3">
              <AlertTriangle className="h-10 w-10 mx-auto text-red-500" />
              <p className="text-muted-foreground">Erro ao carregar status do arquivamento</p>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-archiver">
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Archive className="h-4 w-4" />
                    Status do Cron
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={status?.cronActive ? "default" : "secondary"} data-testid="badge-archiver-cron-status">
                      {status?.cronActive ? "Ativo" : "Inativo"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Diário às 2h</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Clock className="h-4 w-4" />
                    Última Execução
                  </div>
                  <p className="text-sm font-medium" data-testid="text-archiver-last-run">
                    {formatDate(lastRun?.executedAt)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Clock className="h-4 w-4" />
                    Próxima Execução
                  </div>
                  <p className="text-sm font-medium" data-testid="text-archiver-next-run">
                    {formatDate(status?.nextRun)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <CheckCircle2 className="h-4 w-4" />
                    Verificados
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-archiver-scanned">
                    {lastRun?.totalScanned ?? 0}
                  </p>
                </CardContent>
              </Card>
            </div>

            {lastRun && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-archiver-expired-count">
                      {lastRun.totalExpired}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">Vencidos encontrados</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-archiver-archived-count">
                      {lastRun.totalArchived}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">Arquivados</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-archiver-images-count">
                      {lastRun.imagesDeleted}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1">
                      <ImageOff className="h-3.5 w-3.5" />
                      Imagens excluídas
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 text-center">
                    <p className={`text-3xl font-bold ${lastRun.errors > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} data-testid="text-archiver-errors-count">
                      {lastRun.errors}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">Erros</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {lastRun && lastRun.errors > 0 && lastRun.errorDetails.length > 0 && (
              <Card className="border-red-500/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                    Erros da última execução
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-muted-foreground space-y-1 max-h-48 overflow-y-auto">
                    {lastRun.errorDetails.map((err, i) => (
                      <li key={i} className="truncate font-mono text-xs">{err}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {!lastRun && (
              <Card>
                <CardContent className="p-8 text-center">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-muted-foreground">Nenhuma execução registrada ainda</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    Execute manualmente ou aguarde o cron automático
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-4">
                <Button
                  className="w-full gap-2"
                  onClick={() => runMutation.mutate()}
                  disabled={isRunning}
                  data-testid="button-archiver-run"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Executando arquivamento...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Executar arquivamento agora
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
