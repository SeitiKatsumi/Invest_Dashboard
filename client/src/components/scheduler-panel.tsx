import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Clock,
  Play,
  Square,
  Settings,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";

interface ScheduleConfig {
  enabled: boolean;
  cronExpression: string;
  daysPerWeek: number;
  activeDays: number[];
  maxConcurrentOnboarding: number;
  maxConcurrentScraping: number;
  includeOnboarding: boolean;
  runOnlyWithConfig: boolean;
}

interface ScheduleGroup {
  dayIndex: number;
  dayName: string;
  sites: { id: number; nome_site: string | null; url: string; hasConfig: boolean }[];
}

interface RunResult {
  startedAt: string;
  completedAt: string;
  dayIndex: number;
  dayName: string;
  totalSites: number;
  onboarded: number;
  scraped: number;
  errors: number;
  totalUrlsFound: number;
  details: { siteId: number; siteName: string; action: string; success: boolean; urlsFound: number; error?: string }[];
}

interface ScheduleStatus {
  config: ScheduleConfig;
  isRunning: boolean;
  lastRun: string | null;
  lastRunResult: RunResult | null;
  nextRun: string | null;
  groups: ScheduleGroup[];
  cronActive: boolean;
}

const DAY_NAMES_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAY_COLORS: Record<number, string> = {
  0: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
  1: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  2: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
  3: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
  4: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  5: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  6: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800',
};

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function cronToTime(expr: string): string {
  const parts = expr.split(' ');
  const h = (parts[1] || '3').padStart(2, '0');
  const m = (parts[0] || '0').padStart(2, '0');
  return `${h}:${m}`;
}

function timeToCron(time: string): string {
  const [h, m] = time.split(':');
  return `${parseInt(m)} ${parseInt(h)} * * *`;
}

