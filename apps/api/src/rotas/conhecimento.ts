import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ErroConhecimentoInvalido,
  ErroMovimentoNaoEncontrado,
  RepositorioConhecimentoDrizzle,
  ServicoConhecimento,
} from "@lancai/conhecimento";
import { perfilSchema } from "@lancai/tipos";

const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
const repositorio = new RepositorioConhecimentoDrizzle();

const schemaAtualizar = z.object({
  usuarioId: z.string().uuid(),
  movimentoId: z.string().uuid(),
  categoriaId: z.string().uuid().optional(),
  perfil: perfilSchema.optional(),
  ignoradoEmRelatorio: z.boolean().optional(),
}).refine(
  (dados) =>
    dados.categoriaId !== undefined ||
    dados.perfil !== undefined ||
    dados.ignoradoEmRelatorio !== undefined,
  { message: "Informe ao menos um campo de conhecimento." },
);

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
          ...(dados.perfil !== undefined ? { perfil: dados.perfil } : {}),
          ...(dados.ignoradoEmRelatorio !== undefined
            ? { ignoradoEmRelatorio: dados.ignoradoEmRelatorio }
            : {}),
          /**
           * Só marca como classificação manual quando a categoria muda.
           * Esconder do relatório ou só mexer no perfil não pode apagar
           * “classificado pela regra IFOOD”.
           */
          ...(dados.categoriaId !== undefined
            ? { classificadoPor: "usuario" as const, confiancaIa: null, regraId: null }
            : {}),
        },
      });

      const categoria = await repositorio.obterCategoria(atualizado.categoriaId);
      return {
        id: atualizado.id,
        descricao: atualizado.descricao,
        categoriaId: atualizado.categoriaId,
        categoriaNome: categoria?.nome ?? "Categoria",
        classificadoPor: atualizado.classificadoPor,
        regraId: atualizado.regraId,
        classificadoEm: atualizado.classificadoEm
          ? atualizado.classificadoEm.toISOString()
          : null,
        confiancaIa: atualizado.confiancaIa === null ? null : Number(atualizado.confiancaIa),
        perfil: atualizado.perfil,
        ignoradoEmRelatorio: atualizado.ignoradoEmRelatorio,
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
