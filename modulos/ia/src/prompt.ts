import { inferir_perfil_padrao } from "./inferir-perfil-padrao";

export interface MensagemHistorico {
  papel: "usuario" | "sistema";
  conteudo: string;
}

/**
 * Última intenção de cadastro ainda incompleta (SOLICITAR_INFORMACAO ou
 * CRIAR_* parcial), lida da linha de papel "ia" da sessão. Complementa o
 * histórico textual para o slot-filling não perder campos já extraídos
 * (ex.: limite informado no turno anterior).
 */
export interface IntencaoPendenteSlot {
  intencao_pendente:
    | "CRIAR_CONTA"
    | "CRIAR_CARTAO"
    | "REGISTRAR_MOVIMENTO"
    | "CRIAR_RECORRENCIA";
  dados_parciais?: Record<string, unknown> | null;
}

export interface ContextoInterpretacao {
  /** Data de hoje no formato YYYY-MM-DD, usada para resolver "ontem", "hoje" etc. */
  dataAtual: string;
  contas: Array<{ nome: string; perfil: string }>;
  cartoes: Array<{ nome: string; perfil: string; modalidade: string; temConta: boolean }>;
  categorias: Array<{ nome: string; tipo: string }>;
  pessoas: Array<{ nome: string; tipo: string }>;
  /** Hábitos aprendidos (Conhecimento/Memoria), ex.: { chave: "cartao_principal", valor: "Nubank" }. */
  habitos: Array<{ chave: string; valor: string }>;
  /**
   * Últimas mensagens da sessão atual (mais antiga primeiro), usadas para
   * slot-filling flexível entre turnos — ex.: o usuário responde só "R$ 1000"
   * depois de o sistema perguntar o saldo de uma conta que estava criando.
   */
  historicoRecente: MensagemHistorico[];
  /**
   * Dados já extraídos da intenção pendente (quando o sistema acabou de pedir
   * um campo faltante). A IA e o normalizador devem mesclar isso com a resposta
   * atual — nunca descartar limite/nome/etc. já capturados.
   */
  intencaoPendente?: IntencaoPendenteSlot | null;
  /** Nome do usuário (cadastro) — usado para personalizar perguntas. */
  nomeUsuario?: string | null;
}

/**
 * Prompt de sistema do `InterpretadorIntencoes` (extração por ramo).
 * Mantido curto: Groq free/on_demand limita ~8k TPM por request.
 */
export function montar_prompt_sistema(): string {
  return `Você é o InterpretadorIntencoes do LançAI. Só mapeia a mensagem para JSON no schema (campo intencao_detectada). Não valida regras de negócio nem inventa dados.

Intenções do ramo pedido:
1) REGISTRAR_MOVIMENTO — gasto/receita. Valor, conta_nome OU cartao_nome, data_movimento (default dataAtual), perfil, forma_pagamento, categoria_nome da lista.
   descricao: SÓ bem/marca/estabelecimento curto (ex. "Tênis Adidas", "Uber", "iFood").
   NUNCA na descricao: vocativo do bot (LançAI/Lançai/STT "Lanç í"), forma de pagamento (Pix/TED/boleto/transferência/dinheiro/crédito/débito), valor, "reais", "valor", data, conta/cartão, "compra de", "um", "para uso pessoal".
   Pix/TED/etc. → campo forma_pagamento (não descricao).
   Few-shot: "Lançai gastei 304 no tênis Adidas no pix" → descricao "Tênis Adidas", valor 304, forma_pagamento pix.
   "uso pessoal"/"pessoal"/"PF" → perfil=pf; "da empresa"/"PJ" → perfil=pj (mesmo se a conta for do outro perfil).
   Vago sem valor ainda é REGISTRAR (use SOLICITAR_INFORMACAO). Nunca NAO_RECONHECIDA para "fiz mercado"/"gastei no uber".
   Cartão sem "débito" → credito; Conta sem forma → pix. Categorias: Uber→Transporte; iFood→Alimentação; farmácia→Saúde.
2) CONSULTAR_VISAO — saldos|cartoes|parcelamentos|categoria|futuro|fluxo|evolucao|historico.
   Estabelecimento → historico+descricao. "esse mês" → periodo vazio. Um dia → de=ate.
   historico: "quanto gastei/total/resumo" → detalhado=false; "extrato/liste/quais/detalhado/mostra lançamentos" → detalhado=true.
   Escopo do fluxo em filtros.tipos (obrigatório entender o lado da pergunta):
   - despesa → tipos=["despesa"]: gastei, gastou, gasto(s), despesa(s), paguei, comprei, saídas.
   - receita → tipos=["receita"]: ganhei, recebi, receita(s), entrou, entradas, renda, faturamento.
   - omitir tipos: lançamentos/extrato/movimentações sem lado, ou "gastei e recebi".
   Nunca misture receitas numa pergunta de gasto, nem despesas numa pergunta de quanto entrou.
3) CORRIGIR_* — ALTERAR dados OU excluir. São ações distintas:
   - corrige/altera/muda/troca descrição/valor/categoria → campos_alterados com o novo valor; NUNCA status cancelado.
   - "não considera nos relatórios"/"esconde dos totais" → ignorado_em_relatorio=true (não cancela).
   - "tag X no Y"/"marca Y como X" → tags=["X"] na referência Y.
   - apaga/exclui/cancela/deleta lançamento → status cancelado, confirmado false até o usuário confirmar.
   Nunca trate "corrigir descrição" nem "esconder dos relatórios" como exclusão.
4) CRIAR_* — só se nome NÃO existe no contexto. Senão CORRIGIR_*.
5) CONSULTAR_DADOS_CARTAO — ver número/CVV.
6) SOLICITAR_INFORMACAO — falta dado (valor, conta, dia…); copie intencaoPendente.dados_parciais. Nunca invente valor nem diga "valor não informado".
7) CRIAR_RECORRENCIA — "todo mês dia N …"; se faltar valor/conta/dia use SOLICITAR_INFORMACAO (pergunte "qual é o valor?"). "hoje"/"hj" no dia = dia do mês de dataAtual.
8) NAO_RECONHECIDA — só fora do domínio (saudação, pergunta genérica); motivo curto. Nunca para “não” em confirmação.

Datas via dataAtual. Números BR: "12.889,00"=12889. Use nomes do contexto. JSON do schema apenas.`;
}

