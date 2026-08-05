import { limpar_termo_descricao, normalizar_descricao, rotulo_descricao_busca } from "./normalizar-descricao";

function dedupe_palavras(texto: string): string {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const chave = normalizar_descricao(palavra);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(palavra);
  }
  return saida.join(" ");
}

/**
 * Preferência: termo que o usuário escreveu na mensagem de cancelar/corrigir
 * (ex.: "farmacia" em "apague o lançamento de farmacia de hoje").
 */
export function extrair_termo_referencia_mensagem(mensagem: string): string | null {
  const texto = mensagem.trim();
  if (!texto) return null;

  const padrao =
    /\b(?:apague|apaga|apagar|exclua|exclui|excluir|cancele|cancela|cancelar|remova|remove|remover|delete|deletar)\b(?:\s+(?:o|a|os|as))?(?:\s+(?:lan[cç]amentos?|despesas?|compras?))?\s+(?:de|do|da)\s+(.+?)(?:\s+de\s+(?:hoje|ontem|anteontem|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|\s*[.!]?\s*$)/i;

  const match = padrao.exec(texto);
  if (match?.[1]) {
    const termo = dedupe_palavras(limpar_termo_descricao(match[1]));
    if (termo.length >= 2) return termo;
  }

  // Fallback: "cancela o almoço de ontem" / "corrige o uber de hoje"
  const padraoSimples =
    /\b(?:cancela|cancele|cancelar|apaga|apague|apagar|exclui|exclua|excluir|corrige|corrija|corrigir)\b(?:\s+(?:o|a|os|as))?\s+(.+?)(?:\s+de\s+(?:hoje|ontem|anteontem|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|\s+para\b|\s*$)/i;
  const simples = padraoSimples.exec(texto);
  if (simples?.[1]) {
    const termo = dedupe_palavras(
      limpar_termo_descricao(
        simples[1].replace(/\b(?:lan[cç]amentos?|despesas?|compras?)\b/gi, " "),
      ),
    );
    if (termo.length >= 2) return termo;
  }

  return null;
}

/** Escolhe o melhor rótulo: palavra do usuário > limpeza do termo da IA. */
export function preferir_termo_referencia(
  mensagem: string,
  descricaoIa?: string | null,
): string | null {
  return extrair_termo_referencia_mensagem(mensagem) ?? (
    descricaoIa ? rotulo_descricao_busca(descricaoIa) : null
  );
}
