import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { cartao, obter_banco } from "@lancai/banco";
import { calcularMelhorDiaCompra, schemaCriarCartao } from "@lancai/tipos";

/** Remove o payload cifrado das respostas públicas de listagem. */
function cartao_publico<T extends { dadosPlasticosCifrados?: string | null }>(linha: T) {
  const { dadosPlasticosCifrados: _omitido, ...publico } = linha;
  return publico;
}

export async function registrar_rotas_cartao(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarCartao.parse(requisicao.body);
    const banco = obter_banco();
    const [criado] = await banco
      .insert(cartao)
      .values({
        nome: dados.nome,
        limite: String(dados.limite),
        fechamento: dados.fechamento,
        vencimento: dados.vencimento,
        melhorDiaCompra: calcularMelhorDiaCompra(dados.fechamento),
        perfil: dados.perfil,
        contaId: dados.contaId,
        usuarioId: dados.usuarioId,
        final4: dados.final4,
        dadosPlasticosCifrados: dados.dadosPlasticosCifrados,
      })
      .returning();
    return resposta.status(201).send(cartao_publico(criado!));
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    const linhas = usuarioId
      ? await banco
          .select()
          .from(cartao)
          .where(and(eq(cartao.usuarioId, usuarioId), eq(cartao.ativo, true)))
      : await banco.select().from(cartao).where(eq(cartao.ativo, true));
    return linhas.map(cartao_publico);
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrado] = await banco.select().from(cartao).where(eq(cartao.id, id)).limit(1);
    if (!encontrado) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }
    return cartao_publico(encontrado);
  });
}
