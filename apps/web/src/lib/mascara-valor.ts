/** Extrai só dígitos de um texto. */
export function so_digitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * Formata digitação como valor pt-BR: `12.358,67`.
 * Os últimos 2 dígitos são centavos.
 */
export function formatar_valor_digitacao(entrada: string): string {
  const digitos = so_digitos(entrada);
  if (!digitos) return "";

  const inteiroBruto = digitos.slice(0, -2) || "0";
  const centavos = digitos.slice(-2).padStart(2, "0");
  const inteiro = inteiroBruto.replace(/^0+(?=\d)/, "");
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${comPontos},${centavos}`;
}

/** Converte máscara pt-BR em número (ex.: `"12.358,67"` → `12358.67`). */
export function parsear_valor_mascara(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const normalizado = limpo.replace(/\./g, "").replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Inicializa o campo a partir de um número da API. */
export function valor_para_mascara(valor: number): string {
  if (!Number.isFinite(valor)) return "";
  const centavos = Math.round(Math.abs(valor) * 100);
  const sinal = valor < 0 ? "-" : "";
  return `${sinal}${formatar_valor_digitacao(String(centavos))}`;
}
