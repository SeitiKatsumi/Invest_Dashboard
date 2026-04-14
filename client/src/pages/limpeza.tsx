import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Brush,
  Search,
  Loader2,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Image,
  ImageOff,
  RefreshCw,
  CheckCircle2,
  Calendar,
  Building2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Site {
  id: number;
  nome_site: string | null;
  url_site: string | null;
}

interface LimpezaPreviewItem {
  id: number;
  nome_do_anuncio: string | null;
  link_anuncio: string | null;
  date_created: string | null;
  has_image: boolean;
}

interface LimpezaPreviewResult {
  total: number;
  items: LimpezaPreviewItem[];
  imagesCount: number;
}

interface LimpezaExecuteResult {
  totalDeleted: number;
  imagesDeleted: number;
  errors: number;
  errorDetails: string[];
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function LimpezaPage() {
  const { toast } = useToast();
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [siteSearch, setSiteSearch] = useState("");

  useEffect(() => {
    document.title = "Limpeza Seletiva | Painel Invest Leilões";
  }, []);

  const { data: sites, isLoading: sitesLoading } = useQuery<Site[]>({
    queryKey: ["/api/sites"],
  });

  const canPreview = !!selectedSiteId && !!dateFrom && !!dateTo;

  const {
    data: preview,
    isLoading: previewLoading,
    isFetching: previewFetching,
    refetch: refetchPreview,
    isError: previewError,
  } = useQuery<LimpezaPreviewResult>({
    queryKey: ["/api/limpeza/preview", selectedSiteId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: selectedSiteId,
        date_from: new Date(dateFrom).toISOString(),
        date_to: new Date(dateTo + "T23:59:59").toISOString(),
      });
      const res = await fetch(`/api/limpeza/preview?${params}`);
      if (!res.ok) throw new Error("Falha ao buscar preview");
      return res.json();
    },
    enabled: false,
    refetchOnWindowFocus: false,
    staleTime: 60000,
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/limpeza/execute", {
        site_id: parseInt(selectedSiteId, 10),
        date_from: new Date(dateFrom).toISOString(),
        date_to: new Date(dateTo + "T23:59:59").toISOString(),
      });
      return res.json() as Promise<LimpezaExecuteResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/limpeza/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setShowConfirmDialog(false);
      toast({
        title: "Limpeza concluída",
        description: `${data.totalDeleted} leilões excluídos, ${data.imagesDeleted} imagens removidas${data.errors > 0 ? `, ${data.errors} erros` : ""}`,
      });
    },
    onError: (error: Error) => {
      setShowConfirmDialog(false);
      toast({
        title: "Erro na limpeza",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const selectedSite = useMemo(() => {
    if (!sites || !selectedSiteId) return null;
    return sites.find((s) => s.id === parseInt(selectedSiteId, 10)) || null;
  }, [sites, selectedSiteId]);

  const filteredSites = useMemo(() => {
    if (!sites) return [];
    if (!siteSearch.trim()) return sites;
    const q = siteSearch.toLowerCase();
    return sites.filter(
      (s) =>
        s.nome_site?.toLowerCase().includes(q) ||
        s.url_site?.toLowerCase().includes(q) ||
        String(s.id).includes(q)
    );
  }, [sites, siteSearch]);

  const items = preview?.items ?? [];
  const filteredItems = searchQuery.trim()
    ? items.filter(
        (l) =>
          l.nome_do_anuncio?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          String(l.id).includes(searchQuery) ||
          l.link_anuncio?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  const isExecuting = executeMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Limpeza Seletiva
          </h1>
          <p className="text-sm text-muted-foreground">
            Exclua leilões de um leiloeiro específico em um período de datas para
            reprocessamento
          </p>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Filtros de Seleção
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-select">Leiloeiro (Site)</Label>
              {sitesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando sites...
                </div>
              ) : (
                <>
                  <Select
                    value={selectedSiteId}
                    onValueChange={(val) => setSelectedSiteId(val)}
                  >
                    <SelectTrigger data-testid="select-site" id="site-select">
                      <SelectValue placeholder="Selecione um leiloeiro..." />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="px-2 pb-2">
                        <Input
                          placeholder="Buscar site..."
                          value={siteSearch}
                          onChange={(e) => setSiteSearch(e.target.value)}
                          className="h-8"
                          data-testid="input-search-site"
                        />
                      </div>
                      {filteredSites.length === 0 ? (
                        <div className="py-3 text-center text-sm text-muted-foreground">
                          Nenhum site encontrado
                        </div>
                      ) : (
                        filteredSites.map((site) => (
                          <SelectItem
                            key={site.id}
                            value={String(site.id)}
                            data-testid={`select-site-option-${site.id}`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                #{site.id}
                              </span>
                              <span className="truncate">
                                {site.nome_site || site.url_site || `Site #${site.id}`}
                              </span>
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {selectedSite && (
                    <p className="text-xs text-muted-foreground">
                      {selectedSite.url_site || "Sem URL"}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date-from" className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Data Início
                </Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date-to" className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Data Fim
                </Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="input-date-to"
                />
              </div>
            </div>

            <Button
              onClick={() => refetchPreview()}
              disabled={!canPreview || previewFetching}
              className="w-full sm:w-auto"
              data-testid="button-preview-limpeza"
            >
              {previewFetching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar Leilões
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {canPreview && preview !== undefined && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Brush className="h-5 w-5 text-orange-500" />
                  <CardTitle className="text-lg">
                    Leilões Encontrados
                  </CardTitle>
                  <Badge variant="secondary" data-testid="badge-limpeza-count">
                    {items.length}{" "}
                    {items.length === 1 ? "leilão" : "leilões"}
                  </Badge>
                </div>
                {items.length > 0 && (
                  <div className="relative flex-1 sm:w-64 sm:flex-none">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filtrar por nome ou ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-limpeza"
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {previewLoading ? (
                <div className="flex items-center justify-center py-12 gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Buscando leilões...
                  </p>
                </div>
              ) : previewError ? (
                <div className="text-center py-8 space-y-2">
                  <AlertTriangle className="h-8 w-8 mx-auto text-red-500" />
                  <p className="text-sm text-muted-foreground">
                    Erro ao buscar leilões
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchPreview()}
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    Tentar novamente
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500/50" />
                  <p className="text-muted-foreground font-medium">
                    Nenhum leilão encontrado
                  </p>
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    Não há leilões para este site no período selecionado
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Image className="h-4 w-4" />
                      {preview.imagesCount} com imagem
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ImageOff className="h-4 w-4" />
                      {items.length - preview.imagesCount} sem imagem
                    </span>
                  </div>
                  <div className="rounded-md border max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">ID</TableHead>
                          <TableHead>Nome do Anúncio</TableHead>
                          <TableHead className="w-32 text-center">
                            Criado em
                          </TableHead>
                          <TableHead className="w-20 text-center">
                            Imagem
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell
                              className="font-mono text-xs"
                              data-testid={`text-limpeza-id-${item.id}`}
                            >
                              {item.id}
                            </TableCell>
                            <TableCell className="max-w-[350px]">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="truncate text-sm"
                                  title={item.nome_do_anuncio || "Sem nome"}
                                >
                                  {item.nome_do_anuncio || (
                                    <span className="text-muted-foreground italic">
                                      Sem nome
                                    </span>
                                  )}
                                </span>
                                {item.link_anuncio && (
                                  <a
                                    href={item.link_anuncio}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-foreground shrink-0"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center text-xs">
                              {formatDate(item.date_created)}
                            </TableCell>
                            <TableCell className="text-center">
                              {item.has_image ? (
                                <Image className="h-4 w-4 mx-auto text-blue-500" />
                              ) : (
                                <span className="text-muted-foreground/40">
                                  —
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {searchQuery &&
                    filteredItems.length !== items.length && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Exibindo {filteredItems.length} de {items.length}{" "}
                        resultados
                      </p>
                    )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {canPreview && preview && items.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={() => setShowConfirmDialog(true)}
                disabled={isExecuting}
                data-testid="button-execute-limpeza"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Excluindo leilões...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Excluir {items.length} leilões
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Limpeza Seletiva</DialogTitle>
            <DialogDescription>
              Você está prestes a excluir permanentemente{" "}
              <strong>{items.length}</strong> leilões do site{" "}
              <strong>
                {selectedSite?.nome_site || `#${selectedSiteId}`}
              </strong>
              .
              {preview && preview.imagesCount > 0 && (
                <>
                  {" "}
                  As imagens de <strong>{preview.imagesCount}</strong> leilões
                  também serão excluídas do Directus.
                </>
              )}
              <br />
              <br />
              <span className="text-red-500 font-medium">
                Esta ação é irreversível.
              </span>{" "}
              Deseja continuar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              data-testid="button-cancel-limpeza"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending}
              data-testid="button-confirm-limpeza"
            >
              {executeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Excluindo...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Confirmar Exclusão
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
