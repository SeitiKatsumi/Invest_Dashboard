import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import investLogo from "@assets/Icon_Invest_1769010072868.jpg";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Search,
  AlertTriangle,
  Loader2,
  Brain,
  Play,
  Square,
  CheckCircle2,
  DollarSign,
  Zap,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ExternalLink,
} from "lucide-react";

interface ClassifierItem {
  id: number;
  nome_do_anuncio: string;
  tipo_do_imovel: string | null;
  site: number | null;
}

interface ScanStatus {
  status: "idle" | "running" | "completed" | "error";
  processed?: number;
  total?: number;
  nonPropertyIds?: ClassifierItem[];
  tokensUsed?: number;
  estimatedCost?: number;
  error?: string;
}

interface Estimate {
  totalRecords: number;
  estimatedBatches: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

const ITEMS_PER_PAGE = 50;

export default function ClassificadorPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [confirmAllDialog, setConfirmAllDialog] = useState(false);
  const { toast } = useToast();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const estimateQuery = useQuery<Estimate>({
    queryKey: ["/api/classificador/estimate"],
  });

  const statusQuery = useQuery<ScanStatus>({
    queryKey: ["/api/classificador/status"],
    refetchInterval: false,
  });

  const isRunning = statusQuery.data?.status === "running";

  useEffect(() => {
    if (isRunning) {
      pollingRef.current = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/classificador/status"] });
      }, 2000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isRunning]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/classificador/scan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classificador/status"] });
      toast({ title: "Escaneamento iniciado", description: "A IA está analisando os registros..." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao iniciar", description: error.message, variant: "destructive" });
    },
  });

