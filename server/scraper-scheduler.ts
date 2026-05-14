import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import {
  getSitesWithConfig,
  saveSiteScrapingConfig,
  startInternalOnboarding,
  startInternalScraping,
  updateSiteEngine,
  clearSiteScrapingError,
} from './scraping.js';
import { getOpenAIApiKey, isOpenAIKeyConfigured } from './openai-usage.js';
import { scoreConfig } from './internal-scraper/config-scorer.js';
import {
  createSchedulerRun,
  createSchedulerRunItem,
  ensureSchedulerPersistenceSchema,
  getLatestSchedulerRun,
  getSchedulerRuns,
  updateSchedulerRun,
  updateSchedulerRunItem,
  type SchedulerRunRecord,
  type SchedulerRunTrigger,
} from './scheduler-persistence.js';
const DIRECTUS_URL = process.env.DIRECTUS_URL || '';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || '';

const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
const DAY_NAMES_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

export interface ScheduleConfig {
  enabled: boolean;
  cronExpression: string;
  daysPerWeek: number;
  activeDays: number[];
  maxConcurrentOnboarding: number;
  maxConcurrentScraping: number;
  includeOnboarding: boolean;
  runOnlyWithConfig: boolean;
}

export interface ScheduleGroup {
  dayIndex: number;
  dayName: string;
  sites: { id: number; nome_site: string | null; url: string; hasConfig: boolean }[];
}

