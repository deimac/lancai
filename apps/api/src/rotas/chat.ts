import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { chat as chatTabela, obter_banco, sessao as sessaoTabela, usuario as usuarioTabela } from "@lancai/banco";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import {
  InterpretadorIntencoes,
  OrquestradorIA,
  RepositorioContextoDrizzle,
  ResolvedorIntencao,
  decifrar_dados_plasticos,
} from "@lancai/ia";
import type { ContextoInterpretacao, MensagemHistorico } from "@lancai/ia";
import { Memoria, RepositorioMemoriaDrizzle } from "@lancai/memoria";
import { ModuloRelatorios, RepositorioRelatoriosDrizzle } from "@lancai/relatorios";
import {
  extrair_pendencia_senha_cartao,
  mensagem_parece_senha,
  redigir_senha_no_historico,
} from "../interpretar-confirmacao-senha-cartao";
import { interpretar_resposta_confirmacao_exclusao } from "../interpretar-confirmacao-exclusao";
import { montar_dados_cartao_protegidos } from "../montar-dados-cartao";
import { montar_resposta_chat } from "../montar-resposta-chat";
import { eh_atalho_menu, montar_resposta_menu } from "../montar-resposta-menu";
import { verificar_senha_usuario } from "../verificar-senha-usuario";

const schemaRequisicaoChat = z.object({
  usuarioId: z.string().uuid(),
  mensagem: z.string().min(1),
  sessaoId: z.string().uuid().optional(),
});

/** Quantas mensagens (usuário + sistema) olhar para trás para o slot-filling entre turnos. */
const TAMANHO_HISTORICO_RECENTE = 8;

const orquestrador = new OrquestradorIA();
const interpretador = new InterpretadorIntencoes(orquestrador);
const repositorioContexto = new RepositorioContextoDrizzle();
const resolvedor = new ResolvedorIntencao(repositorioContexto);
const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());
const memoria = new Memoria(new RepositorioMemoriaDrizzle());
const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());

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

/**
 * Busca as últimas mensagens de "usuario"/"sistema" da sessão (descartando as
 * linhas de papel "ia", que guardam o JSON bruto da intenção — não é texto
 * conversacional útil para o histórico que a IA lê). Devolve em ordem
 * cronológica (mais antiga primeiro).
 */
async function buscar_historico_recente(sessaoId: string): Promise<MensagemHistorico[]> {
  const banco = obter_banco();
  const mensagens = await banco
    .select({ papel: chatTabela.papel, conteudo: chatTabela.conteudo })
    .from(chatTabela)
    .where(and(eq(chatTabela.sessaoId, sessaoId), inArray(chatTabela.papel, ["usuario", "sistema"])))
    .orderBy(desc(chatTabela.dataCriacao))
    .limit(TAMANHO_HISTORICO_RECENTE);

  return mensagens.reverse() as MensagemHistorico[];
}

async function montar_contexto(usuarioId: string, sessaoId: string): Promise<ContextoInterpretacao> {
  const [contas, cartoes, categorias, pessoas, habitos, historicoRecente] = await Promise.all([
    repositorioContexto.listarContas(usuarioId),
    repositorioContexto.listarCartoes(usuarioId),
    repositorioContexto.listarCategorias(usuarioId),
    repositorioContexto.listarPessoas(usuarioId),
    memoria.buscar_habitos(usuarioId),
    buscar_historico_recente(sessaoId),
  ]);

  return {
    dataAtual: new Date().toISOString().slice(0, 10),
    contas: contas.map((conta) => ({ nome: conta.nome, perfil: conta.perfil })),
    cartoes: cartoes.map((cartao) => ({ nome: cartao.nome, perfil: cartao.perfil })),
    categorias: categorias.map((categoria) => ({ nome: categoria.nome, tipo: categoria.tipo })),
    pessoas: pessoas.map((pessoa) => ({ nome: pessoa.nome, tipo: pessoa.tipo })),
    habitos,
    historicoRecente,
  };
}

