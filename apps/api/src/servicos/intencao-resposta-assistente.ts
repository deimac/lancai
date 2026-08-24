import type { AssistenteOutput } from "@lancai/assistente";
import type { IntencaoDetectada } from "@lancai/tipos";

const CONSULTA: IntencaoDetectada = {
  intencao: "CONSULTAR_VISAO",
  tipo_visao: "historico",
  filtros: {},
};

/**
 * O web ainda lê `resposta.intencao.intencao`. V2/V3 não carregam IntencaoDetectada;
 * este stub evita o front tratar sucesso como "não consegui falar com o servidor".
 */
export function intencaoParaRespostaChat(
  diagnostico?: AssistenteOutput["diagnostico"],
): IntencaoDetectada {
  const op = diagnostico?.op;
  const confirmado = diagnostico?.confirm ? false : true;

  if (op === "create") {
    return {
      intencao: "REGISTRAR_MOVIMENTO",
      tipo_movimento: "despesa",
      descricao: "lançamento",
      confirmado,
    };
  }

  if (op === "update") {
    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {},
      campos_alterados: { confirmado },
    };
  }

  if (op === "delete") {
    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {},
      campos_alterados: { status: "cancelado", confirmado },
    };
  }

  if (op === "greet") {
    return { intencao: "MENSAGEM_INFO", motivo: "saudacao" };
  }

  return CONSULTA;
}
