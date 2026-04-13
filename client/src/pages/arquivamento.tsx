import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Archive,
  Play,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ImageOff,
  RefreshCw,
  Search,
  ScanSearch,
  ExternalLink,
  Image,
} from "lucide-react";
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

interface EligibleLeilao {
  id: number;
  nome_do_anuncio: string | null;
  link_anuncio: string | null;
  praca_1: string | null;
  praca_2: string | null;
  praca_3: string | null;
  most_advanced_date: string;
  has_image: boolean;
}

interface PreviewResult {
  totalPublished: number;
  eligible: EligibleLeilao[];
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export default function ArquivamentoPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  useEffect(() => {
    document.title = "Arquivamento | Painel Invest Leilões";
  }, []);

  const { data: status, isLoading, isError, refetch, isFetching } = useQuery<ArchiverStatus>({
    queryKey: ["/api/archiver/status"],
    refetchInterval: 30000,
  });

  const { data: preview, isLoading: previewLoading, isFetching: previewFetching, refetch: refetchPreview, isError: previewError } = useQuery<PreviewResult>({
    queryKey: ["/api/archiver/preview"],
    refetchOnWindowFocus: false,
    staleTime: 60000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/archiver/run");
      return res.json();
    },
    onSuccess: (data: ArchiverRunResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/archiver/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/archiver/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setShowConfirmDialog(false);
      toast({
        title: "Arquivamento concluído",
        description: `${data.totalScanned} verificados, ${data.totalArchived} arquivados, ${data.imagesDeleted} imagens excluídas`,
      });
    },
    onError: (error: Error) => {
      setShowConfirmDialog(false);
      toast({
        title: "Erro no arquivamento",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const lastRun = status?.lastRun;
  const isRunning = status?.isRunning || runMutation.isPending;
  const eligible = preview?.eligible ?? [];
  const imagesCount = eligible.filter((l) => l.has_image).length;

  const filteredEligible = searchQuery.trim()
    ? eligible.filter(
        (l) =>
          l.nome_do_anuncio?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          String(l.id).includes(searchQuery) ||
          l.link_anuncio?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : eligible;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-6">
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
            onClick={() => { refetch(); refetchPreview(); }}
            disabled={isFetching || previewFetching}
            data-testid="button-refresh-archiver"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching || previewFetching ? "animate-spin" : ""}`} />
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
                    Publicados
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-archiver-published">
                    {preview?.totalPublished ?? "—"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {lastRun && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Resultado da Última Execução</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-orange-500/10 p-3 text-center">
                      <p className="text-2xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-archiver-expired-count">
                        {lastRun.totalExpired}
                      </p>
                      <p className="text-xs text-muted-foreground">Vencidos</p>
                    </div>
                    <div className="rounded-lg bg-green-500/10 p-3 text-center">
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-archiver-archived-count">
                        {lastRun.totalArchived}
                      </p>
                      <p className="text-xs text-muted-foreground">Arquivados</p>
                    </div>
                    <div className="rounded-lg bg-blue-500/10 p-3 text-center">
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-archiver-images-count">
                        {lastRun.imagesDeleted}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                        <ImageOff className="h-3 w-3" /> Imagens
                      </p>
                    </div>
                    <div className="rounded-lg bg-red-500/10 p-3 text-center">
                      <p className={`text-2xl font-bold ${lastRun.errors > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} data-testid="text-archiver-errors-count">
                        {lastRun.errors}
                      </p>
                      <p className="text-xs text-muted-foreground">Erros</p>
                    </div>
                  </div>
                  {lastRun.errors > 0 && lastRun.errorDetails.length > 0 && (
                    <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1">
                      <p className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Detalhes dos erros
                      </p>
                      <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                        {lastRun.errorDetails.slice(0, 10).map((err, i) => (
                          <li key={i} className="truncate font-mono">{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ScanSearch className="h-5 w-5 text-orange-500" />
                    <CardTitle className="text-lg">Leilões Elegíveis para Arquivamento</CardTitle>
                    {!previewLoading && !previewError && (
                      <Badge variant="secondary" data-testid="badge-eligible-count">
                        {eligible.length} {eligible.length === 1 ? "leilão" : "leilões"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar por nome ou ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-eligible"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchPreview()}
                      disabled={previewFetching}
                      data-testid="button-rescan-eligible"
                    >
                      <RefreshCw className={`h-4 w-4 mr-1.5 ${previewFetching ? "animate-spin" : ""}`} />
                      Reescanear
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {previewLoading ? (
                  <div className="flex items-center justify-center py-12 gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Verificando leilões publicados...</p>
                  </div>
                ) : previewError ? (
                  <div className="text-center py-8 space-y-2">
                    <AlertTriangle className="h-8 w-8 mx-auto text-red-500" />
                    <p className="text-sm text-muted-foreground">Erro ao buscar leilões elegíveis</p>
                    <Button variant="outline" size="sm" onClick={() => refetchPreview()}>
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      Tentar novamente
                    </Button>
                  </div>
                ) : eligible.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500/50" />
                    <p className="text-muted-foreground font-medium">Nenhum leilão vencido encontrado</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Todos os {preview?.totalPublished ?? 0} leilões publicados ainda estão dentro do prazo
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-4 mb-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Image className="h-4 w-4" />
                        {imagesCount} com imagem
                      </span>
                      <span>{eligible.length - imagesCount} sem imagem</span>
                    </div>
                    <div className="rounded-md border max-h-[500px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">ID</TableHead>
                            <TableHead>Nome do Anúncio</TableHead>
                            <TableHead className="w-24 text-center">Praça 1</TableHead>
                            <TableHead className="w-24 text-center">Praça 2</TableHead>
                            <TableHead className="w-24 text-center">Praça 3</TableHead>
                            <TableHead className="w-28 text-center">Venceu em</TableHead>
                            <TableHead className="w-20 text-center">Imagem</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredEligible.map((leilao) => (
                            <TableRow key={leilao.id}>
                              <TableCell className="font-mono text-xs" data-testid={`text-eligible-id-${leilao.id}`}>
                                {leilao.id}
                              </TableCell>
                              <TableCell className="max-w-[300px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-sm" title={leilao.nome_do_anuncio || "Sem nome"}>
                                    {leilao.nome_do_anuncio || <span className="text-muted-foreground italic">Sem nome</span>}
                                  </span>
                                  {leilao.link_anuncio && (
                                    <a href={leilao.link_anuncio} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground shrink-0">
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center text-xs">{formatDateShort(leilao.praca_1)}</TableCell>
                              <TableCell className="text-center text-xs">{formatDateShort(leilao.praca_2)}</TableCell>
                              <TableCell className="text-center text-xs">{formatDateShort(leilao.praca_3)}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline" className="text-xs font-normal text-orange-600 dark:text-orange-400 border-orange-500/30">
                                  {formatDateShort(leilao.most_advanced_date)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                {leilao.has_image ? (
                                  <Image className="h-4 w-4 mx-auto text-blue-500" />
                                ) : (
                                  <span className="text-muted-foreground/40">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {searchQuery && filteredEligible.length !== eligible.length && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Exibindo {filteredEligible.length} de {eligible.length} resultados
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    if (eligible.length > 0) {
                      setShowConfirmDialog(true);
                    } else {
                      toast({ title: "Nada para arquivar", description: "Não há leilões vencidos no momento." });
                    }
                  }}
                  disabled={isRunning || eligible.length === 0}
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
                      Executar arquivamento agora ({eligible.length} leilões)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Arquivamento</DialogTitle>
            <DialogDescription>
              Você está prestes a arquivar <strong>{eligible.length}</strong> leilões vencidos.
              {imagesCount > 0 && (
                <> As imagens de <strong>{imagesCount}</strong> leilões serão excluídas do Directus.</>
              )}
              <br /><br />
              Esta ação alterará o status desses leilões para "archived". Deseja continuar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)} data-testid="button-cancel-archive">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              data-testid="button-confirm-archive"
            >
              {runMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Arquivando...
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4 mr-2" />
                  Confirmar Arquivamento
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
