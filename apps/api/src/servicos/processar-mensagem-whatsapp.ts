import { EvolutionService } from "@lancai/evolution";
import type { IntencaoDetectada } from "@lancai/tipos";
import { buscar_usuario_por_whatsapp } from "./identificar-usuario-whatsapp";
import { processar_turno_conversa } from "./processar-turno-conversa";
import { eh_jid_grupo, extrair_telefone_whatsapp } from "./telefone-whatsapp";
import { obterAssistenteCore } from "./assistente-v2";
import { obterAssistenteCoreV3 } from "./assistente-v3";
import { gravar_turno_chat } from "./gravar-turno-chat";
import { isFlagEnabled } from "../config/feature-flags";

let evolutionSingleton: EvolutionService | null = null;

function obter_evolution(): EvolutionService {
  if (!evolutionSingleton) {
    evolutionSingleton = new EvolutionService();
  }
  return evolutionSingleton;
}

function numero_bot_lancai(): string {
  return (process.env.WHATSAPP_NUMERO_LANCAI ?? "").replace(/\D/g, "");
}

function mensagem_para_v3(texto: string, previa?: IntencaoDetectada): string {
  if (texto.trim()) return texto;
  if (!previa || previa.intencao !== "REGISTRAR_MOVIMENTO") return "(mídia)";
  const partes = [`Gastei ${previa.valor ?? ""} em ${previa.descricao}`];
  if (previa.conta_nome) partes.push(`na conta ${previa.conta_nome}`);
  if (previa.cartao_nome) partes.push(`no cartão ${previa.cartao_nome}`);
  if (previa.data_movimento) partes.push(`em ${previa.data_movimento}`);
  return partes.filter((p) => !p.includes("undefined")).join(" ").replace(/\s+/g, " ").trim();
}

export type EntradaMensagemWhatsApp = {
  remoteJid: string;
  texto: string;
  fromMe?: boolean;
  /** Visão já extraiu a intenção (foto/PDF). */
  intencaoPrevia?: IntencaoDetectada;
  /** Id estável da mensagem Evolution (deduplicação v2). */
  messageId?: string;
};

export type ResultadoMensagemWhatsApp = {
  processado: boolean;
  motivo?: string;
  usuarioId?: string;
  sessaoId?: string;
  resposta?: string;
};

/**
 * Adaptador de canal WhatsApp: só processa números em usuario.whatsapp_numero.
 * Números não autorizados: silêncio (sem resposta).
 */
