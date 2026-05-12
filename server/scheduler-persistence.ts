const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();

const RUNS_COLLECTION = "scraping_scheduler_runs";
const ITEMS_COLLECTION = "scraping_scheduler_run_items";

let schemaChecked = false;
let persistenceUnavailableLogged = false;

export type SchedulerRunStatus = "running" | "completed" | "failed" | "cancelled" | "skipped";
export type SchedulerRunTrigger = "cron" | "manual";
export type SchedulerRunItemStatus = "running" | "success" | "error" | "skipped";
export type SchedulerRunItemAction = "onboarding" | "scraping";

export interface SchedulerRunRecord {
  id: string;
  status: SchedulerRunStatus;
  trigger: SchedulerRunTrigger;
  started_at: string;
  completed_at: string | null;
  day_index: number;
  day_name: string;
  total_sites: number;
  onboarded: number;
  scraped: number;
  errors: number;
  total_urls_found: number;
  config_snapshot: Record<string, unknown> | null;
  error_message: string | null;
}

export interface SchedulerRunItemRecord {
  id: string;
  run: string | null;
  site_id: number;
  site_name: string | null;
  site_url: string | null;
  action: SchedulerRunItemAction;
  status: SchedulerRunItemStatus;
  started_at: string;
  completed_at: string | null;
  urls_found: number;
  job_id: string | null;
  result_classification: string | null;
  confidence_score: number | null;
  error_message: string | null;
}

function canUseDirectus() {
  return !!DIRECTUS_URL && !!DIRECTUS_TOKEN;
}

async function directusFetch(path: string, init: RequestInit = {}) {
  if (!canUseDirectus()) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  return fetch(`${DIRECTUS_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  return data.data as T;
}

function logPersistenceUnavailable(error: unknown) {
  if (persistenceUnavailableLogged) return;
  persistenceUnavailableLogged = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[Scheduler] Persistencia Directus indisponivel para historico: ${message}`);
}

async function ensureCollection(collection: string, fields: Array<Record<string, unknown>>, meta: Record<string, unknown>) {
  const listResponse = await directusFetch("/collections");
  if (listResponse.ok) {
    const collections = await readJson<Array<{ collection: string }>>(listResponse);
    if (collections.some((item) => item.collection === collection)) return;
  } else {
    const body = await listResponse.text();
    throw new Error(`Sem permissao para listar colecoes: ${listResponse.status} ${body}`);
  }

  const createResponse = await directusFetch("/collections", {
    method: "POST",
    body: JSON.stringify({
      collection,
      fields,
      schema: {},
      meta,
    }),
  });

  if (!createResponse.ok && createResponse.status !== 409) {
    const body = await createResponse.text();
    throw new Error(`Falha ao criar ${collection}: ${createResponse.status} ${body}`);
  }
}

export async function ensureSchedulerPersistenceSchema() {
  if (schemaChecked || !canUseDirectus()) return;
  schemaChecked = true;

  try {
    await ensureCollection(
      RUNS_COLLECTION,
      [
        {
          field: "id",
          type: "uuid",
          meta: { special: ["uuid"], hidden: true, readonly: true, interface: "input" },
          schema: { is_primary_key: true, length: 36, has_auto_increment: false },
        },
        { field: "status", type: "string", meta: { interface: "select-dropdown", width: "half", required: true }, schema: { default_value: "running", is_nullable: false } },
        { field: "trigger", type: "string", meta: { interface: "select-dropdown", width: "half", required: true }, schema: { is_nullable: false } },
        { field: "started_at", type: "timestamp", meta: { interface: "datetime", width: "half", required: true }, schema: { is_nullable: false } },
        { field: "completed_at", type: "timestamp", meta: { interface: "datetime", width: "half" }, schema: {} },
        { field: "day_index", type: "integer", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "day_name", type: "string", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "total_sites", type: "integer", meta: { interface: "input", width: "half" }, schema: { default_value: 0 } },
        { field: "onboarded", type: "integer", meta: { interface: "input", width: "half" }, schema: { default_value: 0 } },
        { field: "scraped", type: "integer", meta: { interface: "input", width: "half" }, schema: { default_value: 0 } },
        { field: "errors", type: "integer", meta: { interface: "input", width: "half" }, schema: { default_value: 0 } },
        { field: "total_urls_found", type: "integer", meta: { interface: "input", width: "half" }, schema: { default_value: 0 } },
        { field: "config_snapshot", type: "json", meta: { interface: "input-code", width: "full" }, schema: {} },
        { field: "error_message", type: "text", meta: { interface: "input-multiline", width: "full" }, schema: {} },
      ],
      {
        icon: "schedule",
        note: "Historico persistente das execucoes do scheduler de scraping",
        display_template: "{{started_at}} - {{status}} - {{day_name}}",
      },
    );

    await ensureCollection(
      ITEMS_COLLECTION,
      [
        {
          field: "id",
          type: "uuid",
          meta: { special: ["uuid"], hidden: true, readonly: true, interface: "input" },
          schema: { is_primary_key: true, length: 36, has_auto_increment: false },
        },
        { field: "run", type: "uuid", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "site_id", type: "integer", meta: { interface: "input", width: "half", required: true }, schema: { is_nullable: false } },
        { field: "site_name", type: "string", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "site_url", type: "string", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "action", type: "string", meta: { interface: "select-dropdown", width: "half", required: true }, schema: { is_nullable: false } },
        { field: "status", type: "string", meta: { interface: "select-dropdown", width: "half", required: true }, schema: { default_value: "running", is_nullable: false } },
        { field: "started_at", type: "timestamp", meta: { interface: "datetime", width: "half", required: true }, schema: { is_nullable: false } },
        { field: "completed_at", type: "timestamp", meta: { interface: "datetime", width: "half" }, schema: {} },
        { field: "urls_found", type: "integer", meta: { interface: "input", width: "half" }, schema: { default_value: 0 } },
        { field: "job_id", type: "string", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "result_classification", type: "string", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "confidence_score", type: "integer", meta: { interface: "input", width: "half" }, schema: {} },
        { field: "error_message", type: "text", meta: { interface: "input-multiline", width: "full" }, schema: {} },
      ],
      {
        icon: "fact_check",
        note: "Resultado por site dentro de cada execucao do scheduler de scraping",
        display_template: "{{site_name}} - {{action}} - {{status}}",
      },
    );
  } catch (error) {
    logPersistenceUnavailable(error);
  }
}

