import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alocacaoFatura, cartao, movimento, obter_banco } from "@lancai/banco";
import { ErroValidacaoFinanceira, MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { z } from "zod";
import { obter_escopo_leitura } from "../servicos/escopo-workspace";

const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());

const schemaUsuario = z.object({ usuarioId: z.string().uuid() });
const schemaResolverConflito = z.object({
    usuarioId: z.string().uuid(),
    competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência deve estar no formato YYYY-MM."),
});

export async function registrar_rotas_faturas(app: FastifyInstance) {
    app.get("/alocacoes-conflitos", async (requisicao, resposta) => {
        const { usuarioId } = schemaUsuario.parse(requisicao.query);
        const workspaceIds = (await obter_escopo_leitura(usuarioId)).workspaceIds;
        if (workspaceIds.length === 0) return [];

        return obter_banco()
            .select({
                alocacaoId: alocacaoFatura.id,
                movimentoId: movimento.id,
                descricao: movimento.descricao,
                valor: movimento.valor,
                dataMovimento: movimento.dataMovimento,
                providerBillId: movimento.providerBillId,
                competencia: alocacaoFatura.competencia,
                status: alocacaoFatura.status,
                metodo: alocacaoFatura.metodo,
                conflitoMotivo: alocacaoFatura.conflitoMotivo,
                conflitoDadosOrigem: alocacaoFatura.conflitoDadosOrigem,
                cartaoId: cartao.id,
                cartaoNome: cartao.nome,
            })
            .from(alocacaoFatura)
            .innerJoin(movimento, eq(alocacaoFatura.movimentoId, movimento.id))
            .innerJoin(cartao, eq(alocacaoFatura.cartaoId, cartao.id))
            .where(
                and(
                    eq(alocacaoFatura.isCurrent, true),
                    eq(alocacaoFatura.estadoConflito, "conflito"),
                    eq(movimento.usuarioId, usuarioId),
                    inArray(alocacaoFatura.workspaceId, workspaceIds),
                ),
            )
            .orderBy(desc(alocacaoFatura.dataCriacao));
    });

    app.post("/alocacoes/:movimentoId/resolver", async (requisicao, resposta) => {
        const { movimentoId } = requisicao.params as { movimentoId: string };
        const dados = schemaResolverConflito.parse(requisicao.body);
        const workspaceIds = (await obter_escopo_leitura(dados.usuarioId)).workspaceIds;
        if (workspaceIds.length === 0) {
            return resposta.status(404).send({ erro: "Movimento não encontrado." });
        }

        const [movimentoAlvo] = await obter_banco()
            .select({ id: movimento.id, usuarioId: movimento.usuarioId, workspaceId: movimento.workspaceId })
            .from(movimento)
            .where(
                and(
                    eq(movimento.id, movimentoId),
                    eq(movimento.usuarioId, dados.usuarioId),
                    inArray(movimento.workspaceId, workspaceIds),
                ),
            )
            .limit(1);

        if (!movimentoAlvo) {
            return resposta.status(404).send({ erro: "Movimento não encontrado." });
        }

        try {
            await motor.resolver_alocacao_fatura_manual({
                movimentoId,
                competencia: dados.competencia,
                usuarioId: dados.usuarioId,
            });
        } catch (erro) {
            if (erro instanceof ErroValidacaoFinanceira) {
                return resposta.status(400).send({ erro: erro.message });
            }
            throw erro;
        }

        return resposta.send({ ok: true, movimentoId, competencia: dados.competencia });
    });
}