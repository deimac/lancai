import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { movimento as movimentoTabela, obter_banco } from "@lancai/banco";
import { fato_imune_correcao } from "@lancai/tipos";
import type { EntityBusca, ResolverDeps, SearchCriteria } from "../agente/reference-resolver";

function dataIso(valor: string | Date): string {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

function paraEntidade(m: {
  id: string;
  descricao: string;
  valor: string | number;
  dataMovimento: string | Date;
  fonte: string;
  status: string;
}): EntityBusca {
  return {
    id: m.id,
    type: "transaction",
    label: m.descricao,
    metadata: {
      merchant: m.descricao,
      valor: Number(m.valor),
      dataMovimento: dataIso(m.dataMovimento),
      fonte: m.fonte,
      fatoImutavel: fato_imune_correcao({ fonte: m.fonte as never }),
      status: m.status,
    },
  };
}

/**
 * Busca entidades no Postgres para o ReferenceResolver.
 */
export class ReferenceResolverDepsDrizzle implements ResolverDeps {
  async getEntityById(id: string): Promise<EntityBusca | null> {
    const banco = obter_banco();
    const [linha] = await banco.select().from(movimentoTabela).where(eq(movimentoTabela.id, id)).limit(1);
    return linha ? paraEntidade(linha) : null;
  }

  async getEntitiesByIds(ids: string[]): Promise<EntityBusca[]> {
    if (ids.length === 0) return [];
    const banco = obter_banco();
    const linhas = await banco.select().from(movimentoTabela).where(inArray(movimentoTabela.id, ids));
    const porId = new Map(linhas.map((l) => [l.id, paraEntidade(l)]));
    return ids.map((id) => porId.get(id)).filter((e): e is EntityBusca => Boolean(e));
  }

  async searchEntities(criteria: SearchCriteria): Promise<EntityBusca[]> {
    const banco = obter_banco();
    const condicoes = [];
    if (criteria.userId) condicoes.push(eq(movimentoTabela.usuarioId, criteria.userId));
    if (criteria.merchant) condicoes.push(ilike(movimentoTabela.descricao, `%${criteria.merchant}%`));
    const linhas = await banco
      .select()
      .from(movimentoTabela)
      .where(condicoes.length ? and(...condicoes) : undefined)
      .orderBy(desc(movimentoTabela.dataMovimento))
      .limit(criteria.limit ?? 20);
    return linhas
      .filter((l) => {
        if (criteria.valor != null && Number(l.valor) !== criteria.valor) return false;
        if (criteria.dateFrom && dataIso(l.dataMovimento) < criteria.dateFrom) return false;
        if (criteria.dateTo && dataIso(l.dataMovimento) > criteria.dateTo) return false;
        return true;
      })
      .map(paraEntidade);
  }
}
