import { and, desc, eq, inArray } from "drizzle-orm";
import {
  chat as chatTabela,
  garantir_workspace_do_usuario,
  obter_banco,
  sessao as sessaoTabela,
  usuario as usuarioTabela,
} from "@lancai/banco";
import {
  Memoria,
  RepositorioConhecimentoDrizzle,
  RepositorioMemoriaDrizzle,
  ServicoConhecimento,
} from "@lancai/conhecimento";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import {
  ClassificadorCategoria,
  InterpretadorIntencoes,
  OrquestradorIA,
  RepositorioContextoDrizzle,
  ResolvedorIntencao,
  decifrar_dados_plasticos,
  garantir_categorias_padrao,
  aplicar_escopo_fluxo_na_consulta,
  interpretar_consulta_rapida,
  interpretar_correcao_rapida,
  interpretar_enriquecimento_rapido,
  interpretar_lancamento_rapido,
  interpretar_pedido_detalhe_historico,
  interpretar_pedido_mais_historico,
  interpretar_pedido_periodo_followup,
  normalizar_intencao_cadastro,
  normalizar_intencao_consulta,
  normalizar_intencao_movimento,
  normalizar_intencao_plasticos,
  normalizar_intencao_recorrencia,
} from "@lancai/ia";
import type { ContextoInterpretacao, MensagemHistorico } from "@lancai/ia";
import { ModuloRelatorios, RepositorioRelatoriosDrizzle } from "@lancai/relatorios";
import { hojeISO, type IntencaoDetectada, type TipoFonte } from "@lancai/tipos";
import {
  extrair_pendencia_senha_cartao,
  mensagem_parece_senha,
  redigir_senha_no_historico,
} from "../interpretar-confirmacao-senha-cartao";
import { interpretar_resposta_confirmacao_duplicata } from "../interpretar-confirmacao-duplicata";
import { interpretar_resposta_confirmacao_exclusao } from "../interpretar-confirmacao-exclusao";
import { interpretar_resposta_confirmacao_regra } from "../interpretar-confirmacao-regra";
import { montar_dados_cartao_protegidos } from "../montar-dados-cartao";
import { montar_resposta_chat } from "../montar-resposta-chat";
import { eh_atalho_menu, montar_resposta_menu } from "../montar-resposta-menu";
import { verificar_senha_usuario } from "../verificar-senha-usuario";
import {
  interpretar_orcamento_rapido,
  interpretar_recorrencia_rapida,
} from "./interpretar-orcamento-recorrencia-rapido";
import { mensagem_erro_para_usuario } from "./mensagem-erro-usuario";

/** Quantas mensagens (usuário + sistema) olhar para trás para o slot-filling entre turnos. */
const TAMANHO_HISTORICO_RECENTE = 8;

const orquestrador = new OrquestradorIA();
const interpretador = new InterpretadorIntencoes(orquestrador);

/** Esqueleto para slot-filling de recorrência — o normalizador completa com a mensagem. */
function esqueleto_slot_recorrencia(
  parciais: Record<string, unknown> | null | undefined,
): IntencaoDetectada {
  const p = parciais ?? {};
  return {
    intencao: "CRIAR_RECORRENCIA",
    descricao: typeof p.descricao === "string" && p.descricao.trim() ? p.descricao : "Recorrência",
    valor: typeof p.valor === "number" ? p.valor : null,
    dia_do_mes: typeof p.dia_do_mes === "number" ? p.dia_do_mes : null,
    tipo_movimento: p.tipo_movimento === "receita" ? "receita" : "despesa",
    categoria_nome: typeof p.categoria_nome === "string" ? p.categoria_nome : null,
    conta_nome: typeof p.conta_nome === "string" ? p.conta_nome : null,
    cartao_nome: typeof p.cartao_nome === "string" ? p.cartao_nome : null,
  };
}
const repositorioContexto = new RepositorioContextoDrizzle();
const resolvedor = new ResolvedorIntencao(repositorioContexto);
const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());
const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
const memoria = new Memoria(new RepositorioMemoriaDrizzle());
const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());
const sugeridorCategoria = new ClassificadorCategoria(orquestrador);

