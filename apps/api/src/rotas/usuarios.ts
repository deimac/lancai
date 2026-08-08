import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { obter_banco, usuario } from "@lancai/banco";
import {
  schemaAtualizarUsuario,
  schemaCriarUsuario,
  schemaSincronizarUsuario,
} from "@lancai/tipos";

export async function registrar_rotas_usuario(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarUsuario.parse(requisicao.body);
    const banco = obter_banco();
    const [criado] = await banco.insert(usuario).values(dados).returning();
    return resposta.status(201).send(criado);
  });

  /**
   * Idempotente: chamado pelo apps/web logo após o login/cadastro no Supabase
   * Auth. Se já existe um `usuario` com esse id, apenas devolve; senão, cria.
   */
  app.post("/sincronizar", async (requisicao, resposta) => {
    const dados = schemaSincronizarUsuario.parse(requisicao.body);
    const banco = obter_banco();

    const [existente] = await banco.select().from(usuario).where(eq(usuario.id, dados.id)).limit(1);
    if (existente) return existente;

    const [criado] = await banco.insert(usuario).values(dados).returning();
    return resposta.status(201).send(criado);
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrado] = await banco.select().from(usuario).where(eq(usuario.id, id)).limit(1);
    if (!encontrado) {
      return resposta.status(404).send({ erro: "Usuário não encontrado." });
    }
    return encontrado;
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaAtualizarUsuario.parse(requisicao.body);
    if (
      dados.nome === undefined &&
      dados.whatsappNumero === undefined &&
      dados.posicaoPainel === undefined
    ) {
      return resposta.status(400).send({ erro: "Nada para atualizar." });
    }

    const banco = obter_banco();
    const [existente] = await banco.select().from(usuario).where(eq(usuario.id, id)).limit(1);
    if (!existente) {
      return resposta.status(404).send({ erro: "Usuário não encontrado." });
    }

    if (dados.whatsappNumero) {
      const [outro] = await banco
        .select({ id: usuario.id })
        .from(usuario)
        .where(eq(usuario.whatsappNumero, dados.whatsappNumero))
        .limit(1);
      if (outro && outro.id !== id) {
        return resposta.status(409).send({
          erro: "Este WhatsApp já está vinculado a outra conta.",
        });
      }
    }

    const [atualizado] = await banco
      .update(usuario)
      .set({
        ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
        ...(dados.whatsappNumero !== undefined
          ? { whatsappNumero: dados.whatsappNumero }
          : {}),
        ...(dados.posicaoPainel !== undefined
          ? { posicaoPainel: dados.posicaoPainel }
          : {}),
        dataAtualizacao: new Date(),
      })
      .where(eq(usuario.id, id))
      .returning();

    return atualizado;
  });
}
