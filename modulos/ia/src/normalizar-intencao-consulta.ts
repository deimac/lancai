import type { IntencaoConsultarVisao, IntencaoDetectada } from "@lancai/tipos";
import { periodo_historico_completo } from "./datas-relativas";
import {
  categoria_do_contexto,
  extrair_descricao_consulta_historico,
} from "./extrair-descricao-consulta";
import { inferir_origem_da_mensagem } from "./inferir-origem-movimento";
import type { ContextoInterpretacao } from "./prompt";

const PEDIDO_TODOS = /\btod[oa]s?\b/i;

/**
 * Corrige CONSULTAR_VISAO depois da LLM/atalho:
 * estabelecimento ou tarifa ≠ categoria; "todos" não fica preso no mês atual.
 */
export function normalizar_intencao_consulta(
  intencao: IntencaoDetectada,
  contexto: ContextoInterpretacao,
  mensagem = "",
): IntencaoDetectada {
  if (intencao.intencao !== "CONSULTAR_VISAO") return intencao;

  const origem = inferir_origem_da_mensagem(mensagem, contexto);
  const filtros = { ...intencao.filtros };
  if (!filtros.cartao_nome && origem.cartao_nome) filtros.cartao_nome = origem.cartao_nome;
  if (!filtros.conta_nome && origem.conta_nome) filtros.conta_nome = origem.conta_nome;

  const categoriaCitada = filtros.categoria_nome?.trim() || "";
  if (categoriaCitada && !categoria_do_contexto(categoriaCitada, contexto)) {
    filtros.descricao = filtros.descricao?.trim() || categoriaCitada;
    filtros.categoria_nome = null;
  }

  if (!filtros.descricao && !filtros.categoria_nome) {
    const termo = extrair_descricao_consulta_historico(mensagem, contexto);
    if (termo) {
      const categoria = categoria_do_contexto(termo, contexto);
      if (categoria) filtros.categoria_nome = categoria;
      else filtros.descricao = termo;
    }
  }

  if (PEDIDO_TODOS.test(mensagem) && !filtros.periodo) {
    filtros.periodo = periodo_historico_completo(contexto.dataAtual);
  }

  const virouBuscaPorTexto =
    Boolean(filtros.descricao) &&
    !filtros.categoria_nome &&
    (intencao.tipo_visao === "categoria" || intencao.tipo_visao === "historico");

  const resultado: IntencaoConsultarVisao = {
    ...intencao,
    filtros,
    tipo_visao: virouBuscaPorTexto ? "historico" : intencao.tipo_visao,
    detalhado:
      virouBuscaPorTexto && intencao.tipo_visao === "categoria" ? true : intencao.detalhado,
  };
  return resultado;
}
