import baileysMod, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket,
  delay,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCodeMod from "qrcode";
import pinoMod from "pino";
import { WhatsAppGrupo, WhatsAppDisparo, WhatsAppAgendamento, WhatsAppAgendamentoStatus, Leilao } from "@shared/schema";

const makeWASocket = (typeof baileysMod === "function" ? baileysMod : (baileysMod as any).default) as typeof baileysMod;
const QRCode = (typeof QRCodeMod === "object" && QRCodeMod !== null && "toDataURL" in QRCodeMod ? QRCodeMod : (QRCodeMod as any).default || QRCodeMod) as typeof QRCodeMod;
const P = (typeof pinoMod === "function" ? pinoMod : (pinoMod as any).default) as typeof pinoMod;

const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();

let sock: WASocket | null = null;
let currentQR: string | null = null;
let connectionStatus: "disconnected" | "connecting" | "connected" = "disconnected";
let connectedPhone: string | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

function getLogger() {
  return P({ level: "silent" }) as any;
}

export function getConnectionStatus() {
  return {
    status: connectionStatus,
    phone: connectedPhone,
    hasQR: !!currentQR,
  };
}

export function getCurrentQR(): string | null {
  return currentQR;
}

export async function connectWhatsApp(): Promise<{ qr?: string; status: string }> {
  if (connectionStatus === "connected" && sock) {
    return { status: "already_connected" };
  }

  if (connectionStatus === "connecting") {
    if (currentQR) {
      return { qr: currentQR, status: "waiting_qr" };
    }
    return { status: "connecting" };
  }

  connectionStatus = "connecting";
  currentQR = null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState("./whatsapp_auth");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: getLogger(),
      browser: ["Invest Leilões", "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      generateHighQualityLinkPreview: false,
    });

    sock.ev.on("creds.update", saveCreds);

    return new Promise<{ qr?: string; status: string }>((resolve) => {
      let resolved = false;

      sock!.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          currentQR = qrDataUrl;
          if (!resolved) {
            resolved = true;
            resolve({ qr: qrDataUrl, status: "waiting_qr" });
          }
        }

        if (connection === "open") {
          connectionStatus = "connected";
          currentQR = null;
          connectedPhone = sock?.user?.id?.split(":")[0] || null;
          console.log("WhatsApp connected:", connectedPhone);
          if (!resolved) {
            resolved = true;
            resolve({ status: "connected" });
          }
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          connectionStatus = "disconnected";
          connectedPhone = null;
          sock = null;

          if (shouldReconnect) {
            console.log("WhatsApp disconnected, reconnecting in 5s...");
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(() => {
              connectWhatsApp().catch(console.error);
            }, 5000);
          } else {
            console.log("WhatsApp logged out");
            currentQR = null;
          }

          if (!resolved) {
            resolved = true;
            resolve({ status: "disconnected" });
          }
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ status: "connecting" });
        }
      }, 5000);
    });
  } catch (error) {
    connectionStatus = "disconnected";
    sock = null;
    throw error;
  }
}

