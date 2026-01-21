import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface UrlConsultaPanelProps {
  total: number;
  processadas: number;
  naoProcessadas: number;
  comErro: number;
}

const COLORS = ["#10b981", "#6b7280", "#ef4444"];

export function UrlConsultaPanel({ total, processadas, naoProcessadas, comErro }: UrlConsultaPanelProps) {
  const chartData = [
    { name: "Processadas", value: processadas },
    { name: "Pendentes", value: naoProcessadas },
    { name: "Com Erro", value: comErro },
  ].filter((d) => d.value > 0);

  const percentage = total > 0 ? Math.round((processadas / total) * 100) : 0;

  return (
    <Card className="overflow-visible" data-testid="panel-url-consulta">
      <CardHeader className="pb-4">
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
      <CardContent className="space-y-4">
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

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-emerald-500/10">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <span className="text-lg font-bold">{processadas.toLocaleString("pt-BR")}</span>
            <span className="text-xs text-muted-foreground">Processadas</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-gray-500/10">
            <Clock className="h-5 w-5 text-gray-500" />
            <span className="text-lg font-bold">{naoProcessadas.toLocaleString("pt-BR")}</span>
            <span className="text-xs text-muted-foreground">Pendentes</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-red-500/10">
            <XCircle className="h-5 w-5 text-red-500" />
            <span className="text-lg font-bold">{comErro.toLocaleString("pt-BR")}</span>
            <span className="text-xs text-muted-foreground">Com Erro</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
