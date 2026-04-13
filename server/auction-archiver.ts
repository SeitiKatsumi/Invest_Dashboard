import cron from 'node-cron';

const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();

export interface ArchiverRunResult {
  executedAt: string;
  totalScanned: number;
  totalExpired: number;
  totalArchived: number;
  imagesDeleted: number;
  errors: number;
  errorDetails: string[];
}

export interface ArchiverStatus {
  lastRun: ArchiverRunResult | null;
  nextRun: string | null;
  cronActive: boolean;
  isRunning: boolean;
}

let cronTask: cron.ScheduledTask | null = null;
let lastRunResult: ArchiverRunResult | null = null;
let isRunning = false;

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr || dateStr.trim() === '') return null;
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

function getMostAdvancedPracaDate(leilao: { praca_1: string | null; praca_2: string | null; praca_3: string | null }): Date | null {
  const d3 = parseDate(leilao.praca_3);
  if (d3) return d3;
  const d2 = parseDate(leilao.praca_2);
  if (d2) return d2;
  const d1 = parseDate(leilao.praca_1);
  if (d1) return d1;
  return null;
}

async function fetchPublishedLeiloes(): Promise<any[]> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error('DIRECTUS_URL and DIRECTUS_TOKEN must be set');
  }

  const allItems: any[] = [];
  let page = 1;
  const pageSize = 500;

  while (true) {
    const url = new URL(`${DIRECTUS_URL}/items/leiloes_imovel`);
    url.searchParams.set('filter[status][_eq]', 'published');
    url.searchParams.set('fields', 'id,praca_1,praca_2,praca_3,arquivo_imagem');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Directus API error fetching leilões: ${response.status}`);
    }

    const result = await response.json();
    const items = result.data || [];
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < pageSize) break;
    page++;
  }

  return allItems;
}

async function archiveLeilao(id: number): Promise<void> {
  const url = `${DIRECTUS_URL}/items/leiloes_imovel/${id}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'archived' }),
  });

  if (!response.ok) {
    throw new Error(`Failed to archive leilão ${id}: ${response.status}`);
  }
}

async function deleteImage(fileId: string): Promise<void> {
  const url = `${DIRECTUS_URL}/files/${fileId}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete image ${fileId}: ${response.status}`);
  }
}

async function clearImageField(leilaoId: number): Promise<void> {
  const url = `${DIRECTUS_URL}/items/leiloes_imovel/${leilaoId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ arquivo_imagem: null }),
  });

  if (!response.ok) {
    throw new Error(`Failed to clear image field for leilão ${leilaoId}: ${response.status}`);
  }
}

export async function runArchiver(): Promise<ArchiverRunResult> {
  if (isRunning) {
    throw new Error('Archiver is already running');
  }

  isRunning = true;
  const result: ArchiverRunResult = {
    executedAt: new Date().toISOString(),
    totalScanned: 0,
    totalExpired: 0,
    totalArchived: 0,
    imagesDeleted: 0,
    errors: 0,
    errorDetails: [],
  };

  try {
    const leiloes = await fetchPublishedLeiloes();
    result.totalScanned = leiloes.length;
    const now = new Date();

    for (const leilao of leiloes) {
      const mostAdvanced = getMostAdvancedPracaDate(leilao);
      if (!mostAdvanced || mostAdvanced >= now) continue;

      result.totalExpired++;

      try {
        await archiveLeilao(leilao.id);
        result.totalArchived++;

        if (leilao.arquivo_imagem) {
          try {
            await deleteImage(leilao.arquivo_imagem);
            await clearImageField(leilao.id);
            result.imagesDeleted++;
          } catch (imgError) {
            const msg = `Leilão #${leilao.id}: image deletion failed - ${imgError instanceof Error ? imgError.message : 'Unknown error'}`;
            result.errorDetails.push(msg);
            result.errors++;
          }
        }
      } catch (archiveError) {
        const msg = `Leilão #${leilao.id}: archive failed - ${archiveError instanceof Error ? archiveError.message : 'Unknown error'}`;
        result.errorDetails.push(msg);
        result.errors++;
      }
    }

    console.log(`[Archiver] Completed: ${result.totalArchived} archived, ${result.imagesDeleted} images deleted, ${result.errors} errors`);
  } catch (error) {
    const msg = `Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.errorDetails.push(msg);
    result.errors++;
    console.error(`[Archiver] Fatal error:`, error);
  } finally {
    isRunning = false;
    lastRunResult = result;
  }

  return result;
}

function getNextRunTime(): string | null {
  if (!cronTask) return null;
  const now = new Date();
  const spNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const todayAt2 = new Date(spNow);
  todayAt2.setHours(2, 0, 0, 0);

  const diffMs = now.getTime() - spNow.getTime();

  if (spNow < todayAt2) {
    return new Date(todayAt2.getTime() + diffMs).toISOString();
  }
  const tomorrowAt2 = new Date(todayAt2);
  tomorrowAt2.setDate(tomorrowAt2.getDate() + 1);
  return new Date(tomorrowAt2.getTime() + diffMs).toISOString();
}

export function getArchiverStatus(): ArchiverStatus {
  return {
    lastRun: lastRunResult,
    nextRun: getNextRunTime(),
    cronActive: cronTask !== null,
    isRunning,
  };
}

export function getLastArchiverRun(): ArchiverRunResult | null {
  return lastRunResult;
}

export function initArchiver(): void {
  if (cronTask) {
    cronTask.stop();
  }

  cronTask = cron.schedule('0 2 * * *', async () => {
    console.log('[Archiver] Starting scheduled run...');
    try {
      await runArchiver();
    } catch (error) {
      console.error('[Archiver] Scheduled run failed:', error);
    }
  }, {
    timezone: 'America/Sao_Paulo',
  });

  console.log('[Archiver] Cron job initialized - runs daily at 2:00 AM (São Paulo time)');
}