export async function processar_mensagem_whatsapp(
  entrada: EntradaMensagemWhatsApp,
): Promise<ResultadoMensagemWhatsApp> {
  if (entrada.fromMe) {
    return { processado: false, motivo: "fromMe" };
  }
  if (eh_jid_grupo(entrada.remoteJid)) {
    return { processado: false, motivo: "grupo" };
  }

  const texto = entrada.texto.trim();
  if (!texto && !entrada.intencaoPrevia) {
    return { processado: false, motivo: "sem_texto" };
  }

  const numero = extrair_telefone_whatsapp(entrada.remoteJid);
  const bot = numero_bot_lancai();
  if (bot && numero === bot) {
    console.info(`[whatsapp] ignorado remetente=bot ${numero}`);
    return { processado: false, motivo: "remetente_bot" };
  }

  const usuario = await buscar_usuario_por_whatsapp(numero);
  if (!usuario) {
    console.info(`[whatsapp] número não autorizado (silêncio): ${numero}`);
    return { processado: false, motivo: "nao_autorizado" };
  }

  if (isFlagEnabled("ASSISTENTE_V3_ASSISTANT")) {
    const v3 = await obterAssistenteCoreV3().processar({
      usuarioId: usuario.id,
      mensagem: mensagem_para_v3(texto, entrada.intencaoPrevia),
      canal: "whatsapp",
      messageId: entrada.messageId,
    });
    if (!v3.duplicata) {
      await gravar_turno_chat({
        sessaoId: v3.sessaoId,
        mensagemUsuario: mensagem_para_v3(texto, entrada.intencaoPrevia),
        resposta: v3.resposta,
      });
    }
    return {
      processado: true,
      usuarioId: usuario.id,
      sessaoId: v3.sessaoId,
      resposta: v3.resposta,
    };
  }

  if (isFlagEnabled("ASSISTENTE_V2_ASSISTANT")) {
    const v2 = await obterAssistenteCore().processar({
      usuarioId: usuario.id,
      mensagem: texto || "(mídia)",
      canal: "whatsapp",
      messageId: entrada.messageId,
      intencaoPrevia: entrada.intencaoPrevia as never,
    });
    if (!v2.duplicata) {
      await gravar_turno_chat({
        sessaoId: v2.sessaoId,
        mensagemUsuario: texto || "(mídia)",
        resposta: v2.resposta,
      });
    }
    if (isFlagEnabled("ASSISTENTE_V3_SHADOW")) {
      void obterAssistenteCoreV3()
        .processar({
          usuarioId: usuario.id,
          mensagem: texto || "(mídia)",
          canal: "whatsapp",
          messageId: entrada.messageId,
          somenteLeitura: true,
        })
        .then((v3) => {
          console.info("[assistant-v3] Shadow comparison", {
            traceId: v3.traceId,
            shadow: true,
            v2: v2.resposta,
            v3: v3.resposta,
          });
        })
        .catch((erro) => {
          console.warn("[assistant-v3] Shadow falhou", erro);
        });
    }
    return {
      processado: true,
      usuarioId: usuario.id,
      sessaoId: v2.sessaoId,
      resposta: v2.resposta,
    };
  }

  const turno = await processar_turno_conversa({
    usuarioId: usuario.id,
    mensagem: texto || "(mídia)",
    reutilizarSessaoAtiva: true,
    intencaoPrevia: entrada.intencaoPrevia,
  });

  if (isFlagEnabled("ASSISTENTE_V3_SHADOW")) {
    void obterAssistenteCoreV3()
      .processar({
        usuarioId: usuario.id,
        mensagem: texto || "(mídia)",
        sessaoId: turno.sessaoId,
        canal: "whatsapp",
        messageId: entrada.messageId,
        somenteLeitura: true,
      })
      .then((v3) => {
        console.info("[assistant-v3] Shadow comparison", {
          traceId: v3.traceId,
          shadow: true,
          legacy: turno.resposta,
          v3: v3.resposta,
        });
      })
      .catch((erro) => {
        console.warn("[assistant-v3] Shadow falhou", erro);
      });
  }

  if (isFlagEnabled("ASSISTENTE_V2_SHADOW")) {
    void obterAssistenteCore()
      .processar({
        usuarioId: usuario.id,
        mensagem: texto || "(mídia)",
        canal: "whatsapp",
        messageId: entrada.messageId,
        intencaoPrevia: entrada.intencaoPrevia as never,
      })
      .then((v2) => {
        console.info("[assistant-v2] Shadow comparison", {
          traceId: v2.traceId,
          shadow: true,
          legacy: turno.resposta,
          v2: v2.resposta,
        });
      })
      .catch((erro) => {
        console.warn("[assistant-v2] Shadow falhou", erro);
      });
  }

  return {
    processado: true,
    usuarioId: usuario.id,
    sessaoId: turno.sessaoId,
    resposta: turno.resposta,
  };
}

/** Processa e já envia a resposta pelo EvolutionService (só se houver resposta). */
export async function processar_e_responder_whatsapp(
  entrada: EntradaMensagemWhatsApp,
): Promise<ResultadoMensagemWhatsApp> {
  if (eh_jid_grupo(entrada.remoteJid)) {
    return { processado: false, motivo: "grupo" };
  }

  const resultado = await processar_mensagem_whatsapp(entrada);
  if (!resultado.processado || !resultado.resposta) {
    return resultado;
  }

  const numero = extrair_telefone_whatsapp(entrada.remoteJid);
  await obter_evolution().enviarMensagemWhatsApp({
    numero,
    texto: resultado.resposta,
  });

  return resultado;
}

const MSG_FALHA_WHATSAPP =
  "Tive uma instabilidade ao processar sua mensagem. Pode tentar de novo em instantes?";

/** Aviso fixo ao usuário após falha de turno (sem chamar LLM). */
export async function avisar_falha_whatsapp(
  remoteJid: string,
  texto = MSG_FALHA_WHATSAPP,
): Promise<void> {
  if (eh_jid_grupo(remoteJid)) return;
  const numero = extrair_telefone_whatsapp(remoteJid);
  if (!numero) return;
  await obter_evolution().enviarMensagemWhatsApp({
    numero,
    texto,
  });
}
