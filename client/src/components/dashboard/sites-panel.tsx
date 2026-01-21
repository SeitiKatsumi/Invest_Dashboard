import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Power, PowerOff, ExternalLink } from "lucide-react";
import { Site } from "@shared/schema";
import { StatusBadge } from "./status-badge";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface SitesPanelProps {
  total: number;
  ligados: number;
  desligados: number;
  sites: Site[];
}

const COLORS = ["#10b981", "#6b7280"];

export function SitesPanel({ total, ligados, desligados, sites }: SitesPanelProps) {
  const chartData = [
    { name: "Ligados", value: ligados },
    { name: "Desligados", value: desligados },
  ];

  return (
    <Card className="overflow-visible" data-testid="panel-sites">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold">Sites de Leilões</CardTitle>
              <p className="text-sm text-muted-foreground">{total} sites cadastrados</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Power className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">{ligados}</span>
            </div>
            <div className="flex items-center gap-2">
              <PowerOff className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium">{desligados}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Chart */}
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={70}
                paddingAngle={4}
                dataKey="value"
              >
                {chartData.map((_, index) => (
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
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Sites List */}
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {sites.slice(0, 10).map((site) => (
            <div
              key={site.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50 hover-elevate"
              data-testid={`site-item-${site.id}`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`h-2 w-2 rounded-full ${site.liga_desliga === "ligado" ? "bg-emerald-500" : "bg-gray-400"}`} />
                <span className="text-sm font-medium truncate">{site.nome_site || "Sem nome"}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={site.liga_desliga || "desligado"} />
                {site.url_site && (
                  <a
                    href={site.url_site}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    data-testid={`site-link-${site.id}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          ))}
          {sites.length > 10 && (
            <p className="text-sm text-muted-foreground text-center pt-2">
              +{sites.length - 10} sites
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
