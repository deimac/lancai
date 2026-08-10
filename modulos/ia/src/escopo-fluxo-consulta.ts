import type { IntencaoConsultarVisao, TipoMovimento } from "@lancai/tipos";

/**
 * Escopo semântico da pergunta de histórico.
 * - despesa: "gastei", "despesa", "paguei"…
 * - receita: "ganhei", "recebi", "entrou"…
 * - ambos: "lançamentos", "extrato", "movimentações" sem lado
 */
export type EscopoFluxoConsulta = "despesa" | "receita" | "ambos";

const PEDIDO_DESPESA =
  /\b(gastei|gastou|gastos?|despesas?|despendi|paguei|pagou|comprei|compramos|sa[ií]das?|saiu|sa[ií]ram)\b/i;

const PEDIDO_RECEITA =
  /\b(ganhei|ganhou|ganhos?|recebi|recebeu|receitas?|entrou|entraram|entradas?|renda|faturamento|faturei)\b/i;

const PEDIDO_EXTRATO_AMBOS =
  /\b(lan[cç]amentos?|extrato|movimenta[cç][oõ]es|movimentos?)\b/i;

/**
 * Decide se a pergunta pede só gastos, só entradas ou os dois lados.
 * Empate (ex.: "gastei e recebi") → ambos.
 */
export function inferir_escopo_fluxo_consulta(mensagem: string): EscopoFluxoConsulta {
  const texto = mensagem.toLocaleLowerCase("pt-BR");
  const pedeDespesa = PEDIDO_DESPESA.test(texto);
  const pedeReceita = PEDIDO_RECEITA.test(texto);

  if (pedeDespesa && pedeReceita) return "ambos";
  if (pedeDespesa) return "despesa";
  if (pedeReceita) return "receita";
  if (PEDIDO_EXTRATO_AMBOS.test(texto)) return "ambos";
  return "ambos";
}

export function tipos_do_escopo_fluxo(escopo: EscopoFluxoConsulta): TipoMovimento[] | undefined {
  if (escopo === "despesa") return ["despesa"];
  if (escopo === "receita") return ["receita"];
  return undefined;
}

export function escopo_dos_tipos(tipos?: TipoMovimento[] | null): EscopoFluxoConsulta {
  if (!tipos?.length) return "ambos";
  const soDespesa = tipos.every((tipo) => tipo === "despesa");
  const soReceita = tipos.every((tipo) => tipo === "receita");
  if (soDespesa) return "despesa";
  if (soReceita) return "receita";
  return "ambos";
}

/**
 * Aplica o escopo (gastei vs recebi) na intenção de histórico.
 * Mensagem com sinal claro força o filtro; follow-up ("detalhado"/"mais")
 * sem sinal preserva `tipos` já gravados na consulta anterior.
 */
export function aplicar_escopo_fluxo_na_consulta(
  intencao: IntencaoConsultarVisao,
  mensagem: string,
): IntencaoConsultarVisao {
  if (intencao.tipo_visao !== "historico") return intencao;

  const escopo = inferir_escopo_fluxo_consulta(mensagem);
  if (escopo === "ambos") return intencao;

  return {
    ...intencao,
    filtros: {
      ...intencao.filtros,
      tipos: tipos_do_escopo_fluxo(escopo),
    },
  };
}
