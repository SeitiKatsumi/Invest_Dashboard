import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, Image, ImageOff, FileCheck, FileX, Expand } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

interface LeiloesPanelProps {
  total: number;
  comImagem: number;
  semImagem: number;
  porTipo: Record<string, number>;
  porUf: Record<string, number>;
  porSite: Record<string, number>;
  publicados: number;
  naoPublicados: number;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316"];

export function LeiloesPanel({
  total,
  comImagem,
  semImagem,
  porTipo,
  porUf,
  porSite,
  publicados,
  naoPublicados,
}: LeiloesPanelProps) {
  const tipoData = Object.entries(porTipo)
    .filter(([key]) => key && key !== "null")
    .map(([name, value]) => ({ name: name || "Outros", value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const ufData = Object.entries(porUf)
    .filter(([key]) => key && key !== "null")
    .map(([name, value]) => ({ name: name || "N/A", value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const siteDataFull = Object.entries(porSite)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const siteData = siteDataFull
    .slice(0, 8)
    .map(item => ({ 
      ...item, 
      name: item.name.length > 15 ? item.name.substring(0, 15) + "..." : item.name 
    }));

  const imagemData = [
    { name: "Com Imagem", value: comImagem },
    { name: "Sem Imagem", value: semImagem },
  ];

  const publicacaoData = [
    { name: "Publicados", value: publicados },
    { name: "Não Publicados", value: naoPublicados },
  ];

  return (
    <Card className="overflow-visible" data-testid="panel-leiloes">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-1/10">
              <Building2 className="h-5 w-5 text-chart-1" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold">Leilões Extraídos</CardTitle>
              <p className="text-sm text-muted-foreground">{total.toLocaleString("pt-BR")} leilões no total</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Image className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">{comImagem.toLocaleString("pt-BR")} com imagem</span>
            </div>
            <div className="flex items-center gap-2">
              <ImageOff className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium">{semImagem.toLocaleString("pt-BR")} sem imagem</span>
            </div>
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">{publicados.toLocaleString("pt-BR")} publicados</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Por Estado */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Por Estado (UF)</h4>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ufData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={35} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Por Tipo */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Por Tipo de Imóvel</h4>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={tipoData}
                    cx="50%"
                    cy="40%"
                    innerRadius={40}
                    outerRadius={60}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {tipoData.map((_, index) => (
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
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} iconSize={10} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Status Imagem */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Status de Imagens</h4>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={imagemData}
                    cx="50%"
                    cy="40%"
                    innerRadius={40}
                    outerRadius={60}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#6b7280" />
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} iconSize={10} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Por Site */}
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-muted-foreground">Por Site</h4>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" data-testid="button-expand-sites">
                    <Expand className="h-3.5 w-3.5" />
                    <span className="text-xs">Ver todos</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      Leilões por Site - Lista Completa
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 overflow-auto">
                    <div className="space-y-1">
                      {siteDataFull.map((site, index) => (
                        <div
                          key={site.name}
                          className="flex items-center justify-between py-2 px-3 rounded-lg hover-elevate"
                          data-testid={`row-site-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
                            <span className="text-sm font-medium">{site.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div 
                              className="h-2 rounded-full bg-chart-2" 
                              style={{ width: `${Math.max(4, (site.value / siteDataFull[0].value) * 100)}px` }}
                            />
                            <span className="text-sm font-semibold text-chart-2 min-w-[60px] text-right">
                              {site.value.toLocaleString("pt-BR")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="pt-4 border-t text-center text-sm text-muted-foreground">
                    Total: {siteDataFull.length} sites • {siteDataFull.reduce((acc, s) => acc + s.value, 0).toLocaleString("pt-BR")} leilões
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={siteData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