export type EntradaTurnoConversa = {
  usuarioId: string;
  mensagem: string;
  sessaoId?: string;
  /** WhatsApp: reutiliza sessão ativa. Web (default): cria nova se não houver sessaoId. */
  reutilizarSessaoAtiva?: boolean;
  /** Vision/comprovante: intenção já extraída (pula atalho/LLM). */
  intencaoPrevia?: IntencaoDetectada;
  /**
   * Canal de origem, que vira a `fonte` dos lançamentos criados no turno.
   * Declarado explicitamente pelo chamador em vez de deduzido de
   * `reutilizarSessaoAtiva`, que é detalhe de sessão e não de procedência.
   */
  fonte?: TipoFonte;
};

export type ResultadoTurnoConversa = {
  sessaoId: string;
  intencao: IntencaoDetectada;
  resposta: string;
};

async function obter_ou_criar_sessao(
  usuarioId: string,
  sessaoId?: string,
  reutilizarSessaoAtiva = false,
) {
  const banco = obter_banco();

  if (sessaoId) {
    const [existente] = await banco.select().from(sessaoTabela).where(eq(sessaoTabela.id, sessaoId)).limit(1);
    if (existente) return existente;
  }

  if (reutilizarSessaoAtiva) {
    const [ativa] = await banco
      .select()
      .from(sessaoTabela)
      .where(and(eq(sessaoTabela.usuarioId, usuarioId), eq(sessaoTabela.status, "ativa")))
      .orderBy(desc(sessaoTabela.dataAtualizacao))
      .limit(1);
    if (ativa) return ativa;
  }

  const [novaSessao] = await banco.insert(sessaoTabela).values({ usuarioId }).returning();
  if (!novaSessao) throw new Error("Falha ao criar sessão de chat.");
  return novaSessao;
}

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

async function buscar_intencao_pendente(
  sessaoId: string,
): Promise<ContextoInterpretacao["intencaoPendente"]> {
  const banco = obter_banco();
  const [ultimaIa] = await banco
    .select({ intencaoDetectada: chatTabela.intencaoDetectada })
    .from(chatTabela)
    .where(and(eq(chatTabela.sessaoId, sessaoId), eq(chatTabela.papel, "ia")))
    .orderBy(desc(chatTabela.dataCriacao))
    .limit(1);

  const bruta = ultimaIa?.intencaoDetectada;
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return null;

  const intencao = bruta as Record<string, unknown>;
  if (intencao.intencao === "SOLICITAR_INFORMACAO") {
    const pendente = intencao.intencao_pendente;
    if (
      pendente !== "CRIAR_CONTA" &&
      pendente !== "CRIAR_CARTAO" &&
      pendente !== "REGISTRAR_MOVIMENTO" &&
      pendente !== "CRIAR_RECORRENCIA"
    ) {
      return null;
    }
    return {
      intencao_pendente: pendente,
      dados_parciais:
        intencao.dados_parciais && typeof intencao.dados_parciais === "object"
          ? (intencao.dados_parciais as Record<string, unknown>)
          : null,
    };
  }

  if (intencao.intencao === "CRIAR_CARTAO") {
    const incompleto =
      !intencao.nome ||
      intencao.limite == null ||
      intencao.fechamento == null ||
      intencao.vencimento == null ||
      !intencao.perfil;
    if (!incompleto) return null;
    const { intencao: _ignorar, ...campos } = intencao;
    return { intencao_pendente: "CRIAR_CARTAO", dados_parciais: campos };
  }

  if (intencao.intencao === "CRIAR_CONTA") {
    const incompleto = !intencao.nome || intencao.saldo_inicial == null || !intencao.perfil;
    if (!incompleto) return null;
    const { intencao: _ignorar, ...campos } = intencao;
    return { intencao_pendente: "CRIAR_CONTA", dados_parciais: campos };
  }

  return null;
}

async function buscar_ultima_intencao_ia(sessaoId: string): Promise<IntencaoDetectada | null> {
  const banco = obter_banco();
  const [ultimaIa] = await banco
    .select({ intencaoDetectada: chatTabela.intencaoDetectada })
    .from(chatTabela)
    .where(and(eq(chatTabela.sessaoId, sessaoId), eq(chatTabela.papel, "ia")))
    .orderBy(desc(chatTabela.dataCriacao))
    .limit(1);

  const bruta = ultimaIa?.intencaoDetectada;
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return null;
  return bruta as IntencaoDetectada;
}

