import type { InternalJob, JobStatus, CrawlResult, AnalysisResult, ResultClassification } from './types.js';
import { generateId } from './utils.js';
import { normalizeUrl } from '../directus.js';

const MAX_JOBS = 200;
const JOB_EXPIRY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

const BLOCKED_CALLBACK_HOSTS = [
  /^localhost$/i, /^127\.\d+\.\d+\.\d+$/, /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/, /^\[::1?\]$/, /^\[?fe80:/i,
  /^169\.254\.\d+\.\d+$/, /^\[?fd[0-9a-f]{2}:/i,
  /^metadata\.google\.internal$/i, /^metadata\.internal$/i,
];

function isCallbackUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    for (const pattern of BLOCKED_CALLBACK_HOSTS) {
      if (pattern.test(host)) return false;
    }
    return true;
  } catch { return false; }
}

class InternalJobManager {
  private jobs = new Map<string, InternalJob>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  createJob(type: 'onboard' | 'scrape', siteUrl: string, siteId?: number, callbackUrl?: string): InternalJob {
    this.cleanup();

    const job: InternalJob = {
      id: `int_${generateId(10)}`,
      status: 'pending',
      type,
      siteUrl,
      siteId,
      progress: 0,
      progressMessage: 'Aguardando início...',
      urlsFound: [],
      totalUrls: 0,
      pagesProcessed: 0,
      startedAt: new Date().toISOString(),
      callbackUrl,
      engine: 'internal',
    };

    this.jobs.set(job.id, job);
    return job;
  }

  getJob(jobId: string): InternalJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(limit = 50): InternalJob[] {
    const all = Array.from(this.jobs.values());
    all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return all.slice(0, limit);
  }

  deleteJob(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  updateProgress(jobId: string, progress: number, message: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.progress = Math.min(99, progress);
    job.progressMessage = message;
    job.status = 'processing';
  }

  completeJob(jobId: string, result: CrawlResult | AnalysisResult, classification?: ResultClassification, confidenceScore?: number): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    job.result = result;

    if ('urls_found' in result) {
      const seen = new Set<string>();
      const dedupedUrls: string[] = [];
      for (const u of result.urls_found) {
        const norm = normalizeUrl(u);
        if (!seen.has(norm)) {
          seen.add(norm);
          const protocol = u.match(/^https?:\/\//)?.[0] || 'https://';
          dedupedUrls.push(protocol + norm);
        }
      }
      result.urls_found = dedupedUrls;
      result.total_urls = dedupedUrls.length;
      job.urlsFound = result.urls_found;
      job.totalUrls = result.total_urls;
      job.pagesProcessed = result.pages_processed;

      if (classification) {
        job.resultClassification = classification;
      } else {
        job.resultClassification = result.total_urls > 0 ? 'success' : 'empty';
      }
      job.progressMessage = job.resultClassification === 'success'
        ? `Concluído! ${result.total_urls} URLs encontradas`
        : 'Concluído sem URLs encontradas';
    } else {
      job.progressMessage = 'Concluído!';
      job.resultClassification = classification || 'success';
    }

    if (confidenceScore !== undefined) {
      job.confidenceScore = confidenceScore;
    }

    this.sendCallback(job);
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.progress = 0;
    job.progressMessage = `Erro: ${error}`;
    job.error = error;
    job.resultClassification = 'error';
    job.completedAt = new Date().toISOString();

    this.sendCallback(job);
  }

  private async sendCallback(job: InternalJob): Promise<void> {
    if (!job.callbackUrl) return;
    if (!isCallbackUrlSafe(job.callbackUrl)) {
      console.warn(`[JobManager] Callback URL bloqueada (SSRF): ${job.callbackUrl}`);
      return;
    }

    try {
      await fetch(job.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.id,
          status: job.status,
          site_url: job.siteUrl,
          site_id: job.siteId,
          total_urls: job.totalUrls,
          urls_found: job.urlsFound,
          pages_processed: job.pagesProcessed,
          error: job.error,
          engine: 'internal',
          result_classification: job.resultClassification,
          confidence_score: job.confidenceScore,
        }),
      });
    } catch (e) {
      console.error(`[JobManager] Callback falhou para job ${job.id}:`, e);
    }
  }

  private cleanup(): void {
    const now = Date.now();

    for (const [id, job] of Array.from(this.jobs)) {
      const age = now - new Date(job.startedAt).getTime();
      if ((job.status === 'pending' || job.status === 'processing') && age > JOB_TIMEOUT_MS) {
        job.status = 'failed';
        job.progress = 0;
        job.progressMessage = 'Job expirou por timeout';
        job.error = `Job expirou após ${Math.round(JOB_TIMEOUT_MS / 60000)} minutos sem conclusão`;
        job.completedAt = new Date().toISOString();
        this.sendCallback(job);
      }
    }

    if (this.jobs.size < MAX_JOBS) return;

    const toDelete: string[] = [];

    for (const [id, job] of Array.from(this.jobs)) {
      const age = now - new Date(job.startedAt).getTime();
      if (age > JOB_EXPIRY_MS && (job.status === 'completed' || job.status === 'failed')) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.jobs.delete(id);
    }

    if (this.jobs.size >= MAX_JOBS) {
      const sorted = Array.from(this.jobs.entries())
        .filter(([_, j]) => j.status === 'completed' || j.status === 'failed')
        .sort((a, b) => new Date(a[1].startedAt).getTime() - new Date(b[1].startedAt).getTime());

      const toRemove = sorted.slice(0, Math.max(1, sorted.length - MAX_JOBS / 2));
      for (const [id] of toRemove) {
        this.jobs.delete(id);
      }
    }
  }
}

export const jobManager = new InternalJobManager();
