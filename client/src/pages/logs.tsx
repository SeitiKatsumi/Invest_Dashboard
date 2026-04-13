import { useQuery } from "@tanstack/react-query";
import { LogScraping, Site } from "@shared/schema";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  RefreshCw, 
  AlertCircle,
  Search,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  LinkIcon,
  Activity
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState, useMemo } from "react";

interface LogsResponse {
  logs: LogScraping[];
  total: number;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 mx-auto">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold">Erro ao carregar logs</h2>
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar os logs. Verifique a conexão e tente novamente.
          </p>
          <Button onClick={onRetry} className="gap-2" data-testid="button-retry">
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

const getStatusIcon = (status: string | null) => {
  switch (status) {
    case "successes":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "successes_partial":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "erro":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "url_inválida":
      return <LinkIcon className="h-4 w-4 text-orange-500" />;
    default:
      return <Activity className="h-4 w-4 text-gray-400" />;
  }
};

const getSiteName = (site: number | Site | null): string => {
  if (!site) return "N/A";
  if (typeof site === "object" && site.nome_site) return site.nome_site;
  return `Site #${site}`;
};

const getSiteUrl = (site: number | Site | null): string | null => {
  if (!site) return null;
  if (typeof site === "object" && site.url_site) return site.url_site;
  return null;
};

export default function LogsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<LogsResponse>({
    queryKey: ["/api/logs"],
    refetchInterval: 60000,
  });

  const filteredLogs = useMemo(() => {
    if (!data?.logs) return [];
    
    return data.logs.filter((log) => {
      const matchesStatus = statusFilter === "all" || log.status_scraping === statusFilter;
      
      const siteName = getSiteName(log.site).toLowerCase();
      const motivo = (log.motivo_do_erro || "").toLowerCase();
      const query = searchQuery.toLowerCase();
      const matchesSearch = !query || siteName.includes(query) || motivo.includes(query);
      
      return matchesStatus && matchesSearch;
    });
  }, [data?.logs, statusFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    if (!data?.logs) return { successes: 0, successes_partial: 0, erro: 0, url_inválida: 0 };
    
    return data.logs.reduce((acc, log) => {
      const status = log.status_scraping || "unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [data?.logs]);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Logs de Scraping</h1>
            <p className="text-sm text-muted-foreground">
              {data.total.toLocaleString("pt-BR")} registros no total
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </header>

        {/* Status Summary */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>{(statusCounts["successes"] || 0).toLocaleString("pt-BR")} Sucesso</span>
          </Badge>
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span>{(statusCounts["successes_partial"] || 0).toLocaleString("pt-BR")} Parcial</span>
          </Badge>
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <XCircle className="h-3.5 w-3.5 text-red-500" />
            <span>{(statusCounts["erro"] || 0).toLocaleString("pt-BR")} Erro</span>
          </Badge>
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <LinkIcon className="h-3.5 w-3.5 text-orange-500" />
            <span>{(statusCounts["url_inválida"] || 0).toLocaleString("pt-BR")} URL Inválida</span>
          </Badge>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por site ou motivo do erro..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search"
                  />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Filtrar por status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="successes">Sucesso</SelectItem>
                  <SelectItem value="successes_partial">Sucesso Parcial</SelectItem>
                  <SelectItem value="erro">Erro</SelectItem>
                  <SelectItem value="url_inválida">URL Inválida</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {filteredLogs.length.toLocaleString("pt-BR")} registros encontrados
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[50px]">Status</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead className="hidden md:table-cell">Motivo do Erro</TableHead>
                    <TableHead className="w-[150px]">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.length > 0 ? (
                    filteredLogs.map((log) => (
                      <TableRow key={log.id} data-testid={`log-row-${log.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(log.status_scraping)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{getSiteName(log.site)}</div>
                            {getSiteUrl(log.site) && (
                              <a
                                href={getSiteUrl(log.site)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground hover:text-primary truncate block max-w-[250px]"
                              >
                                {getSiteUrl(log.site)}
                              </a>
                            )}
                            <div className="md:hidden text-xs text-muted-foreground line-clamp-2">
                              {log.motivo_do_erro || "-"}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-sm text-muted-foreground line-clamp-2">
                            {log.motivo_do_erro || "-"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {log.date_created ? (
                            <div className="space-y-0.5">
                              <div className="text-sm">
                                {format(new Date(log.date_created), "dd/MM/yyyy", { locale: ptBR })}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {format(new Date(log.date_created), "HH:mm:ss", { locale: ptBR })}
                              </div>
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Search className="h-8 w-8" />
                          <p>Nenhum log encontrado</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-center py-4 text-sm text-muted-foreground border-t">
          <p>Logs de Scraping • Dados atualizados a cada 60 segundos</p>
        </footer>
      </div>
    </div>
  );
}