async function montar_contexto(usuarioId: string, sessaoId: string): Promise<ContextoInterpretacao> {
  const categorias = await garantir_categorias_padrao(usuarioId, repositorioContexto);

  const [contas, cartoes, pessoas, habitos, historicoRecente, intencaoPendente, usuario] =
    await Promise.all([
      repositorioContexto.listarContas(usuarioId),
      repositorioContexto.listarCartoes(usuarioId),
      repositorioContexto.listarPessoas(usuarioId),
      memoria.buscar_habitos(usuarioId),
      buscar_historico_recente(sessaoId),
      buscar_intencao_pendente(sessaoId),
      banco_usuario_nome(usuarioId),
    ]);

  return {
    dataAtual: hojeISO(),
    contas: contas.map((conta) => ({ nome: conta.nome, perfil: conta.perfil })),
    cartoes: cartoes.map((cartao) => ({
      nome: cartao.nome,
      perfil: cartao.perfil,
      modalidade: cartao.modalidade,
      temConta: Boolean(cartao.contaId),
    })),
    categorias: categorias.map((categoria) => ({ nome: categoria.nome, tipo: categoria.tipo })),
    pessoas: pessoas.map((pessoa) => ({ nome: pessoa.nome, tipo: pessoa.tipo })),
    habitos,
    historicoRecente,
    intencaoPendente,
    nomeUsuario: usuario,
  };
}

async function banco_usuario_nome(usuarioId: string): Promise<string | null> {
  const banco = obter_banco();
  const [linha] = await banco
    .select({ nome: usuarioTabela.nome })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.id, usuarioId))
    .limit(1);
  return linha?.nome ?? null;
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
 * Turno conversacional compartilhado (web + WhatsApp):
 * contexto → atalhos → InterpretadorIntencoes → montar_resposta_chat → persistência.
 */
