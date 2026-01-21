import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2, CheckCircle2, Clock, XCircle, Building2, List, FileText, HelpCircle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis } from "recharts";

interface UrlConsultaPanelProps {
  total: number;
  totalImoveisIndividuais: number;
  processadas: number;
  naoProcessadas: number;
  comErro: number;
  porCategoria: Record<string, number>;
}

const COLORS = ["#10b981", "#6b7280", "#ef4444"];
const CATEGORY_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#6b7280"];

const categoryLabels: Record<string, string> = {
  "imóvel individual": "Imóvel Individual",
  "paginação": "Paginação",
  "categoria": "Categoria",
  "outros": "Outros",
  "não classificado": "Não Classificado",
};

const getCategoryIcon = (cat: string) => {
  switch (cat.toLowerCase()) {
    case "imóvel individual":
      return <Building2 className="h-4 w-4" />;
    case "paginação":
      return <List className="h-4 w-4" />;
    case "categoria":
      return <FileText className="h-4 w-4" />;
    default:
      return <HelpCircle className="h-4 w-4" />;
  }
};

export function UrlConsultaPanel({ total, totalImoveisIndividuais, processadas, naoProcessadas, comErro, porCategoria }: UrlConsultaPanelProps) {
  const chartData = [
    { name: "Processadas", value: processadas },
    { name: "Pendentes", value: naoProcessadas },
    { name: "Com Erro", value: comErro },
  ].filter((d) => d.value > 0);

  const safeCategoria = porCategoria || {};
  const categoryData = Object.entries(safeCategoria)
    .map(([name, value]) => ({
      name: categoryLabels[name] || name,
      value,
      originalName: name,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const totalImoveis = totalImoveisIndividuais || 0;
  const percentage = totalImoveis > 0 ? Math.round((processadas / totalImoveis) * 100) : 0;

  return (
    <Card className="overflow-visible" data-testid="panel-url-consulta">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-5/10">
              <Link2 className="h-5 w-5 text-chart-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold">URLs de Consulta</CardTitle>
              <p className="text-sm text-muted-foreground">{total.toLocaleString("pt-BR")} URLs no total</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{percentage}%</p>
            <p className="text-xs text-muted-foreground">processadas</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Processing Status Chart */}
        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={35}
                outerRadius={55}
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
              <Legend wrapperStyle={{ fontSize: "11px" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Category Breakdown */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Por Categoria</h4>
          <div className="space-y-1.5">
            {categoryData.map((cat, idx) => (
              <div key={cat.name} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span style={{ color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}>
                    {getCategoryIcon(cat.originalName)}
                  </span>
                  <span className="truncate">{cat.name}</span>
                </div>
                <span className="font-medium tabular-nums">{cat.value.toLocaleString("pt-BR")}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats - Only for Imóvel Individual */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            <span>Status de Imóveis Individuais ({totalImoveis.toLocaleString("pt-BR")})</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-bold">{processadas.toLocaleString("pt-BR")}</span>
              <span className="text-[10px] text-muted-foreground">Processadas</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-gray-500/10">
              <Clock className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-bold">{naoProcessadas.toLocaleString("pt-BR")}</span>
              <span className="text-[10px] text-muted-foreground">Pendentes</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-red-500/10">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-bold">{comErro.toLocaleString("pt-BR")}</span>
              <span className="text-[10px] text-muted-foreground">Com Erro</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
