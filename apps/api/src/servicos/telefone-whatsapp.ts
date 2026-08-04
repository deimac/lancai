/** Extrai só dígitos de um remoteJid ou número WhatsApp. */
export function extrair_telefone_whatsapp(remoteJidOuNumero: string): string {
  const base = remoteJidOuNumero.split("@")[0] ?? remoteJidOuNumero;
  return base.replace(/\D/g, "");
}

export function eh_jid_grupo(remoteJid: string): boolean {
  return remoteJid.toLowerCase().includes("@g.us");
}
