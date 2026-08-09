import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { categoria, movimento, obter_banco, regra } from "@lancai/banco";
import { schemaCriarMovimento } from "@lancai/tipos";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { obter_escopo_leitura } from "../servicos/escopo-workspace";

const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());

function para_numero_ou_nulo(valor: string | null): number | null {
  if (valor === null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export async function registrar_rotas_movimento(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarMovimento.parse(requisicao.body);
    const resultado = await motor.criar_movimento(dados);
    return resposta.status(201).send(resultado);
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();

    const consulta = banco
      .select({
        id: movimento.id,
        descricao: movimento.descricao,
        descricaoFonte: movimento.descricaoFonte,
        valor: movimento.valor,
        tipo: movimento.tipo,
        status: movimento.status,
        fonte: movimento.fonte,
        dataMovimento: movimento.dataMovimento,
        contaId: movimento.contaId,
        cartaoId: movimento.cartaoId,
        statusFonte: movimento.statusFonte,
        parcelaNumero: movimento.parcelaNumero,
        parcelaTotal: movimento.parcelaTotal,
        ignoradoEmRelatorio: movimento.ignoradoEmRelatorio,
        categoriaId: movimento.categoriaId,
        categoriaNome: categoria.nome,
        classificadoPor: movimento.classificadoPor,
        regraId: movimento.regraId,
        regraTrecho: regra.condicaoValor,
        classificadoEm: movimento.classificadoEm,
        confiancaIa: movimento.confiancaIa,
        perfil: movimento.perfil,
      })
      .from(movimento)
      .innerJoin(categoria, eq(movimento.categoriaId, categoria.id))
      .leftJoin(regra, eq(movimento.regraId, regra.id))
      .orderBy(desc(movimento.dataMovimento));

    const linhas = usuarioId
      ? await (async () => {
          const escopo = await obter_escopo_leitura(usuarioId);
          if (escopo.workspaceIds.length === 0) return [];
          return consulta.where(
            and(
              eq(movimento.usuarioId, usuarioId),
              inArray(movimento.workspaceId, escopo.workspaceIds),
            ),
          );
        })()
      : await consulta;

    return linhas.map((linha) => ({
      ...linha,
      dataMovimento: String(linha.dataMovimento).slice(0, 10),
      confiancaIa: para_numero_ou_nulo(linha.confiancaIa),
      classificadoEm: linha.classificadoEm ? linha.classificadoEm.toISOString() : null,
    }));
  });
}
