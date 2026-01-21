import { useQuery } from "@tanstack/react-query";
import { DashboardStats } from "@shared/schema";
import { StatCard } from "@/components/dashboard/stat-card";
import { SitesPanel } from "@/components/dashboard/sites-panel";
import { LeiloesPanel } from "@/components/dashboard/leiloes-panel";
import { LogsPanel } from "@/components/dashboard/logs-panel";
import { UrlConsultaPanel } from "@/components/dashboard/url-consulta-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Globe, 
  Building2, 
  Activity, 
  Image, 
  RefreshCw, 
  AlertCircle,
  LayoutDashboard
} from "lucide-react";

function LoadingSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
      
      {/* Stats Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-3 flex-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-12 w-12 rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Panels Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-[180px] w-full rounded-lg" />
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-40" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-[200px] w-full rounded-lg" />
              <Skeleton className="h-[200px] w-full rounded-lg" />
            </div>
          </CardContent>
        </Card>
      </div>
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
          <h2 className="text-xl font-semibold">Erro ao carregar dados</h2>
          <p className="text-sm text-muted-foreground">
            Não foi possível conectar ao Directus. Verifique se as credenciais estão corretas e o servidor está acessível.
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

export default function Dashboard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard"],
    refetchInterval: 60000,
  });

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
          <div className="flex items-center gap-4">
            <img 
              src="/attached_assets/Icon_Invest_1769010072868.jpg" 
              alt="Invest Leilões" 
              className="h-12 w-12 rounded-xl object-contain"
            />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Painel de Monitoramento Invest Leilões</h1>
              <p className="text-sm text-muted-foreground">
                Acompanhe o processamento de leilões em tempo real
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total de Sites"
            value={data.sites.total}
            description={`${data.sites.ligados} ativos`}
            icon={Globe}
            variant="default"
          />
          <StatCard
            title="Leilões Extraídos"
            value={data.leiloes.total.toLocaleString("pt-BR")}
            description={`${data.leiloes.comImagem.toLocaleString("pt-BR")} com imagem`}
            icon={Building2}
            variant="success"
          />
          <StatCard
            title="Taxa de Sucesso"
            value={`${data.logs.total > 0 ? Math.round(((data.logs.sucesso + data.logs.sucessoParcial) / data.logs.total) * 100) : 0}%`}
            description={`${data.logs.sucesso + data.logs.sucessoParcial} de ${data.logs.total}`}
            icon={Activity}
            variant={data.logs.erro > 0 ? "warning" : "success"}
          />
          <StatCard
            title="Imagens Processadas"
            value={data.leiloes.comImagem.toLocaleString("pt-BR")}
            description={`${data.leiloes.total > 0 ? Math.round((data.leiloes.comImagem / data.leiloes.total) * 100) : 0}% do total`}
            icon={Image}
            variant="default"
          />
        </div>

        {/* Main Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sites Panel */}
          <SitesPanel
            total={data.sites.total}
            ligados={data.sites.ligados}
            desligados={data.sites.desligados}
            sites={data.sites.list}
          />
          
          {/* Leilões Panel */}
          <LeiloesPanel
            total={data.leiloes.total}
            comImagem={data.leiloes.comImagem}
            semImagem={data.leiloes.semImagem}
            porTipo={data.leiloes.porTipo}
            porUf={data.leiloes.porUf}
            porSite={data.leiloes.porSite}
            publicados={data.leiloes.publicados}
            naoPublicados={data.leiloes.naoPublicados}
          />
        </div>

        {/* URL Consulta + Logs */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <UrlConsultaPanel
            total={data.urlConsulta.total}
            processadas={data.urlConsulta.processadas}
            naoProcessadas={data.urlConsulta.naoProcessadas}
            comErro={data.urlConsulta.comErro}
          />
          <div className="lg:col-span-3">
            <LogsPanel
              total={data.logs.total}
              sucesso={data.logs.sucesso}
              sucessoParcial={data.logs.sucessoParcial}
              erro={data.logs.erro}
              urlInvalida={data.logs.urlInvalida}
              recentLogs={data.logs.recentLogs}
              errosPorSite={data.logs.errosPorSite}
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center py-4 text-sm text-muted-foreground border-t">
          <p>Dashboard de Monitoramento de Leilões • Dados atualizados a cada 60 segundos</p>
        </footer>
      </div>
    </div>
  );
}
