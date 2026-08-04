/** Identificador de mensagem no WhatsApp (Evolution API). */
export type EvolutionMessageKey = {
  remoteJid: string;
  fromMe: boolean;
  id: string;
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
