import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Site } from "@shared/schema";
import { ThemeToggle } from "@/components/theme-toggle";
import investLogo from "@assets/Icon_Invest_1769010072868.jpg";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Search,
  Play,
  Settings,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Globe,
  Zap,
  Eye,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ScanSearch,
  Bot,
  Square,
  CheckSquare,
  Power,
  PowerOff,
  PlayCircle,
  Pause,
  RotateCcw,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";

const ITEMS_PER_PAGE = 15;

function SitesTable({
  onStartOnboarding,
  onStartScraping,
  onViewConfig,
}: {
  onStartOnboarding: (site: Site) => void;
  onStartScraping: (site: Site) => void;
  onViewConfig: (site: Site) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterConfig, setFilterConfig] = useState<"all" | "with" | "without">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("active");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const { data: sites, isLoading } = useQuery<Site[]>({
    queryKey: ["/api/scraping/sites"],
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ siteId, newStatus }: { siteId: number; newStatus: "ligado" | "desligado" }) => {
      await apiRequest("PATCH", `/api/scraping/sites/${siteId}/status`, { liga_desliga: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraping/sites"] });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar status", description: error.message, variant: "destructive" });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ siteIds, newStatus }: { siteIds: number[]; newStatus: "ligado" | "desligado" }) => {
      const res = await apiRequest("PATCH", "/api/scraping/sites/bulk-status", { siteIds, liga_desliga: newStatus });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraping/sites"] });
      setSelectedIds(new Set());
      toast({
        title: "Status atualizado em massa",
        description: `${data.succeeded} de ${data.total} sites atualizados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar em massa", description: error.message, variant: "destructive" });
    },
  });

  const filtered = (sites || []).filter((site) => {
    const matchSearch =
      !search ||
      site.nome_site?.toLowerCase().includes(search.toLowerCase()) ||
      site.url_site?.toLowerCase().includes(search.toLowerCase());
    const matchConfig =
      filterConfig === "all" ||
      (filterConfig === "with" && site.scraping_config) ||
      (filterConfig === "without" && !site.scraping_config);
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "active" && site.liga_desliga === "ligado") ||
      (filterStatus === "inactive" && site.liga_desliga !== "ligado");
    return matchSearch && matchConfig && matchStatus;
  });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, filterConfig, filterStatus]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pageIds = paged.map((s) => s.id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((s) => s.id)));
  };

  const pageAllSelected = paged.length > 0 && paged.every((s) => selectedIds.has(s.id));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-10 w-full" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Sites de Leiloeiros ({filtered.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou URL..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-sites"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={filterStatus === "active" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("active")}
              data-testid="button-filter-active"
            >
              Ativos
            </Button>
            <Button
              variant={filterStatus === "inactive" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("inactive")}
              data-testid="button-filter-inactive"
            >
              Inativos
            </Button>
            <Button
              variant={filterStatus === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("all")}
              data-testid="button-filter-all-status"
            >
              Todos
            </Button>
            <span className="border-l mx-1" />
            <Button
              variant={filterConfig === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterConfig("all")}
              data-testid="button-filter-all"
            >
              Todos Config
            </Button>
            <Button
              variant={filterConfig === "with" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterConfig("with")}
              data-testid="button-filter-with-config"
            >
              Com Config
            </Button>
            <Button
              variant={filterConfig === "without" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterConfig("without")}
              data-testid="button-filter-without-config"
            >
              Sem Config
            </Button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between gap-3 p-3 bg-primary/5 border rounded-md flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <CheckSquare className="h-4 w-4 text-primary" />
              <span className="font-medium">{selectedIds.size} selecionado(s)</span>
              {selectedIds.size < filtered.length && (
                <Button variant="ghost" size="sm" onClick={selectAllFiltered} className="px-1 h-auto text-primary underline" data-testid="button-select-all-filtered">
                  Selecionar todos os {filtered.length}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="px-1 h-auto text-muted-foreground underline" data-testid="button-clear-selection">
                Limpar
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => bulkStatusMutation.mutate({ siteIds: Array.from(selectedIds), newStatus: "ligado" })}
                disabled={bulkStatusMutation.isPending}
                data-testid="button-bulk-activate"
              >
                <Power className="h-3.5 w-3.5 mr-1" />
                Ativar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkStatusMutation.mutate({ siteIds: Array.from(selectedIds), newStatus: "desligado" })}
                disabled={bulkStatusMutation.isPending}
                data-testid="button-bulk-deactivate"
              >
                <PowerOff className="h-3.5 w-3.5 mr-1" />
                Desativar
              </Button>
            </div>
          </div>
        )}

        <div className="border rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 w-10">
                    <Checkbox
                      checked={pageAllSelected}
                      onCheckedChange={toggleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="text-left p-3 font-medium">Site</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">URL</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Config</th>
                  <th className="text-center p-3 font-medium hidden lg:table-cell">Último Scraping</th>
                  <th className="text-center p-3 font-medium hidden lg:table-cell">URLs</th>
                  <th className="text-right p-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((site) => {
                  const hasConfig = !!site.scraping_config;
                  return (
                    <tr
                      key={site.id}
                      className="border-b last:border-b-0 hover-elevate"
                      data-testid={`row-site-${site.id}`}
                    >
                      <td className="p-3 w-10">
                        <Checkbox
                          checked={selectedIds.has(site.id)}
                          onCheckedChange={() => toggleSelect(site.id)}
                          data-testid={`checkbox-site-${site.id}`}
                        />
                      </td>
                      <td className="p-3">
                        <span className="font-medium">{site.nome_site || `Site #${site.id}`}</span>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <span className="text-muted-foreground text-xs truncate max-w-[300px] block">
                          {site.url_site || site.url_listagem || "—"}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => toggleStatusMutation.mutate({
                            siteId: site.id,
                            newStatus: site.liga_desliga === "ligado" ? "desligado" : "ligado",
                          })}
                          disabled={toggleStatusMutation.isPending}
                          className="cursor-pointer"
                          data-testid={`button-toggle-status-${site.id}`}
                        >
                          <Badge variant={site.liga_desliga === "ligado" ? "default" : "secondary"}>
                            {site.liga_desliga === "ligado" ? "Ativo" : "Inativo"}
                          </Badge>
                        </button>
                      </td>
                      <td className="p-3 text-center">
                        {hasConfig ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onViewConfig(site)}
                            data-testid={`button-view-config-${site.id}`}
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          </Button>
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </td>
                      <td className="p-3 text-center hidden lg:table-cell">
                        {site.last_scraping_at ? (
                          <span className="text-xs text-muted-foreground" title={new Date(site.last_scraping_at).toLocaleString("pt-BR")}>
                            {formatDistanceToNow(new Date(site.last_scraping_at), { addSuffix: true, locale: ptBR })}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center hidden lg:table-cell">
                        {site.last_scraping_urls_found != null && site.last_scraping_urls_found > 0 ? (
                          <Badge variant="secondary" data-testid={`badge-urls-${site.id}`}>
                            {site.last_scraping_urls_found}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onStartOnboarding(site)}
                            data-testid={`button-onboard-${site.id}`}
                          >
                            <ScanSearch className="h-3.5 w-3.5 mr-1" />
                            <span className="hidden lg:inline">Analisar</span>
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => onStartScraping(site)}
                            disabled={!hasConfig}
                            data-testid={`button-scrape-${site.id}`}
                          >
                            <Play className="h-3.5 w-3.5 mr-1" />
                            <span className="hidden lg:inline">Scraping</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      Nenhum site encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function JobsPanel() {
  const { data: jobsData, isLoading } = useQuery<{ jobs: Record<string, unknown>[] }>({
    queryKey: ["/api/scraping/jobs"],
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/scraping/jobs/${jobId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraping/jobs"] });
    },
  });

  const jobs = jobsData?.jobs || [];

  function getStatusBadge(status: string) {
    switch (status) {
      case "completed":
        return <Badge variant="default">Concluído</Badge>;
      case "running":
      case "in_progress":
        return <Badge className="bg-blue-500 border-blue-500 text-white">Em Execução</Badge>;
      case "failed":
      case "error":
        return <Badge variant="destructive">Erro</Badge>;
      case "pending":
      case "queued":
        return <Badge variant="secondary">Na Fila</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Jobs de Scraping
        </CardTitle>
        <Button
          variant="outline"
          size="icon"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/scraping/jobs"] })}
          data-testid="button-refresh-jobs"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            Nenhum job encontrado. Inicie um scraping para ver os resultados aqui.
          </p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job: Record<string, unknown>, idx: number) => {
              const jobId = (job.job_id as string) || `job-${idx}`;
              const status = (job.status as string) || "unknown";
              const isRunning = status === "running" || status === "in_progress";
              const progress = (job.progress as number) || 0;
              const urlsFound = (job.urls_found as number) || (job.result as Record<string, unknown>)?.total_urls as number || 0;
              const pagesProcessed = (job.pages_processed as number) || (job.result as Record<string, unknown>)?.pages_processed as number || 0;
              const siteUrl = (job.url as string) || (job.site_url as string) || "";
              const siteName = (job.site_name as string) || "";

              return (
                <div
                  key={jobId}
                  className="border rounded-md p-3 space-y-2"
                  data-testid={`job-card-${jobId}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isRunning && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
                      {siteName ? (
                        <span className="text-sm font-medium truncate" data-testid={`job-site-name-${jobId}`}>
                          {siteName}
                        </span>
                      ) : (
                        <span className="text-xs font-mono truncate text-muted-foreground">
                          {jobId}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(status)}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(jobId)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-job-${jobId}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {siteUrl && (
                    <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground truncate block hover:underline" data-testid={`job-site-url-${jobId}`}>{siteUrl}</a>
                  )}

                  {isRunning && progress > 0 && (
                    <div className="space-y-1">
                      <Progress value={progress} className="h-2" />
                      <p className="text-xs text-muted-foreground">{Math.round(progress)}% concluído</p>
                    </div>
                  )}

                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {pagesProcessed > 0 && (
                      <span>{pagesProcessed} páginas</span>
                    )}
                    {urlsFound > 0 && (
                      <span className="font-medium text-foreground">{urlsFound} URLs encontradas</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OnboardingDialog({
  site,
  open,
  onOpenChange,
}: {
  site: Site | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [maxPages, setMaxPages] = useState("30");
  const [model, setModel] = useState("gpt-4o-mini");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const { toast } = useToast();

  const AI_MODELS = [
    { value: "gpt-4o-mini", label: "GPT-4o Mini", desc: "Rápido e econômico" },
    { value: "gpt-4o", label: "GPT-4o", desc: "Mais capaz, custo moderado" },
    { value: "gpt-4.1", label: "GPT-4.1", desc: "Mais recente, forte em código" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", desc: "Versão leve do 4.1" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", desc: "Ultra-leve e rápido" },
    { value: "o3-mini", label: "o3 Mini", desc: "Raciocínio avançado, compacto" },
    { value: "o4-mini", label: "o4 Mini", desc: "Raciocínio mais recente" },
  ];

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/scraping/onboard", {
        siteId: site?.id,
        siteUrl: site?.url_site || site?.url_listagem,
        maxPages: parseInt(maxPages) || 30,
        model,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/scraping/sites"] });
      toast({
        title: "Onboarding concluído",
        description: "A configuração foi salva no site.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro no onboarding",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!open) {
      setResult(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Analisar Estrutura do Site
          </DialogTitle>
          <DialogDescription>
            O agente de IA vai navegar o site e identificar padrões de URLs, paginação e estrutura para configurar o scraping automático.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <Label className="text-sm font-medium">Site</Label>
            <p className="text-sm font-semibold mt-1">{site?.nome_site || `Site #${site?.id}`}</p>
            <p className="text-xs text-muted-foreground">{site?.url_site || site?.url_listagem}</p>
          </div>

          <div>
            <Label className="text-sm font-medium">Modelo de IA</Label>
            <Select value={model} onValueChange={setModel} disabled={mutation.isPending}>
              <SelectTrigger data-testid="select-model-onboard">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value} data-testid={`select-model-${m.value}`}>
                    <span className="font-medium">{m.label}</span>
                    <span className="text-muted-foreground ml-2">— {m.desc}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="maxPages" className="text-sm font-medium">Máximo de páginas a explorar</Label>
            <Input
              id="maxPages"
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              min="5"
              max="100"
              disabled={mutation.isPending}
              data-testid="input-max-pages-onboard"
            />
          </div>

          {mutation.isPending && (
            <div className="flex items-center gap-3 p-4 bg-blue-500/10 rounded-md">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <div>
                <p className="text-sm font-medium">Analisando site...</p>
                <p className="text-xs text-muted-foreground">Isso pode levar alguns minutos</p>
              </div>
            </div>
          )}

          {result && (
            <div className="p-4 bg-green-500/10 rounded-md space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <p className="text-sm font-medium">Análise concluída</p>
              </div>
              {"config_id" in result && result.config_id ? (
                <p className="text-xs text-muted-foreground">
                  Config ID: <span className="font-mono">{String(result.config_id)}</span>
                </p>
              ) : null}
              {"config" in result && result.config ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Ver configuração gerada</summary>
                  <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
                    {JSON.stringify(result.config, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-onboard"
          >
            {result ? "Fechar" : "Cancelar"}
          </Button>
          {!result && (
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              data-testid="button-start-onboard"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Analisando...
                </>
              ) : (
                <>
                  <ScanSearch className="h-4 w-4 mr-2" />
                  Iniciar Análise
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScrapingDialog({
  site,
  open,
  onOpenChange,
}: {
  site: Site | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [maxPages, setMaxPages] = useState("100");
  const [concurrentRequests, setConcurrentRequests] = useState("10");
  const { toast } = useToast();

  const config = site?.scraping_config ? (() => {
    if (typeof site.scraping_config === "object") return site.scraping_config;
    try {
      return JSON.parse(site.scraping_config);
    } catch {
      return null;
    }
  })() : null;

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/scraping/scrape", {
        siteUrl: site?.url_site || site?.url_listagem,
        config,
        maxPages: parseInt(maxPages) || 100,
        concurrentRequests: parseInt(concurrentRequests) || 10,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraping/jobs"] });
      toast({
        title: "Scraping iniciado",
        description: `Job ${data.job_id || ""} criado. Acompanhe o progresso no painel de Jobs.`,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao iniciar scraping",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Iniciar Scraping
          </DialogTitle>
          <DialogDescription>
            O scraper vai extrair URLs de imóveis usando a configuração salva. Os resultados serão enviados ao N8n via webhook.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Site</Label>
            <p className="text-sm font-semibold mt-1">{site?.nome_site || `Site #${site?.id}`}</p>
            <p className="text-xs text-muted-foreground">{site?.url_site || site?.url_listagem}</p>
          </div>

          {!config && (
            <div className="p-4 bg-red-500/10 rounded-md">
              <p className="text-sm text-red-500 font-medium">
                Nenhuma configuração encontrada. Execute o Onboarding primeiro.
              </p>
            </div>
          )}

          {config && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="maxPagesScrape" className="text-sm font-medium">Máximo de páginas</Label>
                  <Input
                    id="maxPagesScrape"
                    type="number"
                    value={maxPages}
                    onChange={(e) => setMaxPages(e.target.value)}
                    min="10"
                    max="500"
                    data-testid="input-max-pages-scrape"
                  />
                </div>
                <div>
                  <Label htmlFor="concurrent" className="text-sm font-medium">Requisições paralelas</Label>
                  <Input
                    id="concurrent"
                    type="number"
                    value={concurrentRequests}
                    onChange={(e) => setConcurrentRequests(e.target.value)}
                    min="1"
                    max="20"
                    data-testid="input-concurrent"
                  />
                </div>
              </div>

              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground">
                  Webhook de callback: <span className="font-mono">n8n-invest...webhook/retornascrapapi</span>
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-scrape"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !config}
            data-testid="button-start-scrape"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Iniciando...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Iniciar Scraping
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigDialog({
  site,
  open,
  onOpenChange,
}: {
  site: Site | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const config = site?.scraping_config ? (() => {
    if (typeof site.scraping_config === "object") return site.scraping_config;
    try {
      return JSON.parse(site.scraping_config);
    } catch {
      return site.scraping_config;
    }
  })() : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuração de Scraping
          </DialogTitle>
          <DialogDescription>
            {site?.nome_site || `Site #${site?.id}`}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-auto max-h-[50vh]">
          {config ? (
            <pre className="p-4 bg-muted rounded-md text-xs overflow-auto whitespace-pre-wrap">
              {typeof config === "string" ? config : JSON.stringify(config, null, 2)}
            </pre>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              Nenhuma configuração salva.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-config">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type QueueItemStatus = "waiting" | "onboarding" | "scraping" | "completed" | "error";

interface QueueItem {
  site: Site;
  status: QueueItemStatus;
  error?: string;
  jobId?: string;
}

function BatchProcessingPanel({ sites }: { sites: Site[] }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const pausedRef = useRef(false);
  const abortRef = useRef(false);
  const { toast } = useToast();

  const MAX_ONBOARDING = 4;
  const MAX_SCRAPING = 10;

  const stats = {
    total: queue.length,
    waiting: queue.filter((q) => q.status === "waiting").length,
    onboarding: queue.filter((q) => q.status === "onboarding").length,
    scraping: queue.filter((q) => q.status === "scraping").length,
    completed: queue.filter((q) => q.status === "completed").length,
    error: queue.filter((q) => q.status === "error").length,
  };

  const progressPercent = stats.total > 0 ? Math.round(((stats.completed + stats.error) / stats.total) * 100) : 0;

  const updateItem = (siteId: number, updates: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => q.site.id === siteId ? { ...q, ...updates } : q));
  };

  const waitWhilePaused = async () => {
    while (pausedRef.current && !abortRef.current) {
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const processOnboarding = async (item: QueueItem): Promise<Record<string, unknown> | null> => {
    updateItem(item.site.id, { status: "onboarding" });
    try {
      const response = await fetch("/api/scraping/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: item.site.id,
          siteUrl: item.site.url_site || item.site.url_listagem,
          maxPages: 30,
          model: "gpt-4o-mini",
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
      }
      const result = await response.json();
      return result.config || null;
    } catch (e: any) {
      updateItem(item.site.id, { status: "error", error: `Onboarding: ${e.message?.slice(0, 100)}` });
      return null;
    }
  };

  const processScraping = async (item: QueueItem, config: Record<string, unknown>) => {
    updateItem(item.site.id, { status: "scraping" });
    try {
      const response = await fetch("/api/scraping/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteUrl: item.site.url_site || item.site.url_listagem,
          config,
          maxPages: 100,
          concurrentRequests: 10,
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
      }
      const result = await response.json();
      updateItem(item.site.id, { status: "completed", jobId: result.job_id });
    } catch (e: any) {
      updateItem(item.site.id, { status: "error", error: `Scraping: ${e.message?.slice(0, 100)}` });
    }
  };

  const runQueue = async (items: QueueItem[]) => {
    setIsRunning(true);
    setIsPaused(false);
    pausedRef.current = false;
    abortRef.current = false;

    const needsOnboarding = items.filter((i) => !i.site.scraping_config);
    const hasConfig = items.filter((i) => !!i.site.scraping_config);

    const scrapingQueue: { item: QueueItem; config: Record<string, unknown> }[] = hasConfig.map((i) => {
      let config = i.site.scraping_config;
      if (typeof config === "string") try { config = JSON.parse(config); } catch {}
      return { item: i, config: config as Record<string, unknown> };
    });

    let scrapingIndex = 0;
    let activeScrapingCount = 0;
    const scrapingDone: Promise<void>[] = [];

    const launchScraping = () => {
      while (activeScrapingCount < MAX_SCRAPING && scrapingIndex < scrapingQueue.length && !abortRef.current) {
        const idx = scrapingIndex++;
        activeScrapingCount++;
        const p = (async () => {
          await waitWhilePaused();
          if (!abortRef.current) {
            await processScraping(scrapingQueue[idx].item, scrapingQueue[idx].config);
          }
          activeScrapingCount--;
          launchScraping();
        })();
        scrapingDone.push(p);
      }
    };

    launchScraping();

    let onboardingIndex = 0;
    let activeOnboardingCount = 0;
    await new Promise<void>((resolveAll) => {
      const tryLaunchOnboarding = () => {
        while (activeOnboardingCount < MAX_ONBOARDING && onboardingIndex < needsOnboarding.length && !abortRef.current) {
          const idx = onboardingIndex++;
          activeOnboardingCount++;
          (async () => {
            await waitWhilePaused();
            if (!abortRef.current) {
              const config = await processOnboarding(needsOnboarding[idx]);
              if (config && !abortRef.current) {
                scrapingQueue.push({ item: needsOnboarding[idx], config });
                launchScraping();
              }
            }
            activeOnboardingCount--;
            if (activeOnboardingCount === 0 && onboardingIndex >= needsOnboarding.length) {
              resolveAll();
            } else {
              tryLaunchOnboarding();
            }
          })();
        }
        if (needsOnboarding.length === 0) resolveAll();
      };
      tryLaunchOnboarding();
    });

    await Promise.allSettled(scrapingDone);

    while (scrapingIndex < scrapingQueue.length && !abortRef.current) {
      await new Promise<void>((resolve) => {
        const check = () => {
          launchScraping();
          if (scrapingIndex >= scrapingQueue.length || abortRef.current) resolve();
          else setTimeout(check, 200);
        };
        check();
      });
      await Promise.allSettled(scrapingDone);
    }

    while (activeScrapingCount > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }

    queryClient.invalidateQueries({ queryKey: ["/api/scraping/sites"] });
    queryClient.invalidateQueries({ queryKey: ["/api/scraping/jobs"] });
    setIsRunning(false);
    setIsPaused(false);
  };

  const startProcessing = (sitesToProcess: Site[]) => {
    const items: QueueItem[] = sitesToProcess.map((site) => ({ site, status: "waiting" as QueueItemStatus }));
    setQueue(items);
    runQueue(items);
  };

  const handlePauseResume = () => {
    if (isPaused) {
      pausedRef.current = false;
      setIsPaused(false);
    } else {
      pausedRef.current = true;
      setIsPaused(true);
    }
  };

  const handleCancel = () => {
    abortRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);
    toast({ title: "Processamento cancelado", description: "Aguardando tarefas em andamento finalizarem..." });
  };

  const activeSites = sites.filter((s) => s.liga_desliga === "ligado");

  if (!isRunning && queue.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5" />
            Processamento em Massa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Processe todos os sites ativos automaticamente. Sites sem configuração passarão pelo onboarding primeiro, depois pelo scraping.
          </p>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Limites: {MAX_ONBOARDING} onboarding simultâneos, {MAX_SCRAPING} scrapings simultâneos</span>
          </div>
          <Button
            onClick={() => startProcessing(activeSites)}
            disabled={activeSites.length === 0}
            data-testid="button-start-batch"
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Processar {activeSites.length} Sites Ativos
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5" />
          Processamento em Massa
        </CardTitle>
        <div className="flex items-center gap-2">
          {isRunning && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePauseResume}
                data-testid="button-pause-resume"
              >
                {isPaused ? <Play className="h-3.5 w-3.5 mr-1" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                {isPaused ? "Retomar" : "Pausar"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                data-testid="button-cancel-batch"
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Cancelar
              </Button>
            </>
          )}
          {!isRunning && queue.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setQueue([]); }}
              data-testid="button-clear-batch"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Limpar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>{stats.completed + stats.error} / {stats.total} processados</span>
            <span>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-lg font-bold">{stats.waiting}</p>
            <p className="text-xs text-muted-foreground">Na Fila</p>
          </div>
          <div className="text-center p-2 rounded-md bg-blue-500/10">
            <p className="text-lg font-bold text-blue-500">{stats.onboarding}</p>
            <p className="text-xs text-muted-foreground">Onboarding ({MAX_ONBOARDING} max)</p>
          </div>
          <div className="text-center p-2 rounded-md bg-indigo-500/10">
            <p className="text-lg font-bold text-indigo-500">{stats.scraping}</p>
            <p className="text-xs text-muted-foreground">Scraping ({MAX_SCRAPING} max)</p>
          </div>
          <div className="text-center p-2 rounded-md bg-green-500/10">
            <p className="text-lg font-bold text-green-500">{stats.completed}</p>
            <p className="text-xs text-muted-foreground">Concluídos</p>
          </div>
          <div className="text-center p-2 rounded-md bg-red-500/10">
            <p className="text-lg font-bold text-red-500">{stats.error}</p>
            <p className="text-xs text-muted-foreground">Erros</p>
          </div>
        </div>

        {isPaused && (
          <div className="flex items-center gap-2 p-3 bg-yellow-500/10 rounded-md text-sm">
            <Pause className="h-4 w-4 text-yellow-500" />
            <span>Processamento pausado. Clique em "Retomar" para continuar.</span>
          </div>
        )}

        <div className="max-h-60 overflow-y-auto space-y-1">
          {queue.filter((q) => q.status !== "waiting").slice(-30).reverse().map((item) => (
            <div
              key={item.site.id}
              className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded-md bg-muted/30"
              data-testid={`batch-item-${item.site.id}`}
            >
              <span className="truncate flex-1 font-medium">{item.site.nome_site}</span>
              {item.status === "onboarding" && (
                <Badge className="bg-blue-500 border-blue-500 text-white shrink-0">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Onboarding
                </Badge>
              )}
              {item.status === "scraping" && (
                <Badge className="bg-indigo-500 border-indigo-500 text-white shrink-0">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Scraping
                </Badge>
              )}
              {item.status === "completed" && (
                <Badge variant="default" className="shrink-0">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  OK
                </Badge>
              )}
              {item.status === "error" && (
                <Badge variant="destructive" className="shrink-0" title={item.error}>
                  <XCircle className="h-3 w-3 mr-1" />
                  Erro
                </Badge>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ApiStatusBadge() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/scraping/status"],
    refetchInterval: 30000,
  });

  if (isLoading) return <Badge variant="secondary"><Loader2 className="h-3 w-3 animate-spin mr-1" />API</Badge>;
  if (isError) return <Badge variant="destructive">API Offline</Badge>;
  return <Badge variant="default">API Online</Badge>;
}

export default function ScrapingPage() {
  const [onboardSite, setOnboardSite] = useState<Site | null>(null);
  const [scrapeSite, setScrapeSite] = useState<Site | null>(null);
  const [configSite, setConfigSite] = useState<Site | null>(null);

  const { data: allSites } = useQuery<Site[]>({
    queryKey: ["/api/scraping/sites"],
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <img
              src={investLogo}
              alt="Invest Leilões"
              className="h-12 w-12 rounded-xl object-contain"
            />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">AI Scraping</h1>
              <p className="text-sm text-muted-foreground">
                Análise e extração automatizada de leilões
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ApiStatusBadge />
            <Link href="/">
              <Button variant="outline" className="gap-2" data-testid="button-back-dashboard">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <BatchProcessingPanel sites={allSites || []} />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <SitesTable
              onStartOnboarding={setOnboardSite}
              onStartScraping={setScrapeSite}
              onViewConfig={setConfigSite}
            />
          </div>
          <div>
            <JobsPanel />
          </div>
        </div>
      </div>

      <OnboardingDialog
        site={onboardSite}
        open={!!onboardSite}
        onOpenChange={(open) => { if (!open) setOnboardSite(null); }}
      />
      <ScrapingDialog
        site={scrapeSite}
        open={!!scrapeSite}
        onOpenChange={(open) => { if (!open) setScrapeSite(null); }}
      />
      <ConfigDialog
        site={configSite}
        open={!!configSite}
        onOpenChange={(open) => { if (!open) setConfigSite(null); }}
      />
    </div>
  );
}
