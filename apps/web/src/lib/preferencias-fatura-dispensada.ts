const CHAVE = "lancai.faturaConviteDispensado";

function chave_usuario(usuarioId: string): string {
  return `${CHAVE}.${usuarioId}`;
}

export function ler_faturas_dispensadas(usuarioId: string): Set<string> {
  try {
    const bruto = localStorage.getItem(chave_usuario(usuarioId));
    if (!bruto) return new Set();
    const parsed: unknown = JSON.parse(bruto);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

export function salvar_faturas_dispensadas(usuarioId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(chave_usuario(usuarioId), JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export function dispensar_convite_fatura(
  usuarioId: string,
  movimentoId: string,
  atuais: Set<string>,
): Set<string> {
  const proximo = new Set(atuais);
  proximo.add(movimentoId);
  salvar_faturas_dispensadas(usuarioId, proximo);
  return proximo;
}