export function montar_prompt_sistema_classificar(): string {
  return `Classifique a mensagem financeira em UM ramo. Responda só o JSON do schema.
- registrar: gasto, receita, pagamento, compra ("gastei", "recebi", "paguei"). Inclui vago sem valor: "fiz mercado", "gastei no uber", "foi no ifood", "paguei a farmácia". NUNCA use outro nesses casos.
- consultar: perguntas de saldo, extrato, quanto gastei, resumo, limite do cartão, dados do cartão
- corrigir: corrigir, cancelar, apagar, excluir, esconder dos relatórios, tag, mudar valor/categoria de lançamento/conta/cartão
- cadastro: criar/cadastrar conta ou cartão novo
- orcamento: definir ou consultar orçamento/limite de gasto mensal por categoria
- recorrencia: criar/listar/cancelar despesa recorrente (assinatura Netflix etc.)
- outro: só saudação ou assunto claramente fora de finanças`;
}

const MAX_CHARS_HISTORICO_ITEM = 120;
const MAX_ITENS_HISTORICO = 4;
const MAX_ITENS_HISTORICO_SLOT = 2;

function compactar_conteudo_historico(conteudo: string): string {
  const texto = conteudo.replace(/\s+/g, " ").trim();
  if (texto.length <= MAX_CHARS_HISTORICO_ITEM) return texto;
  return `${texto.slice(0, MAX_CHARS_HISTORICO_ITEM - 1)}…`;
}

function formatar_contexto_compacto(contexto: ContextoInterpretacao): string {
  const perfilPadrao = inferir_perfil_padrao(contexto.contas, contexto.cartoes);
  return JSON.stringify({
    dataAtual: contexto.dataAtual,
    totalContas: contexto.contas.length,
    totalCartoes: contexto.cartoes.length,
    perfilPadrao,
    contas: contexto.contas.map((c) => `${c.nome}|${c.perfil}`),
    cartoes: contexto.cartoes.map((c) => `${c.nome}|${c.perfil}|${c.modalidade}`),
    categorias: contexto.categorias.map((c) => `${c.nome}|${c.tipo}`),
    pessoas: contexto.pessoas.map((p) => `${p.nome}|${p.tipo}`),
    habitos: contexto.habitos,
    intencaoPendente: contexto.intencaoPendente ?? null,
  });
}

function formatar_historico(contexto: ContextoInterpretacao, maxItens: number): string {
  const historico = contexto.historicoRecente.slice(-maxItens);
  if (historico.length === 0) return "(vazio)";
  return historico
    .map((item) => `${item.papel === "usuario" ? "U" : "S"}: ${compactar_conteudo_historico(item.conteudo)}`)
    .join("\n");
}

/** Prompt curto só para classificar o ramo (sem lista completa de categorias). */
export function montar_prompt_classificar(mensagem: string, contexto: ContextoInterpretacao): string {
  const resumo = JSON.stringify({
    dataAtual: contexto.dataAtual,
    contas: contexto.contas.map((c) => c.nome),
    cartoes: contexto.cartoes.map((c) => c.nome),
    pendente: contexto.intencaoPendente?.intencao_pendente ?? null,
  });
  return `Ctx:${resumo}\nMsg:"""${mensagem}"""`;
}

/** Prompt de extração do ramo (contexto completo compacto). */
export function montar_prompt_extrair(
  mensagem: string,
  contexto: ContextoInterpretacao,
  ramo: string,
): string {
  const slot = Boolean(contexto.intencaoPendente);
  const maxHist = slot ? MAX_ITENS_HISTORICO_SLOT : MAX_ITENS_HISTORICO;
  return `Ramo=${ramo}\nContexto:\n${formatar_contexto_compacto(contexto)}\n\nHistórico:\n${formatar_historico(contexto, maxHist)}\n\nMensagem:\n"""${mensagem}"""`;
}

/** Monta o prompt do turno atual (compat / testes). */
export function montar_prompt_usuario(mensagem: string, contexto: ContextoInterpretacao): string {
  return montar_prompt_extrair(mensagem, contexto, "completo");
}
