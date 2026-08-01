import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { chat as chatTabela, obter_banco, sessao as sessaoTabela } from "@lancai/banco";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import {
  InterpretadorIntencoes,
  OrquestradorIA,
  RepositorioContextoDrizzle,
  ResolvedorIntencao,
} from "@lancai/ia";
import type { ContextoInterpretacao } from "@lancai/ia";
import { Memoria, RepositorioMemoriaDrizzle } from "@lancai/memoria";
import { montar_resposta_chat } from "../montar-resposta-chat";

const schemaRequisicaoChat = z.object({
  usuarioId: z.string().uuid(),
  mensagem: z.string().min(1),
  sessaoId: z.string().uuid().optional(),
});

const orquestrador = new OrquestradorIA();
const interpretador = new InterpretadorIntencoes(orquestrador);
const repositorioContexto = new RepositorioContextoDrizzle();
const resolvedor = new ResolvedorIntencao(repositorioContexto);
const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());
const memoria = new Memoria(new RepositorioMemoriaDrizzle());

async function obter_ou_criar_sessao(usuarioId: string, sessaoId?: string) {
  const banco = obter_banco();

  if (sessaoId) {
    const [existente] = await banco.select().from(sessaoTabela).where(eq(sessaoTabela.id, sessaoId)).limit(1);
    if (existente) return existente;
  }

  const [novaSessao] = await banco.insert(sessaoTabela).values({ usuarioId }).returning();
  if (!novaSessao) throw new Error("Falha ao criar sessão de chat.");
  return novaSessao;
}

async function montar_contexto(usuarioId: string): Promise<ContextoInterpretacao> {
  const [contas, cartoes, categorias, pessoas, habitos] = await Promise.all([
    repositorioContexto.listarContas(usuarioId),
    repositorioContexto.listarCartoes(usuarioId),
    repositorioContexto.listarCategorias(usuarioId),
    repositorioContexto.listarPessoas(usuarioId),
    memoria.buscar_habitos(usuarioId),
  ]);

  return {
    dataAtual: new Date().toISOString().slice(0, 10),
    contas: contas.map((conta) => ({ nome: conta.nome, perfil: conta.perfil })),
    cartoes: cartoes.map((cartao) => ({ nome: cartao.nome, perfil: cartao.perfil })),
    categorias: categorias.map((categoria) => ({ nome: categoria.nome, tipo: categoria.tipo })),
    pessoas: pessoas.map((pessoa) => ({ nome: pessoa.nome, tipo: pessoa.tipo })),
    habitos,
  };
}

/**
 * Fluxo completo do chat conversacional:
 * usuário -> OrquestradorIA -> InterpretadorIntencoes -> ResolvedorIntencao -> MotorFinanceiro.
 * Cada turno (mensagem do usuário, intenção da IA e resposta do sistema) fica
 * registrado em `chat`, vinculado a uma `sessao` (criada automaticamente se
 * `sessaoId` não for informado).
 */
export async function registrar_rotas_chat(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaRequisicaoChat.parse(requisicao.body);
    const banco = obter_banco();

    const sessaoAtual = await obter_ou_criar_sessao(dados.usuarioId, dados.sessaoId);

    await banco.insert(chatTabela).values({
      sessaoId: sessaoAtual.id,
      papel: "usuario",
      conteudo: dados.mensagem,
    });

    const contexto = await montar_contexto(dados.usuarioId);
    const intencao = await interpretador.interpretar_mensagem(dados.mensagem, contexto);

    await banco.insert(chatTabela).values({
      sessaoId: sessaoAtual.id,
      papel: "ia",
      conteudo: JSON.stringify(intencao),
      intencaoDetectada: intencao,
    });

    const respostaTexto = await montar_resposta_chat(intencao, {
      usuarioId: dados.usuarioId,
      criadoPor: dados.usuarioId,
      resolvedor,
      motor,
    });

    await banco.insert(chatTabela).values({
      sessaoId: sessaoAtual.id,
      papel: "sistema",
      conteudo: respostaTexto,
    });

    return resposta.send({ sessaoId: sessaoAtual.id, intencao, resposta: respostaTexto });
  });

  app.get("/:sessaoId/mensagens", async (requisicao) => {
    const { sessaoId } = requisicao.params as { sessaoId: string };
    const banco = obter_banco();
    return banco.select().from(chatTabela).where(eq(chatTabela.sessaoId, sessaoId)).orderBy(chatTabela.dataCriacao);
  });
}
