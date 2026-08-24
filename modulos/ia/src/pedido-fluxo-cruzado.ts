/**
 * Detecta pergunta de fluxo cruzado: gasto pessoal pago com dinheiro da
 * empresa (ou o inverso). "gastos pessoais na conta da empresa" ≠ extrato PJ.
 *
 * Não use `pessoal(?:is)?` (vira «pessoalis») nem `pessoais?` (vira «pessoai» e
 * perde o singular). O plural de pessoal é «pessoais».
 */
const JANELA_LADO_A_LADO = 56;

const RE_LADO_PESSOAL = /\b(pessoalmente|pessoais|pessoal|pessoa\s+fisica|pf)\b/g;
const RE_LADO_EMPRESA = /\b(empresas?|pessoa\s+juridica|pj)\b/g;

function normalizar(mensagem: string): string {
  return mensagem
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function eh_pedido_fluxo_cruzado(mensagem: string): boolean {
  const texto = normalizar(mensagem);
  if (!texto.trim()) return false;

  if (/\bfluxo\s+cruzado\b/.test(texto)) return true;
  if (/\bcom\s+dinheiro\s+da\s+empresa\b/.test(texto)) return true;
  if (/\bcom\s+dinheiro\s+pessoal\b/.test(texto)) return true;
  if (
    /\bna\s+conta\s+da\s+empresa\b/.test(texto) &&
    /\b(?:pessoalmente|pessoais|pessoal)\b/.test(texto)
  ) {
    return true;
  }

  const pessoais = [...texto.matchAll(RE_LADO_PESSOAL)];
  const empresas = [...texto.matchAll(RE_LADO_EMPRESA)];
  for (const pessoal of pessoais) {
    for (const empresa of empresas) {
      if (Math.abs((pessoal.index ?? 0) - (empresa.index ?? 0)) <= JANELA_LADO_A_LADO) {
        return true;
      }
    }
  }
  return false;
}
