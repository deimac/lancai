import type { EvolutionMessageKey, MidiaWhatsAppResumo, TipoMidiaWhatsApp } from "@lancai/evolution";

type MensagemWhatsApp = Record<string, unknown>;

function comoObjeto(valor: unknown): MensagemWhatsApp | undefined {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return undefined;
  return valor as MensagemWhatsApp;
}

function extrairKey(raiz: MensagemWhatsApp): EvolutionMessageKey | undefined {
  const key = comoObjeto(raiz.key);
  if (!key) return undefined;
  if (typeof key.remoteJid !== "string" || typeof key.id !== "string") return undefined;
  return {
    remoteJid: key.remoteJid,
    fromMe: typeof key.fromMe === "boolean" ? key.fromMe : false,
    id: key.id,
    ...(typeof key.participant === "string" ? { participant: key.participant } : {}),
  };
}

/**
 * Detecta áudio/imagem/documento no payload Evolution MESSAGES_UPSERT.
 * Retorna null se não houver mídia suportada.
 */
export function extrair_midia_mensagem(data: unknown): MidiaWhatsAppResumo | null {
  const raiz = comoObjeto(data);
  if (!raiz) return null;

  const mensagem = comoObjeto(raiz.message) ?? raiz;
  const key = extrairKey(raiz);
  if (!key) return null;

  const audio = comoObjeto(mensagem.audioMessage);
  if (audio) {
    return montarResumo("audio", key, mensagem, {
      mimetype: typeof audio.mimetype === "string" ? audio.mimetype : undefined,
    });
  }

  const imagem = comoObjeto(mensagem.imageMessage);
  if (imagem) {
    return montarResumo("image", key, mensagem, {
      caption: typeof imagem.caption === "string" ? imagem.caption : undefined,
      mimetype: typeof imagem.mimetype === "string" ? imagem.mimetype : "image/jpeg",
    });
  }

  const documento = comoObjeto(mensagem.documentMessage);
  if (documento) {
    const mimetype = typeof documento.mimetype === "string" ? documento.mimetype : undefined;
    const fileName = typeof documento.fileName === "string" ? documento.fileName : undefined;
    const ehPdf =
      (mimetype?.toLowerCase().includes("pdf") ?? false) ||
      (fileName?.toLowerCase().endsWith(".pdf") ?? false);
    const ehImagem = mimetype?.startsWith("image/") ?? false;
    if (!ehPdf && !ehImagem) {
      return null;
    }
    return montarResumo("document", key, mensagem, {
      caption: typeof documento.caption === "string" ? documento.caption : undefined,
      mimetype: mimetype ?? (ehPdf ? "application/pdf" : "image/jpeg"),
      fileName,
    });
  }

  return null;
}

function montarResumo(
  tipo: TipoMidiaWhatsApp,
  key: EvolutionMessageKey,
  mensagemBruta: MensagemWhatsApp,
  extras: { caption?: string; mimetype?: string; fileName?: string },
): MidiaWhatsAppResumo {
  return {
    tipo,
    key,
    mensagemBruta,
    ...extras,
  };
}
