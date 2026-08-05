/** Código curto exibido no chat (8 hex do UUID, sem hífens). */
export function codigo_curto_movimento(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toLowerCase();
}

/** Formata para o usuário: `#a1b2c3d4`. */
export function formatar_codigo_movimento(id: string): string {
  return `#${codigo_curto_movimento(id)}`;
}

/** Normaliza entrada do usuário (`#A1B2…`, UUID completo ou só hex). */
export function normalizar_codigo_busca(codigo: string): string {
  return codigo.replace(/^#/, "").replace(/-/g, "").toLowerCase().trim();
}

/** Extrai `#xxxxxxxx` da mensagem do usuário, se houver. */
export function extrair_codigo_da_mensagem(mensagem: string): string | null {
  const comHash = /#([a-f0-9]{6,12})\b/i.exec(mensagem);
  if (comHash?.[1]) return comHash[1].toLowerCase();

  const uuid = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(
    mensagem,
  );
  if (uuid?.[1]) return codigo_curto_movimento(uuid[1]);

  return null;
}