export async function disconnectWhatsApp(): Promise<void> {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (sock) {
    await sock.logout().catch(() => {});
    sock = null;
  }
  connectionStatus = "disconnected";
  connectedPhone = null;
  currentQR = null;

  const fs = await import("fs");
  const path = await import("path");
  const authDir = path.join(process.cwd(), "whatsapp_auth");
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

export async function sendLeilaoToGroups(
  leilao: Leilao,
  groupJids: string[],
  imageUrl?: string | null,
  customMessage?: string | null,
): Promise<{ sent: string[]; failed: { jid: string; error: string }[] }> {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp não está conectado");
  }

  const message = customMessage || buildLeilaoMessage(leilao);
  const sent: string[] = [];
  const failed: { jid: string; error: string }[] = [];

  for (const jid of groupJids) {
    try {
      if (imageUrl) {
        let imageSource: { url: string } | Buffer;
        
        if (imageUrl.startsWith("data:")) {
          const base64Data = imageUrl.split(",")[1];
          imageSource = Buffer.from(base64Data, "base64");
        } else if (imageUrl.startsWith("http")) {
          try {
            const imgResp = await fetch(imageUrl);
            if (imgResp.ok) {
              const arrayBuf = await imgResp.arrayBuffer();
              imageSource = Buffer.from(arrayBuf);
            } else {
              imageSource = { url: imageUrl };
            }
          } catch {
            imageSource = { url: imageUrl };
          }
        } else {
          imageSource = { url: imageUrl };
        }

        await sock.sendMessage(jid, {
          image: imageSource,
          caption: message,
        });
      } else {
        await sock.sendMessage(jid, { text: message });
      }
      sent.push(jid);
      await delay(2000);
    } catch (error) {
      failed.push({
        jid,
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  return { sent, failed };
}

function formatBRL(value: string | number): string {
  const str = String(value).trim();
  if (/^\d{1,3}(\.\d{3})*(,\d{2})?$/.test(str)) {
    return str;
  }
  const cleaned = str.replace(/[^\d.,\-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      const num = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
      if (!isNaN(num)) return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      const num = parseFloat(cleaned.replace(/,/g, ""));
      if (!isNaN(num)) return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
  const num = parseFloat(cleaned.replace(",", "."));
  if (!isNaN(num)) return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return str;
}

function parseNumericValue(str: string): number {
  const cleaned = str.replace(/[R$\s]/g, "").trim();
  if (!cleaned) return 0;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatDateBR(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} às ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

export function buildLeilaoMessage(leilao: Leilao): string {
  const lines: string[] = [];

  const titleParts: string[] = [];
  if (leilao.tipo_do_imovel) titleParts.push(leilao.tipo_do_imovel);
  if (leilao.cidade) titleParts.push(leilao.cidade);
  if (leilao.estado_uf) titleParts.push(leilao.estado_uf);
  const title = titleParts.length > 0
    ? `${titleParts[0]}${titleParts.length > 1 ? ", " + titleParts.slice(1).join(" - ") : ""}`
    : leilao.nome_do_anuncio || `Leilão #${leilao.id}`;
  lines.push(`🏠 *${title}*`);
  lines.push("");

  if (leilao.tipo_do_imovel) {
    lines.push(`🏢 *Tipo:* ${leilao.tipo_do_imovel}`);
  }

  if (leilao.area_imovel) {
    lines.push(`📐 *Área:* ${leilao.area_imovel}`);
  }

  if (leilao.valor_avalaiacao_imovel) {
    lines.push(`💰 *Avaliação:* R$ ${formatBRL(leilao.valor_avalaiacao_imovel)}`);
  }

  if (leilao.valor_leilao) {
    lines.push(`💵 *Valor de Leilão:* R$ ${formatBRL(leilao.valor_leilao)}`);
  }

  let descontoStr = "";
  const descontoRaw = leilao.desconto != null ? String(leilao.desconto).trim() : "";
  const descontoNumeric = descontoRaw ? parseNumericValue(descontoRaw) : 0;
  const descontoIsValid = descontoRaw !== "" && descontoNumeric > 0;
  if (descontoIsValid) {
    descontoStr = descontoRaw;
  } else if (leilao.valor_avalaiacao_imovel) {
    const avaliacao = parseNumericValue(String(leilao.valor_avalaiacao_imovel));
    const candidates = [
      leilao.valor_leilao,
      (leilao as Record<string, unknown>).valor_praca1,
      (leilao as Record<string, unknown>).valor_praca2,
      (leilao as Record<string, unknown>).valor_praca3,
    ]
      .filter((v): v is string | number => v != null && String(v).trim() !== "")
      .map((v) => parseNumericValue(String(v)))
      .filter((n) => n > 0);

    if (avaliacao > 0 && candidates.length > 0) {
      const lowest = Math.min(...candidates);
      if (lowest < avaliacao) {
        const pct = Math.round(((avaliacao - lowest) / avaliacao) * 100);
        if (pct > 0) {
          descontoStr = `${pct}%`;
        }
      }
    }
  }
  if (descontoStr) {
    lines.push(`🔥 *Desconto:* ${descontoStr}`);
  }

  lines.push("");

  if (leilao.praca_1) {
    lines.push(`📅 *1ª Praça:* ${formatDateBR(leilao.praca_1)}`);
  }
  if (leilao.praca_2) {
    lines.push(`📅 *2ª Praça:* ${formatDateBR(leilao.praca_2)}`);
  }

  const locParts: string[] = [];
  if (leilao.cidade) locParts.push(leilao.cidade);
  if (leilao.estado_uf) locParts.push(leilao.estado_uf);

  if (locParts.length > 0) {
    lines.push("");
    lines.push(`📍 *Localização:* ${locParts.join(", ")}`);
  }

  lines.push("");
  lines.push("─────────────────");
  lines.push(`🔗 *Link do Imóvel:* https://investleiloesbrasil.com.br/imovel/?id=${leilao.id}`);
  lines.push(`📲 *Está com dúvidas? Fale com um consultor:* https://bit.ly/imovel-mais`);
  lines.push("");
  lines.push("⚠️ Solicite análise desse imóvel até 7 dias antes da finalização do leilão");

  return lines.join("\n");
}

async function directusRequest(method: string, endpoint: string, body?: unknown) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    throw new Error("DIRECTUS_URL and DIRECTUS_TOKEN must be set");
  }

  const response = await fetch(`${DIRECTUS_URL}/items/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Directus error ${response.status}: ${err}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function getGrupos(): Promise<WhatsAppGrupo[]> {
  const result = await directusRequest("GET", "whatsapp_grupos?sort=nome&limit=-1");
  return result?.data || [];
}

export async function createGrupo(data: { nome: string; jid: string; regiao?: string; ativo?: boolean }): Promise<WhatsAppGrupo> {
  const result = await directusRequest("POST", "whatsapp_grupos", {
    nome: data.nome,
    jid: data.jid,
    regiao: data.regiao || null,
    ativo: data.ativo !== false,
  });
  return result?.data;
}

export async function updateGrupo(id: number, data: Partial<{ nome: string; jid: string; regiao: string; ativo: boolean }>): Promise<WhatsAppGrupo> {
  const result = await directusRequest("PATCH", `whatsapp_grupos/${id}`, data);
  return result?.data;
}

export async function deleteGrupo(id: number): Promise<void> {
  await directusRequest("DELETE", `whatsapp_grupos/${id}`);
}

export async function getLeilaoById(id: number): Promise<Leilao | null> {
  try {
    const result = await directusRequest("GET", `leiloes_imovel/${id}`);
    return result?.data || null;
  } catch (e) {
    console.error("Error fetching leilao:", e);
    return null;
  }
}

export async function createDisparo(data: {
  leilao_id: number;
  leilao_nome: string | null;
  grupo_id: number;
  grupo_nome: string | null;
  status: string;
  erro_mensagem?: string | null;
}): Promise<WhatsAppDisparo> {
  const result = await directusRequest("POST", "whatsapp_disparos", data);
  return result?.data;
}

export async function getDisparos(limit = 50): Promise<WhatsAppDisparo[]> {
  const result = await directusRequest("GET", `whatsapp_disparos?sort=-date_created&limit=${limit}`);
  return result?.data || [];
}

function normalizeAgendamento(raw: any): WhatsAppAgendamento {
  let grupoIds: number[] = [];
  if (Array.isArray(raw?.grupo_ids)) {
    grupoIds = raw.grupo_ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
  } else if (typeof raw?.grupo_ids === "string") {
    try {
      const parsed = JSON.parse(raw.grupo_ids);
      if (Array.isArray(parsed)) {
        grupoIds = parsed.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
      }
    } catch {
      // ignore
    }
  }
  return {
    id: raw.id,
    leilao_id: raw.leilao_id,
    leilao_nome: raw.leilao_nome ?? null,
    grupo_ids: grupoIds,
    mensagem: raw.mensagem ?? "",
    scheduled_at: raw.scheduled_at,
    status: (raw.status as WhatsAppAgendamentoStatus) || "pendente",
    sent_count: raw.sent_count ?? null,
    failed_count: raw.failed_count ?? null,
    executed_at: raw.executed_at ?? null,
    error_message: raw.error_message ?? null,
    date_created: raw.date_created ?? null,
    date_updated: raw.date_updated ?? null,
  };
}

export async function createAgendamento(data: {
  leilao_id: number;
  leilao_nome: string | null;
  grupo_ids: number[];
  mensagem: string;
  scheduled_at: string;
}): Promise<WhatsAppAgendamento> {
  const result = await directusRequest("POST", "whatsapp_agendamentos", {
    leilao_id: data.leilao_id,
    leilao_nome: data.leilao_nome,
    grupo_ids: data.grupo_ids,
    mensagem: data.mensagem,
    scheduled_at: data.scheduled_at,
    status: "pendente",
  });
  return normalizeAgendamento(result?.data);
}

export async function listAgendamentos(opts: { status?: WhatsAppAgendamentoStatus; limit?: number } = {}): Promise<WhatsAppAgendamento[]> {
  const params = new URLSearchParams();
  params.set("sort", "-scheduled_at");
  params.set("limit", String(opts.limit ?? 100));
  if (opts.status) {
    params.set("filter[status][_eq]", opts.status);
  }
  const result = await directusRequest("GET", `whatsapp_agendamentos?${params.toString()}`);
  return (result?.data || []).map(normalizeAgendamento);
}

export async function getAgendamentoById(id: number): Promise<WhatsAppAgendamento | null> {
  try {
    const result = await directusRequest("GET", `whatsapp_agendamentos/${id}`);
    return result?.data ? normalizeAgendamento(result.data) : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Item específico não encontrado: retorna null. Erros de coleção/permissão são repropagados.
    if (msg.includes("404") && msg.toLowerCase().includes("record")) {
      return null;
    }
    if (msg.includes("FORBIDDEN") || msg.includes("403") || msg.includes("404")) {
      throw e;
    }
    return null;
  }
}

export async function updateAgendamento(id: number, patch: Partial<{
  status: WhatsAppAgendamentoStatus;
  sent_count: number;
  failed_count: number;
  executed_at: string;
  error_message: string | null;
}>): Promise<WhatsAppAgendamento> {
  const result = await directusRequest("PATCH", `whatsapp_agendamentos/${id}`, patch);
  return normalizeAgendamento(result?.data);
}

export async function cancelAgendamento(id: number): Promise<WhatsAppAgendamento> {
  const current = await getAgendamentoById(id);
  if (!current) {
    throw new Error("Agendamento não encontrado");
  }
  if (current.status !== "pendente") {
    throw new Error(`Só é possível cancelar agendamentos pendentes (status atual: ${current.status})`);
  }
  return updateAgendamento(id, { status: "cancelado" });
}

export async function getDueAgendamentos(): Promise<WhatsAppAgendamento[]> {
  const nowIso = new Date().toISOString();
  const params = new URLSearchParams();
  params.set("sort", "scheduled_at");
  params.set("limit", "20");
  params.set("filter[status][_eq]", "pendente");
  params.set("filter[scheduled_at][_lte]", nowIso);
  const result = await directusRequest("GET", `whatsapp_agendamentos?${params.toString()}`);
  return (result?.data || []).map(normalizeAgendamento);
}

export async function getWhatsAppGroups(): Promise<{
  id: string;
  subject: string;
  size: number;
  isCommunity: boolean;
  linkedParent?: string;
  announceGroupId?: string;
  announceGroupSubject?: string;
  linkedGroups?: { id: string; subject: string; size: number }[];
}[]> {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp não está conectado");
  }

  const allGroups = await sock.groupFetchAllParticipating();
  const groupValues = Object.values(allGroups) as any[];

  const communityJids = new Set<string>();
  const childToParent = new Map<string, string>();

  for (const g of groupValues) {
    if (g.linkedParent) {
      childToParent.set(g.id, g.linkedParent);
      communityJids.add(g.linkedParent);
    }
    if (g.isCommunity) {
      communityJids.add(g.id);
    }
  }

  const results: {
    id: string;
    subject: string;
    size: number;
    isCommunity: boolean;
    linkedParent?: string;
    announceGroupId?: string;
    announceGroupSubject?: string;
    linkedGroups?: { id: string; subject: string; size: number }[];
  }[] = [];

  for (const g of groupValues) {
    const isCommunity = communityJids.has(g.id) && !childToParent.has(g.id);

    if (isCommunity) {
      const children = groupValues.filter((child: any) => child.linkedParent === g.id);

      const announceGroup = children.find((child: any) => child.isCommunityAnnounce === true);

      const linked = children
        .filter((child: any) => child.isCommunityAnnounce !== true)
        .map((child: any) => ({
          id: child.id,
          subject: child.subject || "Sem nome",
          size: child.participants?.length || 0,
        }));

      if (linked.length === 0 && !announceGroup) {
        results.push({
          id: g.id,
          subject: g.subject || "Sem nome",
          size: g.participants?.length || 0,
          isCommunity: false,
        });
        continue;
      }

      results.push({
        id: g.id,
        subject: g.subject || "Sem nome",
        size: g.participants?.length || 0,
        isCommunity: true,
        announceGroupId: announceGroup?.id,
        announceGroupSubject: announceGroup?.subject || "Grupo de Avisos",
        linkedGroups: linked,
      });
    } else if (!childToParent.has(g.id)) {
      results.push({
        id: g.id,
        subject: g.subject || "Sem nome",
        size: g.participants?.length || 0,
        isCommunity: false,
      });
    } else {
      results.push({
        id: g.id,
        subject: g.subject || "Sem nome",
        size: g.participants?.length || 0,
        isCommunity: false,
        linkedParent: childToParent.get(g.id),
      });
    }
  }

  results.sort((a, b) => {
    if (a.isCommunity && !b.isCommunity) return -1;
    if (!a.isCommunity && b.isCommunity) return 1;
    return a.subject.localeCompare(b.subject);
  });

  return results;
}

export async function resolveInviteLink(link: string): Promise<{ jid: string; subject: string }> {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp não está conectado");
  }

  const code = link.replace(/^https?:\/\/chat\.whatsapp\.com\//, "").trim();
  if (!code) {
    throw new Error("Link de convite inválido");
  }

  const metadata = await sock.groupGetInviteInfo(code);
  return {
    jid: metadata.id,
    subject: metadata.subject || "Sem nome",
  };
}

export async function tryAutoConnect() {
  const fs = await import("fs");
  const path = await import("path");
  const authDir = path.join(process.cwd(), "whatsapp_auth");
  if (fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0) {
    console.log("WhatsApp auth found, auto-connecting...");
    connectWhatsApp().catch((err) => {
      console.error("WhatsApp auto-connect failed:", err);
    });
  }
}
