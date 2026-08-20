import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { categoria, eh_categoria_sistema, obter_banco } from "@lancai/banco";
import { garantir_categorias_padrao, RepositorioContextoDrizzle } from "@lancai/ia";
import { schemaAtualizarCategoria, schemaCriarCategoria } from "@lancai/tipos";
import { definir_limite_categoria } from "../servicos/orcamento-servico";
import { montar_categorias_ui } from "../servicos/listar-categorias-ui";

export async function registrar_rotas_categoria(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarCategoria.parse(requisicao.body);
    if (eh_categoria_sistema(dados.nome)) {
      return resposta.status(400).send({
        erro: `"${dados.nome}" é reservada pelo sistema — escolha outro nome.`,
      });
    }
    const banco = obter_banco();
    const [criada] = await banco
      .insert(categoria)
      .values({
        usuarioId: dados.usuarioId,
        nome: dados.nome.trim(),
        tipo: dados.tipo,
        icone: dados.icone ?? "geral",
        cor: dados.cor ?? "neutro",
      })
      .returning();
    if (!criada) {
      return resposta.status(500).send({ erro: "Não foi possível criar a categoria." });
    }
    if (dados.limite != null) {
      await definir_limite_categoria({
        usuarioId: dados.usuarioId,
        categoriaId: criada.id,
        valorLimite: dados.limite,
      });
    }
    const [enriquecida] = (await montar_categorias_ui(dados.usuarioId)).filter(
      (item) => item.id === criada.id,
    );
    return resposta.status(201).send(enriquecida ?? criada);
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaAtualizarCategoria.parse(requisicao.body);
    const banco = obter_banco();
    const [atual] = await banco
      .select()
      .from(categoria)
      .where(and(eq(categoria.id, id), eq(categoria.usuarioId, dados.usuarioId)))
      .limit(1);
    if (!atual) {
      return resposta.status(404).send({ erro: "Categoria não encontrada." });
    }
    if (eh_categoria_sistema(atual.nome) && (dados.nome || dados.tipo)) {
      return resposta.status(400).send({ erro: "Categorias do sistema não podem ser renomeadas." });
    }
    if (dados.nome && eh_categoria_sistema(dados.nome) && dados.nome !== atual.nome) {
      return resposta.status(400).send({ erro: "Esse nome é reservado pelo sistema." });
    }

    const campos: Partial<typeof atual> = { dataAtualizacao: new Date() };
    if (dados.nome) campos.nome = dados.nome.trim();
    if (dados.tipo) campos.tipo = dados.tipo;
    if (dados.icone) campos.icone = dados.icone;
    if (dados.cor) campos.cor = dados.cor;

    await banco.update(categoria).set(campos).where(eq(categoria.id, id));
    if (dados.limite !== undefined) {
      await definir_limite_categoria({
        usuarioId: dados.usuarioId,
        categoriaId: id,
        valorLimite: dados.limite,
      });
    }
    const [enriquecida] = (await montar_categorias_ui(dados.usuarioId)).filter((item) => item.id === id);
    return enriquecida ?? { ...atual, ...campos };
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    if (!usuarioId) {
      return obter_banco().select().from(categoria);
    }
    await garantir_categorias_padrao(usuarioId, new RepositorioContextoDrizzle());
    return montar_categorias_ui(usuarioId);
  });
}