export default function SchedulerPanel() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [localConfig, setLocalConfig] = useState<ScheduleConfig | null>(null);

  const { data: status, isLoading, isError } = useQuery<ScheduleStatus>({
    queryKey: ["/api/scheduler/status"],
    refetchInterval: 10000,
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (config: Partial<ScheduleConfig>) => {
      const res = await apiRequest("PUT", "/api/scheduler/config", config);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/status"] });
      toast({ title: "Configuração atualizada" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    },
  });

  const triggerRunMutation = useMutation({
    mutationFn: async (dayIndex: number) => {
      const res = await apiRequest("POST", "/api/scheduler/run", { dayIndex });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/status"] });
      toast({ title: data.message });
    },
    onError: (err: any) => {
      toast({ title: err.message || "Erro ao iniciar", variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scheduler/cancel");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/status"] });
      toast({ title: "Cancelamento solicitado" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Agendamento Semanal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Carregando...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !status) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Agendamento Semanal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 flex items-center justify-center text-muted-foreground">
            <AlertTriangle className="h-5 w-5 mr-2 text-amber-500" />
            Erro ao carregar agendamento
            <Button variant="ghost" size="sm" className="ml-2" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/scheduler/status"] })}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { config: cfg, isRunning, groups, lastRunResult, nextRun, cronActive } = status;
  const todayIdx = new Date().getDay();
  const todayGroup = groups.find(g => g.dayIndex === todayIdx);
  const totalSitesScheduled = groups.reduce((s, g) => s + g.sites.length, 0);

  const handleToggle = (enabled: boolean) => {
    updateConfigMutation.mutate({ enabled });
  };

  const openConfigDialog = () => {
    setLocalConfig({ ...cfg });
    setShowConfig(true);
  };

  const saveConfig = () => {
    if (localConfig) {
      updateConfigMutation.mutate(localConfig);
      setShowConfig(false);
    }
  };

  const toggleDay = (day: number) => {
    if (!localConfig) return;
    const days = localConfig.activeDays.includes(day)
      ? localConfig.activeDays.filter(d => d !== day)
      : [...localConfig.activeDays, day].sort();
    setLocalConfig({ ...localConfig, activeDays: days, daysPerWeek: days.length });
  };

  return (
    <>
      <Card data-testid="scheduler-panel">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="h-5 w-5" />
              Agendamento Semanal
              {cronActive && cfg.enabled && (
                <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs">
                  Ativo
                </Badge>
              )}
              {isRunning && (
                <Badge variant="outline" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs animate-pulse">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Processando
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2" data-testid="scheduler-toggle">
                <Label htmlFor="scheduler-enabled" className="text-sm text-muted-foreground">
                  {cfg.enabled ? 'Ligado' : 'Desligado'}
                </Label>
                <Switch
                  id="scheduler-enabled"
                  checked={cfg.enabled}
                  onCheckedChange={handleToggle}
                />
              </div>
              <Button variant="outline" size="sm" onClick={openConfigDialog} data-testid="button-scheduler-config">
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                data-testid="button-scheduler-expand"
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold" data-testid="text-total-scheduled">{totalSitesScheduled}</div>
              <div className="text-xs text-muted-foreground">Sites agendados</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold" data-testid="text-groups-count">{groups.length}</div>
              <div className="text-xs text-muted-foreground">Grupos/dias</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold flex items-center justify-center gap-1" data-testid="text-schedule-time">
                <Clock className="h-4 w-4" />
                {cronToTime(cfg.cronExpression)}
              </div>
              <div className="text-xs text-muted-foreground">Horário</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-sm font-medium" data-testid="text-next-run">
                {nextRun ? formatDateTime(nextRun) : 'Desligado'}
              </div>
              <div className="text-xs text-muted-foreground">Próxima execução</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {groups.map(group => {
              const isToday = group.dayIndex === todayIdx;
              return (
                <div
                  key={group.dayIndex}
                  className={`flex-1 min-w-[100px] p-3 rounded-lg border text-center cursor-pointer transition-all hover:scale-105 ${
                    DAY_COLORS[group.dayIndex] || 'bg-muted'
                  } ${isToday ? 'ring-2 ring-primary ring-offset-2 dark:ring-offset-background' : ''}`}
                  onClick={() => setExpanded(true)}
                  data-testid={`day-group-${group.dayIndex}`}
                >
                  <div className="font-bold text-sm">{DAY_NAMES_SHORT[group.dayIndex]}</div>
                  <div className="text-2xl font-bold">{group.sites.length}</div>
                  <div className="text-[10px] opacity-75">sites</div>
                  {isToday && <div className="text-[10px] font-bold mt-1">HOJE</div>}
                </div>
              );
            })}
          </div>

          {isRunning && (
            <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Processamento em andamento...
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-run"
              >
                <Square className="h-3 w-3 mr-1" />
                Cancelar
              </Button>
            </div>
          )}

          {!isRunning && todayGroup && todayGroup.sites.length > 0 && (
            <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg border">
              <div>
                <div className="text-sm font-medium">
                  Grupo de hoje ({DAY_NAMES_SHORT[todayIdx]}): {todayGroup.sites.length} sites
                </div>
                <div className="text-xs text-muted-foreground">
                  {todayGroup.sites.filter(s => s.hasConfig).length} com config, {todayGroup.sites.filter(s => !s.hasConfig).length} pendentes
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => triggerRunMutation.mutate(todayIdx)}
                disabled={triggerRunMutation.isPending}
                data-testid="button-run-today"
              >
                <Play className="h-3 w-3 mr-1" />
                Executar Agora
              </Button>
            </div>
          )}

          {lastRunResult && (
            <div
              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors"
              onClick={() => setShowResult(true)}
              data-testid="last-run-summary"
            >
              <div className="flex items-center gap-3">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">
                    Última execução: {formatDateTime(lastRunResult.completedAt)}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      {lastRunResult.scraped} scrapes
                    </span>
                    {lastRunResult.onboarded > 0 && (
                      <span className="flex items-center gap-1">
                        <RotateCcw className="h-3 w-3 text-blue-500" />
                        {lastRunResult.onboarded} onboardings
                      </span>
                    )}
                    {lastRunResult.errors > 0 && (
                      <span className="flex items-center gap-1">
                        <XCircle className="h-3 w-3 text-red-500" />
                        {lastRunResult.errors} erros
                      </span>
                    )}
                    <span>{lastRunResult.totalUrlsFound} URLs</span>
                  </div>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          )}

          {expanded && (
            <div className="space-y-3 pt-2 border-t">
              <div className="text-sm font-medium text-muted-foreground">Distribuição por dia</div>
              {groups.map(group => (
                <div key={group.dayIndex} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`${DAY_COLORS[group.dayIndex]} text-xs`}
                      >
                        {DAY_NAMES_SHORT[group.dayIndex]}
                      </Badge>
                      <span className="text-sm font-medium">{group.sites.length} sites</span>
                      <span className="text-xs text-muted-foreground">
                        ({group.sites.filter(s => s.hasConfig).length} com config)
                      </span>
                    </div>
                    {!isRunning && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => triggerRunMutation.mutate(group.dayIndex)}
                        disabled={triggerRunMutation.isPending}
                        data-testid={`button-run-day-${group.dayIndex}`}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Executar
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 pl-4">
                    {group.sites.slice(0, 15).map(site => (
                      <Badge
                        key={site.id}
                        variant="outline"
                        className={`text-[10px] ${site.hasConfig ? '' : 'opacity-50 border-dashed'}`}
                      >
                        {site.nome_site || `#${site.id}`}
                      </Badge>
                    ))}
                    {group.sites.length > 15 && (
                      <Badge variant="outline" className="text-[10px] bg-muted">
                        +{group.sites.length - 15} mais
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configuração do Agendamento</DialogTitle>
            <DialogDescription>
              Defina horário, dias ativos e parâmetros de execução
            </DialogDescription>
          </DialogHeader>

          {localConfig && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Horário de Execução</Label>
                <Input
                  type="time"
                  value={cronToTime(localConfig.cronExpression)}
                  onChange={e => setLocalConfig({ ...localConfig, cronExpression: timeToCron(e.target.value) })}
                  data-testid="input-schedule-time"
                />
                <p className="text-xs text-muted-foreground">Horário de Brasília (America/Sao_Paulo)</p>
              </div>

              <div className="space-y-2">
                <Label>Dias Ativos</Label>
                <div className="flex gap-1 flex-wrap">
                  {DAY_NAMES_SHORT.map((name, idx) => (
                    <Button
                      key={idx}
                      variant={localConfig.activeDays.includes(idx) ? "default" : "outline"}
                      size="sm"
                      className="h-8 w-10 p-0 text-xs"
                      onClick={() => toggleDay(idx)}
                      data-testid={`button-toggle-day-${idx}`}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Onboarding simultâneos</Label>
                  <Select
                    value={String(localConfig.maxConcurrentOnboarding)}
                    onValueChange={v => setLocalConfig({ ...localConfig, maxConcurrentOnboarding: parseInt(v) })}
                  >
                    <SelectTrigger data-testid="select-max-onboarding">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map(n => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Scraping simultâneos</Label>
                  <Select
                    value={String(localConfig.maxConcurrentScraping)}
                    onValueChange={v => setLocalConfig({ ...localConfig, maxConcurrentScraping: parseInt(v) })}
                  >
                    <SelectTrigger data-testid="select-max-scraping">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map(n => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Incluir onboarding</Label>
                    <p className="text-xs text-muted-foreground">
                      Sites sem config recebem onboarding automático
                    </p>
                  </div>
                  <Switch
                    checked={localConfig.includeOnboarding}
                    onCheckedChange={v => setLocalConfig({ ...localConfig, includeOnboarding: v })}
                    data-testid="switch-include-onboarding"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Apenas sites com config</Label>
                    <p className="text-xs text-muted-foreground">
                      Pular sites que ainda não têm configuração
                    </p>
                  </div>
                  <Switch
                    checked={localConfig.runOnlyWithConfig}
                    onCheckedChange={v => setLocalConfig({ ...localConfig, runOnlyWithConfig: v })}
                    data-testid="switch-only-config"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfig(false)} data-testid="button-cancel-config">
              Cancelar
            </Button>
            <Button onClick={saveConfig} disabled={updateConfigMutation.isPending} data-testid="button-save-config">
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResult} onOpenChange={setShowResult}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resultado da Última Execução</DialogTitle>
            {lastRunResult && (
              <DialogDescription>
                {lastRunResult.dayName} — {formatDateTime(lastRunResult.startedAt)} até {formatDateTime(lastRunResult.completedAt)}
              </DialogDescription>
            )}
          </DialogHeader>

          {lastRunResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">{lastRunResult.totalSites}</div>
                  <div className="text-xs text-muted-foreground">Total sites</div>
                </div>
                <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{lastRunResult.scraped}</div>
                  <div className="text-xs text-muted-foreground">Scrapes OK</div>
                </div>
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{lastRunResult.onboarded}</div>
                  <div className="text-xs text-muted-foreground">Onboardings</div>
                </div>
                <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{lastRunResult.errors}</div>
                  <div className="text-xs text-muted-foreground">Erros</div>
                </div>
              </div>

              <div className="p-3 bg-primary/5 rounded-lg text-center">
                <div className="text-3xl font-bold">{lastRunResult.totalUrlsFound}</div>
                <div className="text-sm text-muted-foreground">URLs encontradas</div>
              </div>

              {lastRunResult.details.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  <div className="text-sm font-medium mb-2">Detalhes ({lastRunResult.details.length} operações)</div>
                  {lastRunResult.details.map((d, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between text-xs p-2 rounded ${
                        d.success ? 'bg-green-50 dark:bg-green-900/10' : 'bg-red-50 dark:bg-red-900/10'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {d.success ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                        )}
                        <span className="truncate">{d.siteName || `Site #${d.siteId}`}</span>
                        <Badge variant="outline" className="text-[10px]">{d.action}</Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {d.urlsFound > 0 && (
                          <span className="text-green-600 font-medium">{d.urlsFound} URLs</span>
                        )}
                        {d.error && (
                          <span className="text-red-500 truncate max-w-[150px]" title={d.error}>
                            {d.error.slice(0, 40)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
