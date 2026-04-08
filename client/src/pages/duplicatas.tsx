import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import investLogo from "@assets/Icon_Invest_1769010072868.jpg";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  ExternalLink,
  Copy,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DuplicateItem {
  id: number;
  link_anuncio: string;
  nome_do_anuncio: string | null;
  site: number | null;
  date_created: string | null;
}

interface DuplicateGroup {
  normalizedUrl: string;
  items: DuplicateItem[];
  count: number;
  excessCount: number;
}

interface DuplicatesResponse {
  groups: DuplicateGroup[];
  totalDuplicates: number;
  totalExcess: number;
}

const GROUPS_PER_PAGE = 20;

export default function DuplicatasPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<"manual" | "auto" | null>(null);
  const { toast } = useToast();

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<DuplicatesResponse>({
    queryKey: ["/api/leiloes/duplicates"],
  });

  const deleteManualMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("DELETE", "/api/leiloes/duplicates", { ids });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leiloes/duplicates"] });
      setSelectedIds(new Set());
      setConfirmDialog(null);
      toast({
        title: "Duplicatas excluídas",
        description: `${result.deleted} registro(s) removido(s) com sucesso.${result.errors?.length > 0 ? ` ${result.errors.length} erro(s).` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    },
  });

  const deleteAutoMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/leiloes/duplicates/auto");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leiloes/duplicates"] });
      setSelectedIds(new Set());
      setConfirmDialog(null);
      toast({
        title: "Limpeza automática concluída",
        description: `${result.deleted} registro(s) duplicado(s) removido(s) de ${result.totalGroups} grupo(s).${result.errors?.length > 0 ? ` ${result.errors.length} erro(s).` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro na limpeza automática", description: error.message, variant: "destructive" });
    },
  });

  const groups = data?.groups || [];
  const filtered = groups.filter((g) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      g.normalizedUrl.toLowerCase().includes(s) ||
      g.items.some((item) => item.nome_do_anuncio?.toLowerCase().includes(s))
    );
  });

  const totalPages = Math.ceil(filtered.length / GROUPS_PER_PAGE);
  const paged = filtered.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE);

  const toggleSelectExcess = (group: DuplicateGroup) => {
    const sorted = [...group.items].sort(
      (a, b) => new Date(a.date_created || 0).getTime() - new Date(b.date_created || 0).getTime()
    );
    const excessIds = sorted.slice(1).map((item) => item.id);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = excessIds.every((id) => next.has(id));
      if (allSelected) {
        excessIds.forEach((id) => next.delete(id));
      } else {
        excessIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectAllExcess = () => {
    const allExcessIds: number[] = [];
    for (const group of filtered) {
      const sorted = [...group.items].sort(
        (a, b) => new Date(a.date_created || 0).getTime() - new Date(b.date_created || 0).getTime()
      );
      for (let i = 1; i < sorted.length; i++) {
        allExcessIds.push(sorted[i].id);
      }
    }
    setSelectedIds(new Set(allExcessIds));
  };

  const isPending = deleteManualMutation.isPending || deleteAutoMutation.isPending;

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
            <img
              src={investLogo}
              alt="Invest Leilões"
              className="h-10 w-10 rounded-xl object-contain"
            />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Gerenciador de Duplicatas</h1>
              <p className="text-sm text-muted-foreground">
                Identifique e remova leilões duplicados do banco de dados
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-duplicates"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="p-8 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-red-500" />
              <p className="text-lg font-medium text-red-600 dark:text-red-400">Erro ao carregar duplicatas</p>
              <p className="text-sm text-muted-foreground mt-1">
                {error instanceof Error ? error.message : "Não foi possível conectar ao servidor."}
              </p>
              <Button variant="outline" className="mt-4" onClick={() => refetch()} data-testid="button-retry">
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm text-muted-foreground">Grupos Duplicados</div>
                  <div className="text-3xl font-bold mt-1" data-testid="text-total-groups">
                    {data?.totalDuplicates || 0}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    URLs com mais de 1 registro
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm text-muted-foreground">Registros Excedentes</div>
                  <div className="text-3xl font-bold mt-1 text-orange-500" data-testid="text-total-excess">
                    {data?.totalExcess || 0}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Registros que podem ser removidos
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm text-muted-foreground">Selecionados</div>
                  <div className="text-3xl font-bold mt-1 text-blue-500" data-testid="text-selected-count">
                    {selectedIds.size}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Registros marcados para exclusão
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <CardTitle className="text-lg">Duplicatas Encontradas</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar por URL ou nome..."
                        className="pl-9 h-9 w-[250px]"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                        data-testid="input-search-duplicates"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllExcess}
                      disabled={isPending || filtered.length === 0}
                      data-testid="button-select-all-excess"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Selecionar Todos Excedentes
                    </Button>
                    {selectedIds.size > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmDialog("manual")}
                        disabled={isPending}
                        data-testid="button-delete-selected"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Excluir Selecionados ({selectedIds.size})
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmDialog("auto")}
                      disabled={isPending || (data?.totalExcess || 0) === 0}
                      data-testid="button-auto-cleanup"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      Limpar Todas ({data?.totalExcess || 0})
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filtered.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
                    <p className="text-lg font-medium">Nenhuma duplicata encontrada!</p>
                    <p className="text-sm mt-1">Todos os leilões possuem URLs únicas.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {paged.map((group) => {
                      const sorted = [...group.items].sort(
                        (a, b) =>
                          new Date(a.date_created || 0).getTime() -
                          new Date(b.date_created || 0).getTime()
                      );
                      const keepId = sorted[0].id;
                      const groupExcessSelected = sorted
                        .slice(1)
                        .every((item) => selectedIds.has(item.id));

                      return (
                        <Card
                          key={group.normalizedUrl}
                          className="border-l-4 border-l-orange-400"
                          data-testid={`card-duplicate-group-${group.normalizedUrl}`}
                        >
                          <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="shrink-0">
                                    {group.count}x
                                  </Badge>
                                  <span
                                    className="text-sm font-mono text-muted-foreground truncate"
                                    title={group.normalizedUrl}
                                  >
                                    {group.normalizedUrl}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {group.items[0]?.nome_do_anuncio || "Sem nome"}
                                </div>
                              </div>
                              <Button
                                variant={groupExcessSelected ? "secondary" : "outline"}
                                size="sm"
                                onClick={() => toggleSelectExcess(group)}
                                disabled={isPending}
                                data-testid={`button-select-group-${group.normalizedUrl}`}
                              >
                                {groupExcessSelected ? "Desmarcar" : `Selecionar ${group.excessCount} excedente(s)`}
                              </Button>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-16">ID</TableHead>
                                  <TableHead>URL Original</TableHead>
                                  <TableHead className="w-20">Site ID</TableHead>
                                  <TableHead className="w-40">Criado em</TableHead>
                                  <TableHead className="w-24 text-center">Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {sorted.map((item, idx) => {
                                  const isKeep = item.id === keepId;
                                  const isSelected = selectedIds.has(item.id);

                                  return (
                                    <TableRow
                                      key={item.id}
                                      className={isSelected ? "bg-red-50 dark:bg-red-950/30" : ""}
                                      data-testid={`row-duplicate-${item.id}`}
                                    >
                                      <TableCell className="font-mono text-xs">
                                        {item.id}
                                      </TableCell>
                                      <TableCell>
                                        <a
                                          href={item.link_anuncio}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                                          title={item.link_anuncio}
                                        >
                                          <span className="truncate max-w-[400px]">
                                            {item.link_anuncio}
                                          </span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground font-mono">
                                        {item.site ?? "—"}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {item.date_created
                                          ? format(new Date(item.date_created), "dd/MM/yyyy HH:mm", {
                                              locale: ptBR,
                                            })
                                          : "—"}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {isKeep ? (
                                          <Badge
                                            variant="outline"
                                            className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300"
                                          >
                                            Manter
                                          </Badge>
                                        ) : (
                                          <Button
                                            variant={isSelected ? "destructive" : "outline"}
                                            size="sm"
                                            className="h-6 text-xs px-2"
                                            onClick={() => {
                                              setSelectedIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(item.id)) {
                                                  next.delete(item.id);
                                                } else {
                                                  next.add(item.id);
                                                }
                                                return next;
                                              });
                                            }}
                                            disabled={isPending}
                                            data-testid={`button-toggle-select-${item.id}`}
                                          >
                                            {isSelected ? "Selecionado" : "Selecionar"}
                                          </Button>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </CardContent>
                        </Card>
                      );
                    })}

                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-sm text-muted-foreground">
                          Página {page} de {totalPages} ({filtered.length} grupos)
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
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Dialog open={confirmDialog === "manual"} onOpenChange={() => setConfirmDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Confirmar Exclusão
              </DialogTitle>
              <DialogDescription>
                Você está prestes a excluir <strong>{selectedIds.size}</strong> registro(s) duplicado(s).
                Esta ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog(null)} disabled={isPending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteManualMutation.mutate(Array.from(selectedIds))}
                disabled={isPending}
                data-testid="button-confirm-delete"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Excluir {selectedIds.size} registro(s)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmDialog === "auto"} onOpenChange={() => setConfirmDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Limpeza Automática
              </DialogTitle>
              <DialogDescription>
                Esta ação irá excluir <strong>{data?.totalExcess || 0}</strong> registro(s) duplicado(s)
                de <strong>{data?.totalDuplicates || 0}</strong> grupo(s), mantendo sempre o registro mais
                antigo de cada grupo. Esta ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog(null)} disabled={isPending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteAutoMutation.mutate()}
                disabled={isPending}
                data-testid="button-confirm-auto-cleanup"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Confirmar Limpeza
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