export interface ScheduleStatus {
  config: ScheduleConfig;
  isRunning: boolean;
  lastRun: string | null;
  lastRunResult: RunResult | null;
  latestPersistedRun: SchedulerRunRecord | null;
  recentRuns: SchedulerRunRecord[];
  missedRunWarning: boolean;
  nextRun: string | null;
  groups: ScheduleGroup[];
  cronActive: boolean;
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

const DEFAULT_CONFIG: ScheduleConfig = {
  enabled: false,
  cronExpression: '0 3 * * *',
  daysPerWeek: 7,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  maxConcurrentOnboarding: 3,
  maxConcurrentScraping: 3,
  includeOnboarding: true,
  runOnlyWithConfig: false,
};

let config: ScheduleConfig = { ...DEFAULT_CONFIG };
let cronTask: ScheduledTask | null = null;
let isRunning = false;
let lastRun: string | null = null;
let lastRunResult: RunResult | null = null;
let currentRunAbort: AbortController | null = null;
let cachedGroups: ScheduleGroup[] = [];
let watchdogInterval: NodeJS.Timeout | null = null;
let lastCatchUpAttemptKey: string | null = null;

const SCHEDULER_TIMEZONE = 'America/Sao_Paulo';
const WATCHDOG_INTERVAL_MS = 15 * 60 * 1000;

function assignSitesToGroups(sites: any[], daysPerWeek: number, activeDays: number[]): ScheduleGroup[] {
  const groups: ScheduleGroup[] = activeDays.map(dayIdx => ({
    dayIndex: dayIdx,
    dayName: DAY_NAMES[dayIdx],
    sites: [],
  }));

  const activeSites = sites
    .filter((s: any) => s.liga_desliga === 'ligado')
    .sort((a: any, b: any) => (a.nome_site || '').localeCompare(b.nome_site || '', 'pt-BR', { sensitivity: 'base' }));

  const perGroup = Math.ceil(activeSites.length / groups.length);
  for (let i = 0; i < activeSites.length; i++) {
    const groupIdx = Math.min(Math.floor(i / perGroup), groups.length - 1);
    const site = activeSites[i];
    groups[groupIdx].sites.push({
      id: site.id,
      nome_site: site.nome_site,
      url: site.url_listagem || site.url_site || '',
      hasConfig: !!site.scraping_config,
    });
  }

  return groups;
}

function getNextRunDate(): string | null {
  if (!config.enabled || !cronTask) return null;

  const now = new Date();
  const saoPauloNow = getSaoPauloParts(now);
  const parts = config.cronExpression.split(' ');
  const hour = parseInt(parts[1]) || 3;
  const minute = parseInt(parts[0]) || 0;

  for (let i = 0; i < 8; i++) {
    const candidate = saoPauloWallTimeToDate(saoPauloNow.dateKey, hour, minute, i);
    if (!candidate || candidate <= now) continue;

    const dayOfWeek = getSaoPauloParts(candidate).dayIndex;
    if (config.activeDays.includes(dayOfWeek)) {
      return candidate.toISOString();
    }
  }

  return null;
}

function saoPauloWallTimeToDate(dateKey: string, hour: number, minute: number, addDays: number): Date | null {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return null;

  const utc = new Date(Date.UTC(year, month - 1, day + addDays, hour + 3, minute, 0, 0));
  return Number.isNaN(utc.getTime()) ? null : utc;
}

function getSaoPauloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    dayIndex: weekdayMap[get('weekday')] ?? date.getDay(),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function getConfiguredScheduleTime() {
  const parts = config.cronExpression.split(' ');
  return {
    minute: Number.parseInt(parts[0] || '0', 10) || 0,
    hour: Number.parseInt(parts[1] || '3', 10) || 3,
  };
}

function isAfterTodaySchedule() {
  const now = getSaoPauloParts();
  const scheduled = getConfiguredScheduleTime();
  return now.hour > scheduled.hour || (now.hour === scheduled.hour && now.minute >= scheduled.minute);
}

function didRunToday(run: SchedulerRunRecord | null, todayKey: string, todayIndex: number) {
  if (!run?.started_at) return false;
  const runParts = getSaoPauloParts(new Date(run.started_at));
  if (runParts.dateKey !== todayKey || Number(run.day_index) !== todayIndex) return false;

  const ageMs = Date.now() - new Date(run.started_at).getTime();
  const staleRunningRun = run.status === 'running' && ageMs > 30 * 60 * 1000;
  if (staleRunningRun) return false;
  return run.status === 'completed' || run.status === 'running';
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isStaleSchedulerRun(run: SchedulerRunRecord | null): boolean {
  if (!run?.started_at) return true;
  if (run.status === 'cancelled' || run.status === 'failed') return true;
  return Date.now() - new Date(run.started_at).getTime() > 36 * 60 * 60 * 1000;
}

async function runDueIfMissed(reason: 'startup' | 'watchdog') {
  if (!config.enabled || isRunning) return;

  const now = getSaoPauloParts();
  if (!config.activeDays.includes(now.dayIndex)) return;
  if (!isAfterTodaySchedule()) return;
  if (lastCatchUpAttemptKey === now.dateKey) return;

  const latestRun = await getLatestSchedulerRun();
  if (didRunToday(latestRun, now.dateKey, now.dayIndex)) return;

  lastCatchUpAttemptKey = now.dateKey;
  console.warn(`[Scheduler] Watchdog detectou execucao perdida (${reason}) para ${DAY_NAMES[now.dayIndex]}; iniciando catch-up.`);

  try {
    await executeCronJob();
  } catch (error) {
    console.error('[Scheduler] Erro no catch-up do watchdog:', error);
  }
}

function startWatchdog() {
  if (watchdogInterval) return;
  watchdogInterval = setInterval(() => {
    runDueIfMissed('watchdog').catch(error => {
      console.error('[Scheduler] Erro no watchdog:', error);
    });
  }, WATCHDOG_INTERVAL_MS);
  watchdogInterval.unref?.();
}

function stopWatchdog() {
  if (!watchdogInterval) return;
  clearInterval(watchdogInterval);
  watchdogInterval = null;
}

async function processGroup(group: ScheduleGroup, trigger: SchedulerRunTrigger): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const details: RunResult['details'] = [];
  let onboarded = 0;
  let scraped = 0;
  let errors = 0;
  let totalUrlsFound = 0;
  const runRecord = await createSchedulerRun({
    status: 'running',
    trigger,
    started_at: startedAt,
    completed_at: null,
    day_index: group.dayIndex,
    day_name: group.dayName,
    total_sites: group.sites.length,
    onboarded: 0,
    scraped: 0,
    errors: 0,
    total_urls_found: 0,
    config_snapshot: { ...config },
    error_message: null,
  });

  console.log(`[Scheduler] Iniciando processamento do grupo ${group.dayName} (${group.sites.length} sites)`);

  const sitesNeedOnboarding = config.includeOnboarding && trigger === 'manual'
    ? group.sites.filter(s => !s.hasConfig)
    : [];
  const sitesWithConfig = group.sites.filter(s => s.hasConfig);

  if (config.includeOnboarding && trigger === 'cron') {
    const skippedOnboarding = group.sites.filter(s => !s.hasConfig).length;
    if (skippedOnboarding > 0) {
      console.log(`[Scheduler] Cron pulou onboarding de ${skippedOnboarding} sites sem config; scraping dos sites configurados continua.`);
    }
  }

  if (config.runOnlyWithConfig) {
    sitesNeedOnboarding.length = 0;
  }

  if (sitesNeedOnboarding.length > 0 && isOpenAIKeyConfigured()) {
    console.log(`[Scheduler] Onboarding de ${sitesNeedOnboarding.length} sites...`);
    const semaphore = { count: 0 };

    const onboardBatch = async (site: typeof sitesNeedOnboarding[0]) => {
      while (semaphore.count >= config.maxConcurrentOnboarding) {
        await sleep(500);
      }
      if (currentRunAbort?.signal.aborted) return;

      semaphore.count++;
      const item = await createSchedulerRunItem({
        run: runRecord?.id || null,
        site_id: site.id,
        site_name: site.nome_site || null,
        site_url: site.url || null,
        action: 'onboarding',
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        urls_found: 0,
        job_id: null,
        result_classification: null,
        confidence_score: null,
        error_message: null,
      });
      try {
        const result = await startInternalOnboarding(
          site.url,
          getOpenAIApiKey(),
          site.id,
        );

        if (result.config) {
          const configObj = result.config as unknown as Record<string, unknown>;
          const confidence = scoreConfig(configObj);
          await saveSiteScrapingConfig(site.id, configObj);
          await updateSiteEngine(site.id, 'internal');
          await clearSiteScrapingError(site.id);
          onboarded++;
          site.hasConfig = true;
          sitesWithConfig.push(site);
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'onboarding', success: true, urlsFound: 0 });
          await updateSchedulerRunItem(item?.id || null, {
            status: 'success',
            completed_at: new Date().toISOString(),
            confidence_score: confidence.confidence,
          });
          console.log(`[Scheduler] Onboarding OK: ${site.nome_site}`);
        } else {
          errors++;
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'onboarding', success: false, urlsFound: 0, error: result.error });
          await updateSchedulerRunItem(item?.id || null, {
            status: 'error',
            completed_at: new Date().toISOString(),
            error_message: result.error || 'Onboarding nao retornou config',
          });
          console.log(`[Scheduler] Onboarding falhou: ${site.nome_site} - ${result.error}`);
        }
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'onboarding', success: false, urlsFound: 0, error: msg });
        await updateSchedulerRunItem(item?.id || null, {
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: msg,
        });
      } finally {
        semaphore.count--;
      }
    };

    const onboardPromises = sitesNeedOnboarding.map(site => onboardBatch(site));
    await Promise.allSettled(onboardPromises);
  }

  if (sitesWithConfig.length > 0) {
    console.log(`[Scheduler] Scraping de ${sitesWithConfig.length} sites...`);

    let allSites: any[] = [];
    try {
      allSites = await getSitesWithConfig();
    } catch {}

    const semaphore = { count: 0 };

    const scrapeBatch = async (site: typeof sitesWithConfig[0]) => {
      while (semaphore.count >= config.maxConcurrentScraping) {
        await sleep(500);
      }
      if (currentRunAbort?.signal.aborted) return;

      semaphore.count++;
      const item = await createSchedulerRunItem({
        run: runRecord?.id || null,
        site_id: site.id,
        site_name: site.nome_site || null,
        site_url: site.url || null,
        action: 'scraping',
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        urls_found: 0,
        job_id: null,
        result_classification: null,
        confidence_score: null,
        error_message: null,
      });
      try {
        const fullSite = allSites.find((s: any) => s.id === site.id);
        const siteConfig = fullSite?.scraping_config;
        if (!siteConfig) {
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'scraping', success: false, urlsFound: 0, error: 'Config não encontrada' });
          errors++;
          await updateSchedulerRunItem(item?.id || null, {
            status: 'error',
            completed_at: new Date().toISOString(),
            error_message: 'Config nao encontrada',
          });
          return;
        }

        const parsedConfig = typeof siteConfig === 'string' ? JSON.parse(siteConfig) : siteConfig;
        const jobResult = await startInternalScraping(site.url, parsedConfig, site.id);

        await sleep(2000);

        let attempts = 0;
        const maxAttempts = 120;
        let jobStatus: any = null;

        const { jobManager } = await import('./internal-scraper/index.js');
        while (attempts < maxAttempts) {
          if (currentRunAbort?.signal.aborted) break;
          jobStatus = jobManager.getJob(jobResult.job_id);
          if (jobStatus && (jobStatus.status === 'completed' || jobStatus.status === 'failed')) break;
          await sleep(5000);
          attempts++;
        }

        if (jobStatus?.status === 'completed') {
          scraped++;
          const urls = jobStatus.totalUrls || 0;
          totalUrlsFound += urls;
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'scraping', success: true, urlsFound: urls });
          await updateSchedulerRunItem(item?.id || null, {
            status: 'success',
            completed_at: new Date().toISOString(),
            urls_found: urls,
            job_id: jobResult.job_id,
            result_classification: jobStatus.resultClassification || null,
            confidence_score: jobStatus.confidenceScore || null,
          });
          console.log(`[Scheduler] Scraping OK: ${site.nome_site} - ${urls} URLs`);
        } else {
          errors++;
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'scraping', success: false, urlsFound: 0, error: jobStatus?.error || 'Timeout' });
          await updateSchedulerRunItem(item?.id || null, {
            status: 'error',
            completed_at: new Date().toISOString(),
            job_id: jobResult.job_id,
            error_message: jobStatus?.error || 'Timeout',
          });
          console.log(`[Scheduler] Scraping falhou: ${site.nome_site} - ${jobStatus?.error || 'Timeout'}`);
        }
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'scraping', success: false, urlsFound: 0, error: msg });
        await updateSchedulerRunItem(item?.id || null, {
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: msg,
        });
      } finally {
        semaphore.count--;
      }
    };

    const scrapePromises = sitesWithConfig.map(site => scrapeBatch(site));
    await Promise.allSettled(scrapePromises);
  }

  const completedAt = new Date().toISOString();
  const result = {
    startedAt,
    completedAt,
    dayIndex: group.dayIndex,
    dayName: group.dayName,
    totalSites: group.sites.length,
    onboarded,
    scraped,
    errors,
    totalUrlsFound,
    details,
  };

  await updateSchedulerRun(runRecord?.id || null, {
    status: currentRunAbort?.signal.aborted ? 'cancelled' : scraped === 0 && errors > 0 ? 'failed' : 'completed',
    completed_at: completedAt,
    total_sites: result.totalSites,
    onboarded,
    scraped,
    errors,
    total_urls_found: totalUrlsFound,
    error_message: currentRunAbort?.signal.aborted ? 'Execucao cancelada pelo usuario' : null,
  });

  return result;
}

