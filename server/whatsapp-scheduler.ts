import {
  getDueAgendamentos,
  updateAgendamento,
  claimAgendamento,
  getLeilaoById,
  getGrupos,
  sendLeilaoToGroups,
  createDisparo,
  getConnectionStatus,
} from "./whatsapp.js";
import type { Leilao, WhatsAppAgendamento } from "@shared/schema";

const TICK_MS = 60_000;
const DIRECTUS_URL = process.env.DIRECTUS_URL?.trim();
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN?.trim();

let interval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

async function buildImageUrl(leilao: Leilao): Promise<string | null> {
  let imageUrl: string | null = leilao.link_imagem || null;
  if (!imageUrl && leilao.arquivo_imagem && DIRECTUS_URL && DIRECTUS_TOKEN) {
    try {
      const imgResp = await fetch(`${DIRECTUS_URL}/assets/${leilao.arquivo_imagem}`, {
        headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
      });
      if (imgResp.ok) {
        const buf = Buffer.from(await imgResp.arrayBuffer());
        imageUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      }
    } catch (e) {
      console.warn("[WhatsApp Scheduler] Falha ao buscar asset Directus:", e);
    }
  }
  return imageUrl;
}

function isConnectionError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("not connected") ||
    m.includes("não conectado") ||
    m.includes("nao conectado") ||
    m.includes("connection closed") ||
    m.includes("socket closed") ||
    m.includes("conexao") ||
    m.includes("conexão")
  );
}

async function executeAgendamento(ag: WhatsAppAgendamento): Promise<void> {
  console.log(`[WhatsApp Scheduler] Executando agendamento #${ag.id} (leilão ${ag.leilao_id})`);

  // Claim atômico: PATCH com filtro status=pendente. Se outro processo cancelou
  // ou já reivindicou, o filtro não casa e nada é atualizado, evitando corrida.
  let claimed: WhatsAppAgendamento | null = null;
  try {
    claimed = await claimAgendamento(ag.id);
  } catch (e) {
    console.error(`[WhatsApp Scheduler] Falha ao reivindicar agendamento #${ag.id}:`, e);
    return;
  }
  if (!claimed) {
    console.log(
      `[WhatsApp Scheduler] Agendamento #${ag.id} não estava mais pendente (provável cancelamento), pulando`,
    );
    return;
  }

  try {
    const leilao = await getLeilaoById(ag.leilao_id);
    if (!leilao) {
      await updateAgendamento(ag.id, {
        status: "erro",
        error_message: `Leilão ${ag.leilao_id} não encontrado`,
        executed_at: new Date().toISOString(),
      });
      return;
    }

    const grupos = await getGrupos();
    const selectedGrupos = grupos.filter((g) => ag.grupo_ids.includes(g.id));
    const groupJids = selectedGrupos.map((g) => g.jid);

    if (groupJids.length === 0) {
      await updateAgendamento(ag.id, {
        status: "erro",
        error_message: "Nenhum grupo válido encontrado para esse agendamento",
        executed_at: new Date().toISOString(),
      });
      return;
    }

    const imageUrl = await buildImageUrl(leilao);
    const result = await sendLeilaoToGroups(leilao, groupJids, imageUrl, ag.mensagem || null);

    for (const grupo of selectedGrupos) {
      const wasSent = result.sent.includes(grupo.jid);
      const failInfo = result.failed.find((f) => f.jid === grupo.jid);
      try {
        await createDisparo({
          leilao_id: leilao.id,
          leilao_nome: leilao.nome_do_anuncio || `Leilão #${leilao.id}`,
          grupo_id: grupo.id,
          grupo_nome: grupo.nome,
          status: wasSent ? "enviado" : "erro",
          erro_mensagem: failInfo?.error || null,
        });
      } catch (e) {
        console.error("[WhatsApp Scheduler] Erro ao salvar disparo:", e);
      }
    }

    await updateAgendamento(ag.id, {
      status: "concluido",
      sent_count: result.sent.length,
      failed_count: result.failed.length,
      executed_at: new Date().toISOString(),
    });
    console.log(
      `[WhatsApp Scheduler] Agendamento #${ag.id} concluído: ${result.sent.length} enviados, ${result.failed.length} falhas`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[WhatsApp Scheduler] Erro no agendamento #${ag.id}:`, e);

    // Se o erro foi de conexão WhatsApp, devolver o item para a fila como pendente
    // (e não marcar como erro definitivo) para que seja retentado quando reconectar.
    const conn = getConnectionStatus();
    const isConnIssue = conn.status !== "connected" || isConnectionError(msg);
    if (isConnIssue) {
      console.log(
        `[WhatsApp Scheduler] WhatsApp indisponível durante agendamento #${ag.id}, devolvendo para 'pendente'`,
      );
      try {
        await updateAgendamento(ag.id, { status: "pendente", error_message: null });
      } catch (err2) {
        console.error(`[WhatsApp Scheduler] Falha ao devolver agendamento #${ag.id} para pendente:`, err2);
      }
      return;
    }

    try {
      await updateAgendamento(ag.id, {
        status: "erro",
        error_message: msg,
        executed_at: new Date().toISOString(),
      });
    } catch (err2) {
      console.error(`[WhatsApp Scheduler] Falha ao marcar agendamento #${ag.id} como erro:`, err2);
    }
  }
}

async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const conn = getConnectionStatus();
    if (conn.status !== "connected") {
      return;
    }

    let due: WhatsAppAgendamento[] = [];
    try {
      due = await getDueAgendamentos();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FORBIDDEN") && !msg.includes("404")) {
        console.error("[WhatsApp Scheduler] Erro ao buscar agendamentos vencidos:", msg);
      }
      return;
    }

    if (due.length === 0) return;
    console.log(`[WhatsApp Scheduler] ${due.length} agendamento(s) vencido(s) — processando sequencialmente`);

    for (const ag of due) {
      const conn2 = getConnectionStatus();
      if (conn2.status !== "connected") {
        console.log(`[WhatsApp Scheduler] WhatsApp desconectado, abortando ciclo`);
        break;
      }
      await executeAgendamento(ag);
    }
  } finally {
    isProcessing = false;
  }
}

export function startWhatsAppScheduler(): void {
  if (interval) return;
  console.log(`[WhatsApp Scheduler] Iniciando worker (tick a cada ${TICK_MS / 1000}s)`);
  interval = setInterval(() => {
    tick().catch((e) => console.error("[WhatsApp Scheduler] Erro no tick:", e));
  }, TICK_MS);
  setTimeout(() => {
    tick().catch((e) => console.error("[WhatsApp Scheduler] Erro no tick inicial:", e));
  }, 5_000);
}

export function stopWhatsAppScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
