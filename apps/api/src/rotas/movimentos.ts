import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { categoria, movimento, obter_banco, regra } from "@lancai/banco";
import { total_compra_parcela } from "@lancai/relatorios";
import { schemaCriarMovimento } from "@lancai/tipos";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { obter_escopo_leitura } from "../servicos/escopo-workspace";

const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());

function para_numero_ou_nulo(valor: string | null): number | null {
  if (valor === null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function normalizar_descricao_parcela(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

export async function registrar_rotas_movimento(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarMovimento.parse(requisicao.body);
    const resultado = await motor.criar_movimento(dados);
    return resposta.status(201).send(resultado);
  });

  /**
   * Parcelas irmãs do mesmo parcelamento OF (competência a competência).
   * Agrupa por cartão + data da compra + total de parcelas (+ descrição).
   */
  app.get("/:id/parcelas-irmas", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    if (!usuarioId) {
      return resposta.status(400).send({ erro: "usuarioId é obrigatório." });
    }

    const banco = obter_banco();
    const escopo = await obter_escopo_leitura(usuarioId);
    if (escopo.workspaceIds.length === 0) {
      return resposta.status(404).send({ erro: "Movimento não encontrado." });
    }

    const [ancora] = await banco
      .select({
        id: movimento.id,
        descricao: movimento.descricao,
        valor: movimento.valor,
        cartaoId: movimento.cartaoId,
        parcelaNumero: movimento.parcelaNumero,
        parcelaTotal: movimento.parcelaTotal,
        parcelaCompraEm: movimento.parcelaCompraEm,
        parcelaCompraValor: movimento.parcelaCompraValor,
        usuarioId: movimento.usuarioId,
        workspaceId: movimento.workspaceId,
      })
      .from(movimento)
      .where(
        and(
          eq(movimento.id, id),
          eq(movimento.usuarioId, usuarioId),
          inArray(movimento.workspaceId, escopo.workspaceIds),
        ),
      )
      .limit(1);

    if (!ancora) {
      return resposta.status(404).send({ erro: "Movimento não encontrado." });
    }

    const parcelaTotal = ancora.parcelaTotal;
    const compraEm = ancora.parcelaCompraEm
      ? String(ancora.parcelaCompraEm).slice(0, 10)
      : null;

    if (
      !ancora.cartaoId ||
      parcelaTotal == null ||
      parcelaTotal < 2 ||
      !compraEm
    ) {
      return {
        ancoraId: ancora.id,
        totalCompra: null,
        parcelas: [],
      };
    }

    const candidatas = await banco
      .select({
        id: movimento.id,
        descricao: movimento.descricao,
        valor: movimento.valor,
        status: movimento.status,
        dataMovimento: movimento.dataMovimento,
        parcelaNumero: movimento.parcelaNumero,
        parcelaTotal: movimento.parcelaTotal,
        parcelaCompraEm: movimento.parcelaCompraEm,
        parcelaCompraValor: movimento.parcelaCompraValor,
      })
      .from(movimento)
      .where(
        and(
          eq(movimento.usuarioId, usuarioId),
          inArray(movimento.workspaceId, escopo.workspaceIds),
          eq(movimento.cartaoId, ancora.cartaoId),
          eq(movimento.parcelaCompraEm, compraEm),
          eq(movimento.parcelaTotal, parcelaTotal),
          ne(movimento.status, "cancelado"),
        ),
      )
      .orderBy(asc(movimento.parcelaNumero), asc(movimento.dataMovimento));

    const descricaoAncora = normalizar_descricao_parcela(ancora.descricao);
    const mesmasDescricao = candidatas.filter(
      (linha) => normalizar_descricao_parcela(linha.descricao) === descricaoAncora,
    );
    const irmas = mesmasDescricao.length > 0 ? mesmasDescricao : candidatas;

    const valorAncora = Number(ancora.valor);
    const totalCompra = total_compra_parcela({
      valorParcela: Number.isFinite(valorAncora) ? valorAncora : 0,
      parcelaTotal,
      parcelaCompraValor: ancora.parcelaCompraValor,
    });

    return {
      ancoraId: ancora.id,
      totalCompra,
      parcelas: irmas.map((linha) => ({
        id: linha.id,
        descricao: linha.descricao,
        valor: linha.valor,
        status: linha.status,
        dataMovimento: String(linha.dataMovimento).slice(0, 10),
        parcelaNumero: linha.parcelaNumero,
        parcelaTotal: linha.parcelaTotal,
      })),
    };
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
        provedor: movimento.provedor,
        idExterno: movimento.idExterno,
        dataMovimento: movimento.dataMovimento,
        contaId: movimento.contaId,
        cartaoId: movimento.cartaoId,
        statusFonte: movimento.statusFonte,
        parcelaNumero: movimento.parcelaNumero,
        parcelaTotal: movimento.parcelaTotal,
        parcelaCompraEm: movimento.parcelaCompraEm,
        parcelaCompraValor: movimento.parcelaCompraValor,
        ignoradoEmRelatorio: movimento.ignoradoEmRelatorio,
        papel: movimento.papel,
        cartaoFaturaId: movimento.cartaoFaturaId,
        competenciaFatura: movimento.competenciaFatura,
        categoriaId: movimento.categoriaId,
        categoriaNome: categoria.nome,
        classificadoPor: movimento.classificadoPor,
        regraId: movimento.regraId,
        regraTrecho: regra.nome ?? regra.condicaoValor,
        classificadoEm: movimento.classificadoEm,
        confiancaIa: movimento.confiancaIa,
        tipoGasto: movimento.tipoGasto,
        workspaceId: movimento.workspaceId,
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

    return linhas.map((linha) => {
      const valorNum = Number(linha.valor);
      const parcelaCompraValorExibicao = total_compra_parcela({
        valorParcela: Number.isFinite(valorNum) ? valorNum : 0,
        parcelaTotal: linha.parcelaTotal,
        parcelaCompraValor: linha.parcelaCompraValor,
      });
      return {
        ...linha,
        dataMovimento: String(linha.dataMovimento).slice(0, 10),
        parcelaCompraEm: linha.parcelaCompraEm
          ? String(linha.parcelaCompraEm).slice(0, 10)
          : null,
        /** Total informativo da compra (institucional ou estimado). */
        parcelaCompraValor:
          parcelaCompraValorExibicao != null
            ? parcelaCompraValorExibicao.toFixed(2)
            : null,
        confiancaIa: para_numero_ou_nulo(linha.confiancaIa),
        classificadoEm: linha.classificadoEm ? linha.classificadoEm.toISOString() : null,
      };
    });
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    if (!usuarioId) {
      return resposta.status(400).send({ erro: "usuarioId é obrigatório." });
    }

    const banco = obter_banco();
    const escopo = await obter_escopo_leitura(usuarioId);
    if (escopo.workspaceIds.length === 0) {
      return resposta.status(404).send({ erro: "Movimento não encontrado." });
    }

    const [atual] = await banco
      .select({
        id: movimento.id,
        fonte: movimento.fonte,
        descricao: movimento.descricao,
      })
      .from(movimento)
      .where(
        and(
          eq(movimento.id, id),
          eq(movimento.usuarioId, usuarioId),
          inArray(movimento.workspaceId, escopo.workspaceIds),
        ),
      )
      .limit(1);

    if (!atual) {
      return resposta.status(404).send({ erro: "Movimento não encontrado." });
    }
    if (atual.fonte === "open_finance") {
      return resposta.status(403).send({
        erro: "Lançamentos do Open Finance não podem ser excluídos.",
      });
    }

    try {
      await motor.corrigir_fato_manual({
        movimentoId: id,
        alteradoPor: usuarioId,
        campos: { status: "cancelado" },
      });
      return { ok: true };
    } catch (erro) {
      const mensagem =
        erro instanceof Error ? erro.message : "Não foi possível excluir o lançamento.";
      return resposta.status(400).send({ erro: mensagem });
    }
  });
}
