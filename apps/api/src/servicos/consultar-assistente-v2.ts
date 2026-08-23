import { ModuloRelatorios, type ResultadoVisao } from "@lancai/relatorios";
import type { QuerySpec, TipoVisao } from "@lancai/tipos";
import { hojeISO, tipoVisaoSchema } from "@lancai/tipos";
import { montar_resposta_visao } from "../montar-resposta-visao";

function tipoVisaoDe(spec: QuerySpec): TipoVisao {
  const parsed = tipoVisaoSchema.safeParse(spec.visionType);
  if (parsed.success) return parsed.data;
  if (spec.groupBy === "categoria") return "categoria";
  return "historico";
}

function idsDaVisao(resultado: ResultadoVisao): string[] {
  if (resultado.tipo !== "historico") return [];
  return resultado.dados.dias.flatMap((dia) => dia.itens.map((item) => item.id));
}

/**
 * Consulta o Core de relatórios e formata o texto como o chat legado.
 */
export async function consultar_assistente_v2(
  relatorios: ModuloRelatorios,
  spec: QuerySpec,
  usuarioId: string,
): Promise<{ ids: string[]; formattedText: string; data?: unknown }> {
  const periodo =
    spec.period?.de && spec.period?.ate ? { de: spec.period.de, ate: spec.period.ate } : undefined;
  const resultado = await relatorios.consultar_visao(
    tipoVisaoDe(spec),
    {
      usuarioId,
      descricao: spec.merchant ?? spec.descricao,
      perfil: spec.perfil,
      contaId: spec.contaId,
      cartaoId: spec.cartaoId,
      categoriaId: spec.categoriaId,
      pessoaId: spec.pessoaId,
      periodo,
      tipos: spec.tipos,
    },
    hojeISO(),
    { deslocamento: spec.offset },
  );
  return {
    ids: idsDaVisao(resultado),
    formattedText: montar_resposta_visao(resultado, { detalhado: spec.aggregation !== "sum" }),
    data: resultado,
  };
}