async function executeCronJob() {
  if (isRunning) {
    console.log('[Scheduler] Job já em execução, pulando...');
    return;
  }

  const today = new Date().getDay();
  if (!config.activeDays.includes(today)) {
    console.log(`[Scheduler] Hoje (${DAY_NAMES[today]}) não é dia ativo, pulando...`);
    return;
  }

  isRunning = true;
  currentRunAbort = new AbortController();
  lastRun = new Date().toISOString();

  try {
    await refreshGroups();
    const todayGroup = cachedGroups.find(g => g.dayIndex === today);

    if (!todayGroup || todayGroup.sites.length === 0) {
      console.log(`[Scheduler] Nenhum site para processar hoje (${DAY_NAMES[today]})`);
      await createSchedulerRun({
        status: 'skipped',
        trigger: 'cron',
        started_at: lastRun,
        completed_at: new Date().toISOString(),
        day_index: today,
        day_name: DAY_NAMES[today],
        total_sites: 0,
        onboarded: 0,
        scraped: 0,
        errors: 0,
        total_urls_found: 0,
        config_snapshot: { ...config },
        error_message: 'Nenhum site no grupo do dia',
      });
      lastRunResult = {
        startedAt: lastRun,
        completedAt: new Date().toISOString(),
        dayIndex: today,
        dayName: DAY_NAMES[today],
        totalSites: 0,
        onboarded: 0,
        scraped: 0,
        errors: 0,
        totalUrlsFound: 0,
        details: [],
      };
      return;
    }

    lastRunResult = await processGroup(todayGroup, 'cron');
    console.log(`[Scheduler] Concluído: ${lastRunResult.scraped} scrapes, ${lastRunResult.onboarded} onboardings, ${lastRunResult.errors} erros, ${lastRunResult.totalUrlsFound} URLs`);
  } catch (e) {
    console.error('[Scheduler] Erro no cron job:', e);
  } finally {
    isRunning = false;
    currentRunAbort = null;
  }
}

