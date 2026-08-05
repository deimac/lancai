import { appendFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { evolutionEvento, obter_banco } from "@lancai/banco";
import { schemaWebhookEvolution } from "../dtos/webhook-evolution";
import { processar_e_responder_whatsapp } from "../servicos/processar-mensagem-whatsapp";
import { validarAssinaturaEvolution } from "../webhooks/validar-assinatura-evolution";

const LOG_ARQUIVO = "/tmp/lancai-evolution-webhook.log";

function parseDataEvento(valor: string | number | undefined): Date | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === "number") {
    const ms = valor < 1_000_000_000_000 ? valor * 1000 : valor;
    const data = new Date(ms);
    return Number.isNaN(data.getTime()) ? null : data;
  }
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function payloadSemSegredo(body: Record<string, unknown>): Record<string, unknown> {
  const { apikey: _apikey, ...resto } = body;
  return resto;
}

function normalizarNomeEvento(evento: string): string {
  return evento.trim().toUpperCase().replace(/\./g, "_");
}

function extrairTextoMensagem(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const raiz = data as Record<string, unknown>;
  const mensagem = (raiz.message ?? raiz) as Record<string, unknown> | undefined;
  if (!mensagem || typeof mensagem !== "object") return undefined;

  if (typeof mensagem.conversation === "string") return mensagem.conversation;

  const textoEstendido = mensagem.extendedTextMessage as { text?: string } | undefined;
  if (textoEstendido && typeof textoEstendido.text === "string") return textoEstendido.text;

  const imagem = mensagem.imageMessage as { caption?: string } | undefined;
  if (imagem && typeof imagem.caption === "string") return imagem.caption;

  return undefined;
}

function extrairResumoMensagem(data: unknown): {
  remoteJid?: string;
  fromMe?: boolean;
  pushName?: string;
  messageId?: string;
  texto?: string;
} {
  if (!data || typeof data !== "object") return {};
  const raiz = data as Record<string, unknown>;
  const key = raiz.key as
    | { remoteJid?: string; fromMe?: boolean; id?: string }
    | undefined;

  return {
    remoteJid: typeof key?.remoteJid === "string" ? key.remoteJid : undefined,
    fromMe: typeof key?.fromMe === "boolean" ? key.fromMe : undefined,
    pushName: typeof raiz.pushName === "string" ? raiz.pushName : undefined,
    messageId: typeof key?.id === "string" ? key.id : undefined,
    texto: extrairTextoMensagem(raiz),
  };
}

function logarArquivo(linha: string): void {
  try {
    appendFileSync(LOG_ARQUIVO, `${new Date().toISOString()} ${linha}\n`);
  } catch {
    // ignore
  }
}

export async function registrar_rotas_webhooks_evolution(app: FastifyInstance) {
  app.post("/evolution", async (requisicao, resposta) => {
    const bruto = requisicao.body;

    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
      requisicao.log.warn("[evolution-webhook] body inválido");
      return resposta.status(400).send({ erro: "Body inválido." });
    }

    const assinatura = validarAssinaturaEvolution(
      requisicao,
      bruto as { apikey?: string; instance?: string; server_url?: string },
    );
    if (!assinatura.ok) {
      requisicao.log.warn({ motivo: assinatura.motivo }, "[evolution-webhook] assinatura rejeitada");
      return resposta.status(401).send({ erro: "Não autorizado." });
    }

    const evento = schemaWebhookEvolution.parse(bruto);
    const nomeEvento = normalizarNomeEvento(evento.event);
    const resumo =
      nomeEvento === "MESSAGES_UPSERT" ? extrairResumoMensagem(evento.data) : undefined;

    requisicao.log.info(
      {
        event: evento.event,
        eventNormalized: nomeEvento,
        instance: evento.instance,
        ...(resumo ?? {}),
      },
      nomeEvento === "MESSAGES_UPSERT"
        ? "[evolution-webhook] MENSAGEM RECEBIDA (MESSAGES_UPSERT)"
        : "[evolution-webhook] evento recebido",
    );

    if (nomeEvento === "MESSAGES_UPSERT") {
      const linha = `MESSAGES_UPSERT instance=${evento.instance} from=${resumo?.remoteJid ?? "?"} pushName=${resumo?.pushName ?? "?"} fromMe=${String(resumo?.fromMe)} texto=${JSON.stringify(resumo?.texto ?? null)}`;
      console.info(`[evolution-webhook] ${linha}`);
      logarArquivo(linha);
    }

    // 200 imediato — processamento e IA em background.
    await resposta.status(200).send({ ok: true });

    try {
      const banco = obter_banco();
      const payload = payloadSemSegredo({ ...evento });
      await banco.insert(evolutionEvento).values({
        evento: evento.event,
        instancia: evento.instance,
        payload,
        dataEvento: parseDataEvento(evento.date_time),
      });
      requisicao.log.info(
        { event: evento.event, instance: evento.instance },
        "[evolution-webhook] evento salvo",
      );
      if (nomeEvento === "MESSAGES_UPSERT") {
        logarArquivo(`SALVO MESSAGES_UPSERT instance=${evento.instance}`);
      }
    } catch (erro) {
      requisicao.log.error(
        { err: erro, event: evento.event, instance: evento.instance },
        "[evolution-webhook] falha ao salvar evento",
      );
      logarArquivo(`ERRO_SALVAR event=${evento.event} ${String(erro)}`);
    }

    if (nomeEvento !== "MESSAGES_UPSERT") return;
    if (!resumo?.remoteJid || !resumo.texto) return;
    if (resumo.fromMe) {
      logarArquivo(`IGNORADO fromMe id=${resumo.messageId ?? "?"}`);
      return;
    }

    try {
      const resultado = await processar_e_responder_whatsapp({
        remoteJid: resumo.remoteJid,
        texto: resumo.texto,
        fromMe: resumo.fromMe,
      });

      if (!resultado.processado && resultado.motivo === "nao_autorizado") {
        requisicao.log.warn(
          { remoteJid: resumo.remoteJid },
          "[evolution-webhook] número não autorizado — sem resposta",
        );
        logarArquivo(`NAO_AUTORIZADO from=${resumo.remoteJid} (silêncio)`);
        return;
      }

      requisicao.log.info(
        {
          processado: resultado.processado,
          motivo: resultado.motivo,
          usuarioId: resultado.usuarioId,
          sessaoId: resultado.sessaoId,
        },
        "[evolution-webhook] turno WhatsApp processado",
      );
      logarArquivo(
        `PROCESSADO processado=${resultado.processado} motivo=${resultado.motivo ?? "-"} usuario=${resultado.usuarioId ?? "-"} resposta=${JSON.stringify(resultado.resposta?.slice(0, 120) ?? null)}`,
      );
    } catch (erro) {
      requisicao.log.error(
        { err: erro, remoteJid: resumo.remoteJid },
        "[evolution-webhook] falha ao processar mensagem WhatsApp",
      );
      logarArquivo(`ERRO_PROCESSAR from=${resumo.remoteJid} ${String(erro)}`);
    }
  });
}
