/** Identificador de mensagem no WhatsApp (Evolution API). */
export type EvolutionMessageKey = {
  remoteJid: string;
  fromMe: boolean;
  id: string;
  participant?: string;
};

/** Tipo de mídia inbound suportada no webhook. */
export type TipoMidiaWhatsApp = "audio" | "image" | "document";

/** Resumo de mídia extraída de MESSAGES_UPSERT (sem bytes). */
export type MidiaWhatsAppResumo = {
  tipo: TipoMidiaWhatsApp;
  caption?: string;
  mimetype?: string;
  fileName?: string;
  /** Payload da mensagem Evolution (necessário para getBase64). */
  mensagemBruta: Record<string, unknown>;
  key: EvolutionMessageKey;
};

/** Resposta de getBase64FromMediaMessage. */
export type MidiaBase64Evolution = {
  base64: string;
  mimetype?: string;
};

/** Botão de resposta rápida para sendButtons. */
export type EvolutionButton = {
  title: string;
  displayText: string;
  id: string;
};

/** Item de uma seção de lista. */
export type EvolutionListRow = {
  title: string;
  description?: string;
  rowId: string;
};

/** Seção de lista interativa. */
export type EvolutionListSection = {
  title: string;
  rows: EvolutionListRow[];
};