async function refreshGroups() {
  try {
    const sites = await getSitesWithConfig();
    cachedGroups = assignSitesToGroups(sites, config.daysPerWeek, config.activeDays);
  } catch (e) {
    console.error('[Scheduler] Erro ao atualizar grupos:', e);
  }
}

function startCron() {
  stopCron();
  if (!config.enabled) return;

  if (!cron.validate(config.cronExpression)) {
    console.error(`[Scheduler] Expressão cron inválida: ${config.cronExpression}`);
    return;
  }

  cronTask = cron.schedule(config.cronExpression, () => {
    executeCronJob().catch(e => console.error('[Scheduler] Erro:', e));
  }, {
    timezone: SCHEDULER_TIMEZONE,
  });

  console.log(`[Scheduler] Cron ativo: ${config.cronExpression} (timezone: ${SCHEDULER_TIMEZONE})`);
  startWatchdog();
  refreshGroups().catch(() => {});
  setTimeout(() => {
    runDueIfMissed('startup').catch(error => {
      console.error('[Scheduler] Erro no watchdog de inicializacao:', error);
    });
  }, 30_000).unref?.();
}

function stopCron() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  stopWatchdog();
}

export function getScheduleConfig(): ScheduleConfig {
  return { ...config };
}

export function updateScheduleConfig(updates: Partial<ScheduleConfig>): ScheduleConfig {
  if (updates.cronExpression !== undefined) {
    if (typeof updates.cronExpression !== 'string' || !cron.validate(updates.cronExpression)) {
      throw new Error('Expressão cron inválida');
    }
  }

  if (updates.activeDays !== undefined) {
    if (!Array.isArray(updates.activeDays) || updates.activeDays.some(d => typeof d !== 'number' || d < 0 || d > 6)) {
      throw new Error('Dias ativos inválidos (array de 0-6)');
    }
  }

  if (updates.maxConcurrentOnboarding !== undefined) {
    const v = Number(updates.maxConcurrentOnboarding);
    if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error('Concorrência de onboarding deve ser 1-10');
    updates.maxConcurrentOnboarding = v;
  }

  if (updates.maxConcurrentScraping !== undefined) {
    const v = Number(updates.maxConcurrentScraping);
    if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error('Concorrência de scraping deve ser 1-10');
    updates.maxConcurrentScraping = v;
  }

  config = { ...config, ...updates };

  if (config.activeDays.length === 0) {
    config.activeDays = [0, 1, 2, 3, 4, 5, 6];
  }
  config.daysPerWeek = config.activeDays.length;

  if (config.enabled) {
    startCron();
  } else {
    stopCron();
  }

  refreshGroups().catch(() => {});
  saveConfigToDirectus().catch(() => {});
  return { ...config };
}