export async function createSchedulerRun(input: Omit<SchedulerRunRecord, "id">): Promise<SchedulerRunRecord | null> {
  try {
    await ensureSchedulerPersistenceSchema();
    const response = await directusFetch(`/items/${RUNS_COLLECTION}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return readJson<SchedulerRunRecord>(response);
  } catch (error) {
    logPersistenceUnavailable(error);
    return null;
  }
}

export async function updateSchedulerRun(id: string | null, input: Partial<Omit<SchedulerRunRecord, "id">>) {
  if (!id) return null;
  try {
    const response = await directusFetch(`/items/${RUNS_COLLECTION}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return readJson<SchedulerRunRecord>(response);
  } catch (error) {
    logPersistenceUnavailable(error);
    return null;
  }
}

export async function createSchedulerRunItem(input: Omit<SchedulerRunItemRecord, "id">): Promise<SchedulerRunItemRecord | null> {
  try {
    await ensureSchedulerPersistenceSchema();
    const response = await directusFetch(`/items/${ITEMS_COLLECTION}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return readJson<SchedulerRunItemRecord>(response);
  } catch (error) {
    logPersistenceUnavailable(error);
    return null;
  }
}

export async function updateSchedulerRunItem(id: string | null, input: Partial<Omit<SchedulerRunItemRecord, "id">>) {
  if (!id) return null;
  try {
    const response = await directusFetch(`/items/${ITEMS_COLLECTION}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return readJson<SchedulerRunItemRecord>(response);
  } catch (error) {
    logPersistenceUnavailable(error);
    return null;
  }
}

export async function getSchedulerRuns(limit = 10): Promise<SchedulerRunRecord[]> {
  try {
    await ensureSchedulerPersistenceSchema();
    const url = new URL(`${DIRECTUS_URL}/items/${RUNS_COLLECTION}`);
    url.searchParams.set("sort", "-started_at");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("fields", "id,status,trigger,started_at,completed_at,day_index,day_name,total_sites,onboarded,scraped,errors,total_urls_found,config_snapshot,error_message");
    const response = await directusFetch(url.pathname + url.search);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return readJson<SchedulerRunRecord[]>(response);
  } catch (error) {
    logPersistenceUnavailable(error);
    return [];
  }
}

export async function getLatestSchedulerRun(): Promise<SchedulerRunRecord | null> {
  const runs = await getSchedulerRuns(1);
  return runs[0] || null;
}

export async function getSchedulerRunItems(runId: string, limit = 500): Promise<SchedulerRunItemRecord[]> {
  try {
    await ensureSchedulerPersistenceSchema();
    const url = new URL(`${DIRECTUS_URL}/items/${ITEMS_COLLECTION}`);
    url.searchParams.set("filter[run][_eq]", runId);
    url.searchParams.set("sort", "started_at");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("fields", "id,run,site_id,site_name,site_url,action,status,started_at,completed_at,urls_found,job_id,result_classification,confidence_score,error_message");
    const response = await directusFetch(url.pathname + url.search);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return readJson<SchedulerRunItemRecord[]>(response);
  } catch (error) {
    logPersistenceUnavailable(error);
    return [];
  }
}
