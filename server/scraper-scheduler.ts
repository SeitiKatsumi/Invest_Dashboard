import cron from 'node-cron';
import {
  getSitesWithConfig,
  startInternalOnboarding,
  startInternalScraping,
} from './scraping.js';
import { getOpenAIApiKey, isOpenAIKeyConfigured } from './openai-usage.js';
import { scoreConfig } from './internal-scraper/config-scorer.js';
import { db } from './db.js';
import { schedulerConfigTable } from '@shared/schema';
import { desc } from 'drizzle-orm';

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
let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;
let lastRun: string | null = null;
let lastRunResult: RunResult | null = null;
let currentRunAbort: AbortController | null = null;
let cachedGroups: ScheduleGroup[] = [];

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
  const parts = config.cronExpression.split(' ');
  const hour = parseInt(parts[1]) || 3;
  const minute = parseInt(parts[0]) || 0;

  for (let i = 0; i < 8; i++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + i);
    candidate.setHours(hour, minute, 0, 0);

    if (candidate <= now) continue;

    const dayOfWeek = candidate.getDay();
    if (config.activeDays.includes(dayOfWeek)) {
      return candidate.toISOString();
    }
  }

  return null;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processGroup(group: ScheduleGroup): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const details: RunResult['details'] = [];
  let onboarded = 0;
  let scraped = 0;
  let errors = 0;
  let totalUrlsFound = 0;

  console.log(`[Scheduler] Iniciando processamento do grupo ${group.dayName} (${group.sites.length} sites)`);

  const sitesNeedOnboarding = config.includeOnboarding
    ? group.sites.filter(s => !s.hasConfig)
    : [];
  const sitesWithConfig = group.sites.filter(s => s.hasConfig);

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
      try {
        const result = await startInternalOnboarding(
          site.url,
          getOpenAIApiKey(),
          site.id,
        );

        if (result.config) {
          onboarded++;
          site.hasConfig = true;
          sitesWithConfig.push(site);
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'onboarding', success: true, urlsFound: 0 });
          console.log(`[Scheduler] Onboarding OK: ${site.nome_site}`);
        } else {
          errors++;
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'onboarding', success: false, urlsFound: 0, error: result.error });
          console.log(`[Scheduler] Onboarding falhou: ${site.nome_site} - ${result.error}`);
        }
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'onboarding', success: false, urlsFound: 0, error: msg });
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
      try {
        const fullSite = allSites.find((s: any) => s.id === site.id);
        const siteConfig = fullSite?.scraping_config;
        if (!siteConfig) {
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'scraping', success: false, urlsFound: 0, error: 'Config não encontrada' });
          errors++;
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
          console.log(`[Scheduler] Scraping OK: ${site.nome_site} - ${urls} URLs`);
        } else {
          errors++;
          details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'scraping', success: false, urlsFound: 0, error: jobStatus?.error || 'Timeout' });
          console.log(`[Scheduler] Scraping falhou: ${site.nome_site} - ${jobStatus?.error || 'Timeout'}`);
        }
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        details.push({ siteId: site.id, siteName: site.nome_site || '', action: 'scraping', success: false, urlsFound: 0, error: msg });
      } finally {
        semaphore.count--;
      }
    };

    const scrapePromises = sitesWithConfig.map(site => scrapeBatch(site));
    await Promise.allSettled(scrapePromises);
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    dayIndex: group.dayIndex,
    dayName: group.dayName,
    totalSites: group.sites.length,
    onboarded,
    scraped,
    errors,
    totalUrlsFound,
    details,
  };
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

    lastRunResult = await processGroup(todayGroup);
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
    timezone: 'America/Sao_Paulo',
  });

  console.log(`[Scheduler] Cron ativo: ${config.cronExpression} (timezone: America/Sao_Paulo)`);
  refreshGroups().catch(() => {});
}

function stopCron() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
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
  saveConfigToDb().catch(() => {});
  return { ...config };
}

async function saveConfigToDb() {
  try {
    const rows = await db.select().from(schedulerConfigTable).limit(1);
    if (rows.length > 0) {
      await db.update(schedulerConfigTable).set({
        config_json: JSON.stringify(config),
        updated_at: new Date(),
      });
    } else {
      await db.insert(schedulerConfigTable).values({
        config_json: JSON.stringify(config),
      });
    }
  } catch (err) {
    console.error('[Scheduler] Erro ao salvar config no banco:', err);
  }
}

async function loadConfigFromDb() {
  try {
    const rows = await db.select().from(schedulerConfigTable).orderBy(desc(schedulerConfigTable.updated_at)).limit(1);
    if (rows.length > 0) {
      const saved = JSON.parse(rows[0].config_json);
      config = { ...DEFAULT_CONFIG, ...saved };
      console.log(`[Scheduler] Config carregada do banco (enabled: ${config.enabled}, cron: ${config.cronExpression})`);
    }
  } catch (err) {
    console.error('[Scheduler] Erro ao carregar config do banco:', err);
  }
}

export async function getScheduleStatus(): Promise<ScheduleStatus> {
  if (cachedGroups.length === 0) {
    await refreshGroups();
  }

  return {
    config: { ...config },
    isRunning,
    lastRun,
    lastRunResult,
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
      lastRunResult = await processGroup(group);
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
  await loadConfigFromDb();
  if (config.enabled) {
    startCron();
  }
  refreshGroups().catch(() => {});
}
