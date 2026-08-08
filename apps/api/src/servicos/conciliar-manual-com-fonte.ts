import { and, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import {
  CATEGORIA_NAO_CLASSIFICADO,
  categoria,
  movimento,
  obter_banco,
  type Movimento,
} from "@lancai/banco";
import {
  RepositorioConhecimentoDrizzle,
  ServicoConhecimento,
} from "@lancai/conhecimento";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { chave_descricao_lancamento, descricao_corresponde_busca } from "@lancai/ia";
import { paraNumero } from "@lancai/tipos";

const JANELA_DIAS = 3;
const LIMIAR_SCORE = 0.35;

export type ParConciliacao = {
  fatoId: string;
  manualId: string;
  score: number;
};

function dias_entre(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00Z`);
  const tb = Date.parse(`${b}T12:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(ta - tb) / (24 * 60 * 60 * 1000);
}

function somar_dias_iso(data: string, delta: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function tokens(texto: string): Set<string> {
  return new Set(
    chave_descricao_lancamento(texto)
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

/** Score 0–1: descrição do manual vs texto do banco. */
export function score_descricao_conciliacao(
  manualDescricao: string,
  descricaoFonte: string,
  favorecidoFonte?: string | null,
): number {
  const banco = [descricaoFonte, favorecidoFonte].filter(Boolean).join(" ");
  if (!manualDescricao.trim() || !banco.trim()) return 0;

  if (descricao_corresponde_busca(banco, manualDescricao)) return 0.9;
  if (descricao_corresponde_busca(manualDescricao, banco)) return 0.85;

  const a = tokens(manualDescricao);
  const b = tokens(banco);
  if (a.size === 0 || b.size === 0) return 0;

  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const uniao = a.size + b.size - inter;
  return uniao === 0 ? 0 : inter / uniao;
}

export function escolher_pares_conciliacao(
  fatos: Movimento[],
  manuais: Movimento[],
): ParConciliacao[] {
  type Candidato = ParConciliacao & { dias: number };
  const candidatos: Candidato[] = [];

  for (const fato of fatos) {
    for (const manual of manuais) {
      if (manual.contaId !== fato.contaId || manual.cartaoId !== fato.cartaoId) continue;
      if (manual.tipo !== fato.tipo) continue;
      if (paraNumero(manual.valor) !== paraNumero(fato.valor)) continue;

      const dias = dias_entre(String(manual.dataMovimento).slice(0, 10), String(fato.dataMovimento).slice(0, 10));
      if (dias > JANELA_DIAS) continue;

      const score = score_descricao_conciliacao(
        manual.descricao,
        fato.descricaoFonte,
        fato.favorecidoFonte,
      );
      if (score < LIMIAR_SCORE) continue;

      candidatos.push({
        fatoId: fato.id,
        manualId: manual.id,
        score,
        dias,
      });
    }
  }

  candidatos.sort((a, b) => b.score - a.score || a.dias - b.dias);

  const fatosUsados = new Set<string>();
  const manuaisUsados = new Set<string>();
  const pares: ParConciliacao[] = [];

  for (const c of candidatos) {
    if (fatosUsados.has(c.fatoId) || manuaisUsados.has(c.manualId)) continue;
    fatosUsados.add(c.fatoId);
    manuaisUsados.add(c.manualId);
    pares.push({ fatoId: c.fatoId, manualId: c.manualId, score: c.score });
  }

  return pares;
}

async function conhecimento_manual_vale_migrar(
  manual: Movimento,
  categoriaNome: string | null,
): Promise<boolean> {
  if (manual.classificadoPor === "usuario") return true;
  if (
    categoriaNome &&
    categoriaNome.toLocaleLowerCase("pt-BR") !==
      CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR")
  ) {
    return true;
  }
  if (manual.pessoaId || (manual.tags && manual.tags.length > 0) || manual.observacoes) {
    return true;
  }
  if (manual.ignoradoEmRelatorio) return true;
  // Descrição do usuário diferente da fonte costuma ser Conhecimento útil.
  if (
    manual.descricao.trim() &&
    chave_descricao_lancamento(manual.descricao) !==
      chave_descricao_lancamento(manual.descricaoFonte || "")
  ) {
    return true;
  }
  return false;
}

/**
 * Casamento pós-ingestão: Conhecimento do manual → Fato do banco; manual cancelado.
 * Rodar **antes** da classificação automática para não sobrescrever o que o usuário já ensinou.
 */
export async function conciliar_manuais_com_fatos_criados(entrada: {
  movimentoIdsCriados: string[];
  /** Se omitido, usa o usuarioId do Fato. */
  alteradoPor?: string;
  motor?: MotorFinanceiro;
  conhecimento?: ServicoConhecimento;
}): Promise<{ casados: number; pares: ParConciliacao[] }> {
  if (entrada.movimentoIdsCriados.length === 0) {
    return { casados: 0, pares: [] };
  }

  const motor = entrada.motor ?? new MotorFinanceiro(new RepositorioFinanceiroDrizzle());
  const conhecimento =
    entrada.conhecimento ?? new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
  const banco = obter_banco();

  const fatos = await banco
    .select()
    .from(movimento)
    .where(
      and(
        inArray(movimento.id, entrada.movimentoIdsCriados),
        eq(movimento.fonte, "open_finance"),
        ne(movimento.status, "cancelado"),
      ),
    );

  if (fatos.length === 0) return { casados: 0, pares: [] };
  const alteradoPor = entrada.alteradoPor ?? fatos[0]!.usuarioId;

  const datas = fatos.map((f) => String(f.dataMovimento).slice(0, 10));
  const minData = somar_dias_iso(datas.reduce((a, b) => (a < b ? a : b)), -JANELA_DIAS);
  const maxData = somar_dias_iso(datas.reduce((a, b) => (a > b ? a : b)), JANELA_DIAS);

  const contaIds = [...new Set(fatos.map((f) => f.contaId).filter(Boolean))] as string[];
  const cartaoIds = [...new Set(fatos.map((f) => f.cartaoId).filter(Boolean))] as string[];

  const origemCond =
    contaIds.length && cartaoIds.length
      ? or(inArray(movimento.contaId, contaIds), inArray(movimento.cartaoId, cartaoIds))
      : contaIds.length
        ? inArray(movimento.contaId, contaIds)
        : cartaoIds.length
          ? inArray(movimento.cartaoId, cartaoIds)
          : sql`false`;

  const manuais = await banco
    .select()
    .from(movimento)
    .where(
      and(
        eq(movimento.usuarioId, fatos[0]!.usuarioId),
        ne(movimento.status, "cancelado"),
        inArray(movimento.fonte, ["manual", "whatsapp"]),
        gte(movimento.dataMovimento, minData),
        lte(movimento.dataMovimento, maxData),
        origemCond,
      ),
    );

  const pares = escolher_pares_conciliacao(fatos, manuais);
  const manuaisPorId = new Map(manuais.map((m) => [m.id, m]));
  let casados = 0;

  for (const par of pares) {
    const manual = manuaisPorId.get(par.manualId);
    if (!manual) continue;

    const [cat] = await banco
      .select({ nome: categoria.nome })
      .from(categoria)
      .where(eq(categoria.id, manual.categoriaId))
      .limit(1);

    if (await conhecimento_manual_vale_migrar(manual, cat?.nome ?? null)) {
      await conhecimento.atualizar({
        movimentoId: par.fatoId,
        alteradoPor,
        conhecimento: {
          descricao: manual.descricao,
          categoriaId: manual.categoriaId,
          pessoaId: manual.pessoaId ?? undefined,
          perfil: manual.perfil,
          tags: manual.tags ?? [],
          observacoes: manual.observacoes,
          classificadoPor: manual.classificadoPor,
          regraId: manual.regraId,
          confiancaIa:
            manual.confiancaIa === null ? null : Number(manual.confiancaIa),
          ignoradoEmRelatorio: manual.ignoradoEmRelatorio,
        },
      });
    }

    await motor.cancelar_para_conciliacao({
      manualId: par.manualId,
      fatoId: par.fatoId,
      alteradoPor,
    });
    casados += 1;
  }

  return { casados, pares };
}