async function responder_com_dados_cartao_apos_senha(entrada: {
  usuarioId: string;
  cartaoNome: string;
  senha: string;
}): Promise<{ intencao: { intencao: "CONSULTAR_DADOS_CARTAO"; cartao_nome: string }; resposta: string }> {
  const banco = obter_banco();
  const [usuario] = await banco.select().from(usuarioTabela).where(eq(usuarioTabela.id, entrada.usuarioId)).limit(1);
  if (!usuario) {
    return {
      intencao: { intencao: "CONSULTAR_DADOS_CARTAO", cartao_nome: entrada.cartaoNome },
      resposta: "Não encontrei seu usuário para validar a senha.",
    };
  }

  const senhaOk = await verificar_senha_usuario(usuario.email, entrada.senha);
  const intencao = { intencao: "CONSULTAR_DADOS_CARTAO" as const, cartao_nome: entrada.cartaoNome };

  if (!senhaOk) {
    return {
      intencao,
      resposta: "Senha incorreta. Tente de novo ou diga o nome do cartão outra vez.",
    };
  }

  const cartao = await repositorioContexto.buscarCartaoPorNome(entrada.usuarioId, entrada.cartaoNome);
  if (!cartao) {
    return { intencao, resposta: `Não encontrei o cartão "${entrada.cartaoNome}".` };
  }
  if (!cartao.dadosPlasticosCifrados) {
    return {
      intencao,
      resposta: `O cartão "${cartao.nome}" não tem número/validade/CVV salvos. Você pode me passar esses dados para eu guardar.`,
    };
  }

  const plasticos = decifrar_dados_plasticos(cartao.dadosPlasticosCifrados);
  return { intencao, resposta: montar_dados_cartao_protegidos(cartao, plasticos) };
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

    // Contexto (incluindo historicoRecente) é montado ANTES de inserir a mensagem
    // atual — senão ela apareceria duplicada (uma vez no histórico, outra como
    // "mensagem atual") no prompt do InterpretadorIntencoes.
    const contexto = await montar_contexto(dados.usuarioId, sessaoAtual.id);

    // Atalho de senha: redige a mensagem ANTES de gravar e NÃO passa pela IA.
    const cartaoPendenteSenha = extrair_pendencia_senha_cartao(contexto.historicoRecente);
    if (cartaoPendenteSenha && mensagem_parece_senha(dados.mensagem)) {
      await banco.insert(chatTabela).values({
        sessaoId: sessaoAtual.id,
        papel: "usuario",
        conteudo: redigir_senha_no_historico(),
      });

      const resultado = await responder_com_dados_cartao_apos_senha({
        usuarioId: dados.usuarioId,
        cartaoNome: cartaoPendenteSenha,
        senha: dados.mensagem.trim(),
      });

      await banco.insert(chatTabela).values({
        sessaoId: sessaoAtual.id,
        papel: "ia",
        conteudo: JSON.stringify(resultado.intencao),
        intencaoDetectada: resultado.intencao,
      });
      await banco.insert(chatTabela).values({
        sessaoId: sessaoAtual.id,
        papel: "sistema",
        conteudo: resultado.resposta,
      });

      return resposta.send({
        sessaoId: sessaoAtual.id,
        intencao: resultado.intencao,
        resposta: resultado.resposta,
      });
    }

    await banco.insert(chatTabela).values({
      sessaoId: sessaoAtual.id,
      papel: "usuario",
      conteudo: dados.mensagem,
    });

    // Atalho determinístico: "menu"/"ajuda" nunca passa pela IA (sem custo,
    // sem depender de nenhum provedor estar disponível).
    if (eh_atalho_menu(dados.mensagem)) {
      const intencaoMenu = { intencao: "MENU" as const };
      const respostaTexto = montar_resposta_menu({
        totalContas: contexto.contas.length,
        totalCartoes: contexto.cartoes.length,
      });

      await banco.insert(chatTabela).values({
        sessaoId: sessaoAtual.id,
        papel: "sistema",
        conteudo: respostaTexto,
      });

      return resposta.send({ sessaoId: sessaoAtual.id, intencao: intencaoMenu, resposta: respostaTexto });
    }

    // Atalho: resposta "sim"/"não" após o sistema pedir confirmação de exclusão.
    const intencaoConfirmacao = interpretar_resposta_confirmacao_exclusao(
      dados.mensagem,
      contexto.historicoRecente,
    );

    const intencao =
      intencaoConfirmacao ??
      (await interpretador.interpretar_mensagem(dados.mensagem, contexto));

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
      relatorios,
      dataAtual: contexto.dataAtual,
      totalContas: contexto.contas.length,
      totalCartoes: contexto.cartoes.length,
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
