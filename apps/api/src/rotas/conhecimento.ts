import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ErroConhecimentoInvalido,
  ErroMovimentoNaoEncontrado,
  RepositorioConhecimentoDrizzle,
  ServicoConhecimento,
} from "@lancai/conhecimento";
import { papelConhecimentoSchema, perfilSchema } from "@lancai/tipos";

const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
const repositorio = new RepositorioConhecimentoDrizzle();

const competenciaFaturaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Competência deve estar no formato YYYY-MM");

const schemaAtualizar = z
  .object({
    usuarioId: z.string().uuid(),
    movimentoId: z.string().uuid(),
    categoriaId: z.string().uuid().optional(),
    tipoGasto: perfilSchema.optional(),
    ignoradoEmRelatorio: z.boolean().optional(),
    papel: papelConhecimentoSchema.optional(),
    cartaoFaturaId: z.string().uuid().nullable().optional(),
    competenciaFatura: competenciaFaturaSchema.nullable().optional(),
  })
  .refine(
    (dados) =>
      dados.categoriaId !== undefined ||
      dados.tipoGasto !== undefined ||
      dados.ignoradoEmRelatorio !== undefined ||
      dados.papel !== undefined ||
      dados.cartaoFaturaId !== undefined ||
      dados.competenciaFatura !== undefined,
    { message: "Informe ao menos um campo de conhecimento." },
  );

const schemaVirarRegra = z.object({
  usuarioId: z.string().uuid(),
  movimentoId: z.string().uuid(),
});

async function serializar_conhecimento(atualizado: {
  id: string;
  descricao: string;
  categoriaId: string;
  classificadoPor: "regra" | "ia" | "usuario";
  regraId: string | null;
  classificadoEm: Date | null;
  confiancaIa: string | null;
  tipoGasto: "pf" | "pj";
  ignoradoEmRelatorio: boolean;
  papel: "gasto" | "pagamento_fatura";
  cartaoFaturaId: string | null;
  competenciaFatura: string | null;
}) {
  const categoria = await repositorio.obterCategoria(atualizado.categoriaId);
  const proposta =
    atualizado.papel === "pagamento_fatura"
      ? await conhecimento.propor_regra_de_movimento(atualizado.id)
      : null;
  return {
    id: atualizado.id,
    descricao: atualizado.descricao,
    categoriaId: atualizado.categoriaId,
    categoriaNome: categoria?.nome ?? "Categoria",
    classificadoPor: atualizado.classificadoPor,
    regraId: atualizado.regraId,
    classificadoEm: atualizado.classificadoEm ? atualizado.classificadoEm.toISOString() : null,
    confiancaIa: atualizado.confiancaIa === null ? null : Number(atualizado.confiancaIa),
    tipoGasto: atualizado.tipoGasto,
    ignoradoEmRelatorio: atualizado.ignoradoEmRelatorio,
    papel: atualizado.papel,
    cartaoFaturaId: atualizado.cartaoFaturaId,
    competenciaFatura: atualizado.competenciaFatura,
    propostaRegra: proposta
      ? { trecho: proposta.trecho, categoriaNome: proposta.categoriaNome }
      : null,
  };
}

/**
 * Escrita explícita de Conhecimento (ADR-009): nunca aceita valor, data ou conta.
 */
export async function registrar_rotas_conhecimento(app: FastifyInstance) {
  app.patch("/", async (requisicao, resposta) => {
    const dados = schemaAtualizar.parse(requisicao.body);
    const movimento = await repositorio.obterMovimento(dados.movimentoId);

    if (!movimento || movimento.usuarioId !== dados.usuarioId) {
      return resposta.status(404).send({ erro: "Movimento não encontrado." });
    }

    try {
      const atualizado = await conhecimento.atualizar({
        movimentoId: dados.movimentoId,
        alteradoPor: dados.usuarioId,
        conhecimento: {
          ...(dados.categoriaId !== undefined ? { categoriaId: dados.categoriaId } : {}),
          ...(dados.tipoGasto !== undefined ? { tipoGasto: dados.tipoGasto } : {}),
          ...(dados.ignoradoEmRelatorio !== undefined
            ? { ignoradoEmRelatorio: dados.ignoradoEmRelatorio }
            : {}),
          ...(dados.papel !== undefined ? { papel: dados.papel } : {}),
          ...(dados.cartaoFaturaId !== undefined ? { cartaoFaturaId: dados.cartaoFaturaId } : {}),
          ...(dados.competenciaFatura !== undefined
            ? { competenciaFatura: dados.competenciaFatura }
            : {}),
          /**
           * Só marca como classificação manual quando a categoria ou o papel mudam.
           * Esconder do relatório ou só mexer no tipo de gasto não pode apagar
           * “classificado pela regra IFOOD”.
           */
          ...(dados.categoriaId !== undefined || dados.papel !== undefined
            ? { classificadoPor: "usuario" as const, confiancaIa: null, regraId: null }
            : {}),
        },
      });

      let parcelasAtualizadas = 0;
      if (dados.categoriaId !== undefined || dados.tipoGasto !== undefined) {
        parcelasAtualizadas = await conhecimento.propagar_classificacao_da_serie(atualizado.id);
      }

      return { ...(await serializar_conhecimento(atualizado)), parcelasAtualizadas };
    } catch (erro) {
      if (erro instanceof ErroMovimentoNaoEncontrado) {
        return resposta.status(404).send({ erro: erro.message });
      }
      if (erro instanceof ErroConhecimentoInvalido) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  app.post("/virar-regra", async (requisicao, resposta) => {
    const dados = schemaVirarRegra.parse(requisicao.body);
    const movimento = await repositorio.obterMovimento(dados.movimentoId);
    if (!movimento || movimento.usuarioId !== dados.usuarioId) {
      return resposta.status(404).send({ erro: "Movimento não encontrado." });
    }

    try {
      const resultado = await conhecimento.criar_regra_a_partir_de_correcao(dados.movimentoId);
      if (!resultado.criada) {
        return {
          criada: false,
          motivo: resultado.motivo,
          proposta: resultado.proposta
            ? { trecho: resultado.proposta.trecho, categoriaNome: resultado.proposta.categoriaNome }
            : null,
        };
      }
      return {
        criada: true,
        motivo: null,
        proposta: {
          trecho: resultado.proposta.trecho,
          categoriaNome: resultado.proposta.categoriaNome,
        },
      };
    } catch (erro) {
      if (erro instanceof ErroMovimentoNaoEncontrado) {
        return resposta.status(404).send({ erro: erro.message });
      }
      if (erro instanceof ErroConhecimentoInvalido) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });
}
