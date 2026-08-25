import { compileQuery } from "@lancai/assistente";
import { hojeISO, queryStateFromSpec, type QuerySpec } from "@lancai/tipos";
import { escopo_dos_tipos } from "@lancai/ia";
import { ModuloRelatorios, type ResultadoVisao } from "@lancai/relatorios";
import { montar_resposta_visao, type ContraparteVazio } from "../montar-resposta-visao";

function idsDaVisao(resultado: ResultadoVisao): string[] {
  if (resultado.tipo === "historico") {
    return resultado.dados.dias.flatMap((dia) => dia.itens.map((item) => item.id));
  }
  if (resultado.tipo === "fluxo") {
    return resultado.dados.itens.map((item) => item.id).filter((id): id is string => Boolean(id));
  }
  return [];
}

export type OpcoesConsultarAssistente = {
  primeiroNome?: string;
  dataAtual?: string;
};

async function contraparteSemTipos(
  relatorios: ModuloRelatorios,
  spec: QuerySpec,
  usuarioId: string,
  dataAtual: string,
  resultado: ResultadoVisao,
): Promise<ContraparteVazio | undefined> {
  if (resultado.tipo !== "historico" || resultado.dados.totalItens > 0) return undefined;
  if (!spec.tipos?.length) return undefined;
  const { tipos: _tipos, ...semTipos } = spec;
  const query = queryStateFromSpec(semTipos);
  const compiled = compileQuery(query, { usuarioId, dataAtual });
  const irma = await relatorios.consultar_visao(compiled.visao, compiled.filtros, dataAtual, compiled.opcoes);
  if (irma.tipo !== "historico" || irma.dados.totalItens === 0) return undefined;
  const itens = irma.dados.dias.flatMap((dia) => dia.itens);
  return {
    entradas: itens.filter((item) => item.tipo === "receita").length,
    saidas: itens.filter((item) => item.tipo === "despesa").length,
  };
}

/**
 * Consulta o Core de relatórios e formata o texto como o chat legado.
 */
export async function consultar_assistente_v2(
  relatorios: ModuloRelatorios,
  spec: QuerySpec,
  usuarioId: string,
  opcoes: OpcoesConsultarAssistente = {},
): Promise<{ ids: string[]; formattedText: string; data?: unknown }> {
  const dataAtual = opcoes.dataAtual ?? hojeISO();
  const query = queryStateFromSpec(spec);
  const compiled = compileQuery(query, { usuarioId, dataAtual });
  const resultado = await relatorios.consultar_visao(
    compiled.visao,
    compiled.filtros,
    dataAtual,
    compiled.opcoes,
  );
  const contraparteVazio = await contraparteSemTipos(relatorios, spec, usuarioId, dataAtual, resultado);
  return {
    ids: idsDaVisao(resultado),
    formattedText: montar_resposta_visao(resultado, {
      detalhado: query.grain !== "summary",
      destaque: query.grain === "top" ? "top" : undefined,
      sentido: compiled.opcoes.ordenacao?.dir,
      listaLimitada: query.grain === "list" && compiled.opcoes.limite != null,
      ordenacaoLista: compiled.opcoes.ordenacao,
      escopoFluxo: escopo_dos_tipos(spec.tipos),
      dataAtual,
      primeiroNome: opcoes.primeiroNome,
      contraparteVazio,
    }),
    data: resultado,
  };
}
