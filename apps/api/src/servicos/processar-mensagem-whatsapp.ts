import { EvolutionService } from "@lancai/evolution";
import { buscar_usuario_por_whatsapp } from "./identificar-usuario-whatsapp";
import { processar_turno_conversa } from "./processar-turno-conversa";
import { eh_jid_grupo, extrair_telefone_whatsapp } from "./telefone-whatsapp";

const MENSAGEM_NAO_VINCULADO =
  "Olá! Seu número WhatsApp ainda não está vinculado a uma conta LançAI. Peça ao administrador para configurar WHATSAPP_NUMERO_DONO ou o campo whatsapp_numero do usuário.";

let evolutionSingleton: EvolutionService | null = null;

function obter_evolution(): EvolutionService {
  if (!evolutionSingleton) {
    evolutionSingleton = new EvolutionService();
  }
  return evolutionSingleton;
}

export type EntradaMensagemWhatsApp = {
  remoteJid: string;
  texto: string;
  fromMe?: boolean;
};

export type ResultadoMensagemWhatsApp = {
  processado: boolean;
  motivo?: string;
  usuarioId?: string;
  sessaoId?: string;
  resposta?: string;
};

/**
 * Adaptador de canal WhatsApp: identifica usuário, processa o turno e devolve texto.
 * O envio via Evolution fica a cargo do caller (webhook).
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
  if (!texto) {
    return { processado: false, motivo: "sem_texto" };
  }

  const numero = extrair_telefone_whatsapp(entrada.remoteJid);
  const usuario = await buscar_usuario_por_whatsapp(numero);
  if (!usuario) {
    return {
      processado: true,
      motivo: "nao_vinculado",
      resposta: MENSAGEM_NAO_VINCULADO,
    };
  }

  const turno = await processar_turno_conversa({
    usuarioId: usuario.id,
    mensagem: texto,
    reutilizarSessaoAtiva: true,
  });

  return {
    processado: true,
    usuarioId: usuario.id,
    sessaoId: turno.sessaoId,
    resposta: turno.resposta,
  };
}

/** Processa e já envia a resposta pelo EvolutionService. */
export async function processar_e_responder_whatsapp(
  entrada: EntradaMensagemWhatsApp,
): Promise<ResultadoMensagemWhatsApp> {
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