export async function processar_turno_conversa(
  entrada: EntradaTurnoConversa,
): Promise<ResultadoTurnoConversa> {
  const banco = obter_banco();
  const sessaoAtual = await obter_ou_criar_sessao(
    entrada.usuarioId,
    entrada.sessaoId,
    entrada.reutilizarSessaoAtiva === true,
  );

  // Contexto montado ANTES de gravar a mensagem atual (evita duplicar no histórico).
  const contexto = await montar_contexto(entrada.usuarioId, sessaoAtual.id);

  const cartaoPendenteSenha = extrair_pendencia_senha_cartao(contexto.historicoRecente);
  if (cartaoPendenteSenha && mensagem_parece_senha(entrada.mensagem)) {
    await banco.insert(chatTabela).values({
      sessaoId: sessaoAtual.id,
      papel: "usuario",
      conteudo: redigir_senha_no_historico(),
    });

    const resultado = await responder_com_dados_cartao_apos_senha({
      usuarioId: entrada.usuarioId,
      cartaoNome: cartaoPendenteSenha,
      senha: entrada.mensagem.trim(),
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

    return {
      sessaoId: sessaoAtual.id,
      intencao: resultado.intencao,
      resposta: resultado.resposta,
    };
  }

  await banco.insert(chatTabela).values({
    sessaoId: sessaoAtual.id,
    papel: "usuario",
    conteudo: entrada.mensagem,
  });

  if (eh_atalho_menu(entrada.mensagem)) {
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

    return { sessaoId: sessaoAtual.id, intencao: intencaoMenu, resposta: respostaTexto };
  }

  const ultimaIntencaoIa = await buscar_ultima_intencao_ia(sessaoAtual.id);
  const intencaoConfirmacao =
    interpretar_resposta_confirmacao_regra(
      entrada.mensagem,
      contexto.historicoRecente,
      ultimaIntencaoIa,
    ) ??
    interpretar_resposta_confirmacao_exclusao(
      entrada.mensagem,
      contexto.historicoRecente,
      ultimaIntencaoIa,
    ) ??
    interpretar_resposta_confirmacao_duplicata(
      entrada.mensagem,
      contexto.historicoRecente,
      ultimaIntencaoIa,
    );

  // Slot de recorrência: nunca manda pro LLM — mescla parciais + mensagem no normalizador.
  const slotRecorrencia =
    contexto.intencaoPendente?.intencao_pendente === "CRIAR_RECORRENCIA"
      ? esqueleto_slot_recorrencia(contexto.intencaoPendente.dados_parciais)
      : null;

  const intencaoBruta =
    slotRecorrencia ??
    entrada.intencaoPrevia ??
    intencaoConfirmacao ??
    interpretar_pedido_detalhe_historico(entrada.mensagem, ultimaIntencaoIa) ??
    interpretar_pedido_mais_historico(entrada.mensagem, ultimaIntencaoIa) ??
    interpretar_pedido_periodo_followup(entrada.mensagem, ultimaIntencaoIa, contexto.dataAtual) ??
    interpretar_orcamento_rapido(entrada.mensagem) ??
    interpretar_recorrencia_rapida(entrada.mensagem, contexto) ??
    interpretar_enriquecimento_rapido(entrada.mensagem, contexto.dataAtual) ??
    interpretar_correcao_rapida(entrada.mensagem, contexto.dataAtual) ??
    interpretar_consulta_rapida(entrada.mensagem, contexto) ??
    interpretar_lancamento_rapido(entrada.mensagem, contexto);

  const viaAtalho = Boolean(intencaoBruta);
  if (viaAtalho) {
    console.info(
      `[ia] turno atalho=true llm=false intencao=${intencaoBruta!.intencao}${entrada.intencaoPrevia ? " (midia)" : ""} (0 créditos LLM intenção)`,
    );
  }

  let intencao =
    intencaoBruta ?? (await interpretador.interpretar_mensagem(entrada.mensagem, contexto));

  // Vision/atalhos também passam pelos normalizadores (conta/data/slot-filling).
  if (intencaoBruta) {
    intencao = normalizar_intencao_consulta(
      normalizar_intencao_plasticos(
        normalizar_intencao_recorrencia(
          normalizar_intencao_cadastro(
            normalizar_intencao_movimento(intencao, contexto, entrada.mensagem),
            contexto,
            entrada.mensagem,
          ),
          contexto,
          entrada.mensagem,
        ),
        entrada.mensagem,
      ),
      contexto,
      entrada.mensagem,
    );
  }

  // "quanto gastei" ≠ extrato: força tipos despesa/receita por sinônimos da mensagem.
  if (intencao.intencao === "CONSULTAR_VISAO") {
    intencao = aplicar_escopo_fluxo_na_consulta(intencao, entrada.mensagem);
  }

  if (!viaAtalho) {
    console.info(`[ia] turno atalho=false llm=true intencao=${intencao.intencao}`);
  }
  await banco.insert(chatTabela).values({
    sessaoId: sessaoAtual.id,
    papel: "ia",
    conteudo: JSON.stringify(intencao),
    intencaoDetectada: intencao,
  });

  let respostaTexto: string;
  try {
    respostaTexto = await montar_resposta_chat(intencao, {
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.usuarioId,
      workspaceId: await garantir_workspace_do_usuario(obter_banco(), entrada.usuarioId),
      fonte: entrada.fonte ?? "manual",
      resolvedor,
      motor,
      conhecimento,
      sugeridorCategoria,
      relatorios,
      memoria,
      dataAtual: contexto.dataAtual,
      totalContas: contexto.contas.length,
      totalCartoes: contexto.cartoes.length,
      mensagem: entrada.mensagem,
    });
  } catch (erro) {
    const amigavel = mensagem_erro_para_usuario(erro);
    if (!amigavel) throw erro;
    console.warn(
      `[turno] erro de domínio convertido em resposta: ${amigavel.slice(0, 160)}`,
    );
    respostaTexto = amigavel;
  }

  const intencaoResposta =
    intencao.intencao === "REGISTRAR_MOVIMENTO" &&
    intencao.confirmado !== true &&
    respostaTexto.startsWith("Já existe um lançamento igual:")
      ? { ...intencao, confirmado: false as const }
      : intencao;

  await banco.insert(chatTabela).values({
    sessaoId: sessaoAtual.id,
    papel: "sistema",
    conteudo: respostaTexto,
  });

  // Mantém a sessão "fresca" para o próximo turno WhatsApp.
  await banco
    .update(sessaoTabela)
    .set({ dataAtualizacao: new Date() })
    .where(eq(sessaoTabela.id, sessaoAtual.id));

  return {
    sessaoId: sessaoAtual.id,
    intencao: intencaoResposta,
    resposta: respostaTexto,
  };
}