async function saveConfigToDirectus() {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) return;

  try {
    const resp = await fetch(`${DIRECTUS_URL}/items/scheduler_config`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ config_json: config }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[Scheduler] Erro ao salvar config no Directus: ${resp.status} ${body}`);
    }
  } catch (err) {
    console.error('[Scheduler] Erro ao salvar config no Directus:', err);
  }
}

async function loadConfigFromDirectus() {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) return;

  try {
    const resp = await fetch(`${DIRECTUS_URL}/items/scheduler_config`, {
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
    });

    if (!resp.ok) return;

    const data = await resp.json();
    const row = data.data;
    if (row?.config_json) {
      const saved = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
      config = { ...DEFAULT_CONFIG, ...saved };
      console.log(`[Scheduler] Config carregada do Directus (enabled: ${config.enabled}, cron: ${config.cronExpression})`);
    }
  } catch (err) {
    console.error('[Scheduler] Erro ao carregar config do Directus:', err);
  }
}

export async function getScheduleStatus(): Promise<ScheduleStatus> {
  if (cachedGroups.length === 0) {
    await refreshGroups();
  }
  const [latestPersistedRun, recentRuns] = await Promise.all([
    getLatestSchedulerRun(),
    getSchedulerRuns(8),
  ]);

  return {
    config: { ...config },
    isRunning,
    lastRun,
    lastRunResult,
    latestPersistedRun,
    recentRuns,
    missedRunWarning: config.enabled && !isRunning && isStaleSchedulerRun(latestPersistedRun),
    nextRun: getNextRunDate(),
    groups: cachedGroups,
    cronActive: !!cronTask,
  };
}

export async function triggerManualRun(dayIndex?: number): Promise<{ message: string; dayIndex: number }> {
  if (isRunning) {
    throw new Error('Um processamento já está em execução');
  }

  const targetDay = dayIndex ?? new Date().getDay();
  if (typeof targetDay !== 'number' || targetDay < 0 || targetDay > 6) {
    throw new Error('Dia inválido (0-6)');
  }

  isRunning = true;
  currentRunAbort = new AbortController();
  lastRun = new Date().toISOString();

  let groupToProcess: ScheduleGroup | undefined;
  try {
    await refreshGroups();
    groupToProcess = cachedGroups.find(g => g.dayIndex === targetDay);

    if (!groupToProcess || groupToProcess.sites.length === 0) {
      isRunning = false;
      currentRunAbort = null;
      throw new Error(`Nenhum site no grupo de ${DAY_NAMES[targetDay]}`);
    }
  } catch (e) {
    isRunning = false;
    currentRunAbort = null;
    throw e;
  }

  const group = groupToProcess;
  (async () => {
    try {
      lastRunResult = await processGroup(group, 'manual');
      console.log(`[Scheduler] Manual run concluído: ${lastRunResult.scraped} scrapes, ${lastRunResult.totalUrlsFound} URLs`);
    } catch (e) {
      console.error('[Scheduler] Erro no manual run:', e);
    } finally {
      isRunning = false;
      currentRunAbort = null;
    }
  })();

  return { message: `Processamento iniciado para ${DAY_NAMES[targetDay]} (${group.sites.length} sites)`, dayIndex: targetDay };
}

export function cancelCurrentRun(): boolean {
  if (!isRunning || !currentRunAbort) return false;
  currentRunAbort.abort();
  console.log('[Scheduler] Cancelamento solicitado');
  return true;
}

export function getLastRunResult(): RunResult | null {
  return lastRunResult;
}

export function getDayNames() {
  return { full: [...DAY_NAMES], short: [...DAY_NAMES_SHORT] };
}

export async function initScheduler() {
  console.log('[Scheduler] Inicializando...');
  await ensureSchedulerPersistenceSchema();
  await loadConfigFromDirectus();
  if (config.enabled) {
    startCron();
  }
  refreshGroups().catch(() => {});
}
