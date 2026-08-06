import { EvolutionService } from "@lancai/evolution";
import type { IntencaoDetectada } from "@lancai/tipos";
import { buscar_usuario_por_whatsapp } from "./identificar-usuario-whatsapp";
import { processar_turno_conversa } from "./processar-turno-conversa";
import { eh_jid_grupo, extrair_telefone_whatsapp } from "./telefone-whatsapp";

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

export type EntradaMensagemWhatsApp = {
  remoteJid: string;
  texto: string;
  fromMe?: boolean;
  /** Visão já extraiu a intenção (foto/PDF). */
  intencaoPrevia?: IntencaoDetectada;
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

  const turno = await processar_turno_conversa({
    usuarioId: usuario.id,
    mensagem: texto || "(mídia)",
    reutilizarSessaoAtiva: true,
    intencaoPrevia: entrada.intencaoPrevia,
  });

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
