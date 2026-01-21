import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, CheckCircle2, AlertTriangle, XCircle, LinkIcon } from "lucide-react";
import { LogScraping, Site } from "@shared/schema";
import { StatusBadge } from "./status-badge";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis } from "recharts";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LogsPanelProps {
  total: number;
  sucesso: number;
  sucessoParcial: number;
  erro: number;
  urlInvalida: number;
  recentLogs: LogScraping[];
}

const COLORS = ["#10b981", "#f59e0b", "#ef4444", "#f97316"];

export function LogsPanel({
  total,
  sucesso,
  sucessoParcial,
  erro,
  urlInvalida,
  recentLogs,
}: LogsPanelProps) {
  const statusData = [
    { name: "Sucesso", value: sucesso },
    { name: "Parcial", value: sucessoParcial },
    { name: "Erro", value: erro },
    { name: "URL Inválida", value: urlInvalida },
  ].filter((d) => d.value > 0);

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

  return (
    <Card className="overflow-visible col-span-full" data-testid="panel-logs">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-3/10">
              <Activity className="h-5 w-5 text-chart-3" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold">Logs de Scraping</CardTitle>
              <p className="text-sm text-muted-foreground">{total.toLocaleString("pt-BR")} registros de validação</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">{sucesso.toLocaleString("pt-BR")}</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">{sucessoParcial.toLocaleString("pt-BR")}</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium">{erro.toLocaleString("pt-BR")}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Distribution */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Distribuição de Status</h4>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {statusData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Logs */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Logs Recentes</h4>
            <ScrollArea className="h-[200px]">
              <div className="space-y-2 pr-3">
                {recentLogs.length > 0 ? (
                  recentLogs.slice(0, 10).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                      data-testid={`log-item-${log.id}`}
                    >
                      {getStatusIcon(log.status_scraping)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">
                            {getSiteName(log.site)}
                          </span>
                          <StatusBadge status={log.status_scraping || "unknown"} />
                        </div>
                        {log.motivo_do_erro && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {log.motivo_do_erro}
                          </p>
                        )}
                        {log.date_created && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(log.date_created), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-sm text-muted-foreground">Nenhum log recente</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
