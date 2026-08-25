import { compileQuery } from "@lancai/assistente";
import { hojeISO, queryStateFromSpec, type QuerySpec } from "@lancai/tipos";
import { escopo_dos_tipos } from "@lancai/ia";
import { ModuloRelatorios, type ResultadoVisao } from "@lancai/relatorios";
import { montar_resposta_visao } from "../montar-resposta-visao";

function idsDaVisao(resultado: ResultadoVisao): string[] {
  if (resultado.tipo === "historico") {
    return resultado.dados.dias.flatMap((dia) => dia.itens.map((item) => item.id));
  }
  if (resultado.tipo === "fluxo") {
    return resultado.dados.itens.map((item) => item.id).filter((id): id is string => Boolean(id));
  }
  return [];
}

/**
 * Consulta o Core de relatórios e formata o texto como o chat legado.
 */
export async function consultar_assistente_v2(
  relatorios: ModuloRelatorios,
  spec: QuerySpec,
  usuarioId: string,
): Promise<{ ids: string[]; formattedText: string; data?: unknown }> {
  const query = queryStateFromSpec(spec);
  const compiled = compileQuery(query, { usuarioId, dataAtual: hojeISO() });
  const resultado = await relatorios.consultar_visao(
    compiled.visao,
    compiled.filtros,
    hojeISO(),
    compiled.opcoes,
  );
  return {
    ids: idsDaVisao(resultado),
    formattedText: montar_resposta_visao(resultado, {
      detalhado: spec.aggregation !== "sum",
      escopoFluxo: escopo_dos_tipos(spec.tipos),
    }),
    data: resultado,
  };
}