  const abortMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/classificador/abort");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classificador/status"] });
      toast({ title: "Escaneamento cancelado" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/classificador/reset");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classificador/status"] });
      setSelectedIds(new Set());
      setSearch("");
      setPage(1);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("DELETE", "/api/classificador/cleanup", { ids });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classificador/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classificador/estimate"] });
      setSelectedIds(new Set());
      setConfirmDialog(false);
      setConfirmAllDialog(false);
      toast({
        title: "Itens excluídos",
        description: `${result.deleted} registro(s) removido(s).${result.errors?.length > 0 ? ` ${result.errors.length} erro(s).` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    },
  });

  const status = statusQuery.data;
  const nonPropertyItems = status?.nonPropertyIds || [];
  const filtered = nonPropertyItems.filter((item) => {
    if (!search) return true;
    const s = search.toLowerCase().trim();
    return (
      item.nome_do_anuncio?.toLowerCase().includes(s) ||
      String(item.id) === s ||
      String(item.site) === s ||
      item.tipo_do_imovel?.toLowerCase().includes(s)
    );
  });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const progressPercent = status?.total ? Math.round(((status.processed || 0) / status.total) * 100) : 0;

  const selectAll = () => setSelectedIds(new Set(filtered.map((i) => i.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const isPending = deleteMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 max-w-7xl space-y-6">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-dashboard">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <img src={investLogo} alt="Invest Leilões" className="h-10 w-10 rounded-xl object-contain" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Classificador IA</h1>
              <p className="text-sm text-muted-foreground">
                Identifique e remova leilões que não são imóveis usando IA
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Brain className="h-4 w-4" />
                Total de Registros
              </div>
              <div className="text-3xl font-bold mt-1" data-testid="text-total-records">
                {estimateQuery.data?.totalRecords?.toLocaleString("pt-BR") || "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">na base leiloes_imovel</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Zap className="h-4 w-4" />
                Lotes Estimados
              </div>
              <div className="text-3xl font-bold mt-1" data-testid="text-total-batches">
                {estimateQuery.data?.estimatedBatches || "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {estimateQuery.data?.estimatedTokens?.toLocaleString("pt-BR") || "—"} tokens
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                Custo Estimado
              </div>
              <div className="text-3xl font-bold mt-1 text-green-600" data-testid="text-estimated-cost">
                US$ {estimateQuery.data?.estimatedCostUsd?.toFixed(4) || "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">usando GPT-4o-mini</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                Não-Imóveis Encontrados
              </div>
              <div className="text-3xl font-bold mt-1 text-orange-500" data-testid="text-non-property-count">
                {status?.status === "idle" ? "—" : nonPropertyItems.length.toLocaleString("pt-BR")}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {status?.status === "running" ? "em andamento..." : status?.status === "completed" ? "escaneamento concluído" : "aguardando escaneamento"}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <CardTitle className="text-lg">Controle do Escaneamento</CardTitle>
              <div className="flex items-center gap-2">
                {status?.status === "idle" || !status?.status || status?.status === undefined ? (
                  <Button
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending || !estimateQuery.data}
                    className="gap-2"
                    data-testid="button-start-scan"
                  >
                    {startMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Iniciar Escaneamento
                  </Button>
                ) : status?.status === "running" ? (
                  <Button
                    variant="destructive"
                    onClick={() => abortMutation.mutate()}
                    disabled={abortMutation.isPending}
                    className="gap-2"
                    data-testid="button-abort-scan"
                  >
                    <Square className="h-4 w-4" />
                    Parar
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => resetMutation.mutate()}
                    className="gap-2"
                    data-testid="button-reset-scan"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Novo Escaneamento
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isRunning && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Processando... {(status?.processed || 0).toLocaleString("pt-BR")} de {(status?.total || 0).toLocaleString("pt-BR")}
                  </span>
                  <span className="font-medium">{progressPercent}%</span>
                </div>
                <Progress value={progressPercent} className="h-3" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{nonPropertyItems.length} não-imóveis encontrados até agora</span>
                  <span>
                    {(status?.tokensUsed || 0).toLocaleString("pt-BR")} tokens • US$ {(status?.estimatedCost || 0).toFixed(4)}
                  </span>
                </div>
              </div>
            )}

            {status?.status === "completed" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Escaneamento concluído!</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {(status.processed || 0).toLocaleString("pt-BR")} registros analisados •{" "}
                  {nonPropertyItems.length.toLocaleString("pt-BR")} não-imóveis encontrados •{" "}
                  {(status.tokensUsed || 0).toLocaleString("pt-BR")} tokens usados •{" "}
                  US$ {(status.estimatedCost || 0).toFixed(4)} de custo
                </div>
                {status.error && (
                  <div className="text-sm text-orange-600 mt-1">{status.error}</div>
                )}
              </div>
            )}

            {status?.status === "error" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">Erro no escaneamento</span>
                </div>
                <div className="text-sm text-muted-foreground">{status.error}</div>
              </div>
            )}

            {(!status || status.status === "idle") && (
              <div className="text-center py-6 text-muted-foreground">
                <Brain className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Clique em "Iniciar Escaneamento" para classificar todos os registros usando IA</p>
                <p className="text-xs mt-1">
                  A IA analisará o título de cada leilão para identificar itens que não são imóveis
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {nonPropertyItems.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <CardTitle className="text-lg">
                  Não-Imóveis ({nonPropertyItems.length.toLocaleString("pt-BR")})
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nome, ID ou site..."
                      className="pl-9 h-9 w-[250px]"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      data-testid="input-search-classifier"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectedIds.size === filtered.length ? deselectAll : selectAll}
                    disabled={isPending || filtered.length === 0}
                    data-testid="button-select-all"
                  >
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? "Desmarcar Todos"
                      : `Selecionar Todos (${filtered.length})`}
                  </Button>
                  {selectedIds.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmDialog(true)}
                      disabled={isPending}
                      data-testid="button-delete-selected"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Excluir Selecionados ({selectedIds.size})
                    </Button>
                  )}
                  {nonPropertyItems.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmAllDialog(true)}
                      disabled={isPending}
                      data-testid="button-delete-all-non-property"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      Excluir Todos ({nonPropertyItems.length})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        checked={paged.length > 0 && paged.every((i) => selectedIds.has(i.id))}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            paged.forEach((i) => {
                              if (e.target.checked) next.add(i.id);
                              else next.delete(i.id);
                            });
                            return next;
                          });
                        }}
                        data-testid="checkbox-select-page"
                      />
                    </TableHead>
                    <TableHead className="w-20">ID</TableHead>
                    <TableHead>Nome do Anúncio</TableHead>
                    <TableHead className="w-32">Tipo Cadastrado</TableHead>
                    <TableHead className="w-20">Site</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <TableRow
                        key={item.id}
                        className={isSelected ? "bg-red-50 dark:bg-red-950/30" : ""}
                        data-testid={`row-classifier-${item.id}`}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              });
                            }}
                            data-testid={`checkbox-item-${item.id}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.id}</TableCell>
                        <TableCell className="text-sm">
                          {item.nome_do_anuncio || "Sem nome"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.tipo_do_imovel || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {item.site ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-sm text-muted-foreground">
                    Página {page} de {totalPages} ({filtered.length} itens)
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page === 1}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page === totalPages}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Confirmar Exclusão
              </DialogTitle>
              <DialogDescription>
                Você está prestes a excluir <strong>{selectedIds.size}</strong> registro(s) classificado(s) como
                não-imóvel. Esta ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(Array.from(selectedIds))}
                disabled={isPending}
                data-testid="button-confirm-delete"
              >
                {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Excluir {selectedIds.size} registro(s)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmAllDialog} onOpenChange={setConfirmAllDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Excluir Todos os Não-Imóveis
              </DialogTitle>
              <DialogDescription>
                Você está prestes a excluir <strong>{nonPropertyItems.length}</strong> registro(s) classificado(s)
                como não-imóvel pela IA. Recomendamos revisar a lista antes. Esta ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmAllDialog(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(nonPropertyItems.map((i) => i.id))}
                disabled={isPending}
                data-testid="button-confirm-delete-all"
              >
                {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Excluir Todos ({nonPropertyItems.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
