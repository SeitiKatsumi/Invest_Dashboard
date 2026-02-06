import { useState, useEffect } from "react";
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
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

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
  const [page, setPage] = useState(1);

  const { data: sites, isLoading } = useQuery<Site[]>({
    queryKey: ["/api/scraping/sites"],
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
    return matchSearch && matchConfig;
  });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, filterConfig]);

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
          <div className="flex gap-2">
            <Button
              variant={filterConfig === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterConfig("all")}
              data-testid="button-filter-all"
            >
              Todos
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

        <div className="border rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Site</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">URL</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Config</th>
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
                      <td className="p-3">
                        <span className="font-medium">{site.nome_site || `Site #${site.id}`}</span>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <span className="text-muted-foreground text-xs truncate max-w-[300px] block">
                          {site.url_site || site.url_listagem || "—"}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant={site.liga_desliga === "ligado" ? "default" : "secondary"}>
                          {site.liga_desliga === "ligado" ? "Ativo" : "Inativo"}
                        </Badge>
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
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
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
            {jobs.map((job: Record<string, unknown>) => {
              const jobId = job.job_id as string;
              const status = (job.status as string) || "unknown";
              const isRunning = status === "running" || status === "in_progress";
              const progress = (job.progress as number) || 0;
              const urlsFound = (job.urls_found as number) || (job.result as Record<string, unknown>)?.total_urls as number || 0;
              const pagesProcessed = (job.pages_processed as number) || (job.result as Record<string, unknown>)?.pages_processed as number || 0;
              const siteUrl = (job.url as string) || (job.site_url as string) || "";

              return (
                <div
                  key={jobId}
                  className="border rounded-md p-3 space-y-2"
                  data-testid={`job-card-${jobId}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {isRunning && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
                      <span className="text-xs font-mono truncate text-muted-foreground">
                        {jobId}
                      </span>
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
                    <p className="text-xs text-muted-foreground truncate">{siteUrl}</p>
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Analisar Estrutura do Site
          </DialogTitle>
          <DialogDescription>
            O agente de IA vai navegar o site e identificar padrões de URLs, paginação e estrutura para configurar o scraping automático.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                  <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-48">
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
