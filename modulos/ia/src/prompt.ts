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
  intencao_pendente: "CRIAR_CONTA" | "CRIAR_CARTAO" | "REGISTRAR_MOVIMENTO";
  dados_parciais?: Record<string, unknown> | null;
}

export interface ContextoInterpretacao {
  /** Data de hoje no formato YYYY-MM-DD, usada para resolver "ontem", "hoje" etc. */
  dataAtual: string;
  contas: Array<{ nome: string; perfil: string }>;
  cartoes: Array<{ nome: string; perfil: string; modalidade: string; temConta: boolean }>;
  categorias: Array<{ nome: string; tipo: string }>;
  pessoas: Array<{ nome: string; tipo: string }>;
  /** Hábitos aprendidos (modulos/memoria), ex.: { chave: "cartao_principal", valor: "Nubank" }. */
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
}

/**
 * Prompt de sistema do `InterpretadorIntencoes`.
 * Mantido curto de propósito: Groq free/on_demand limita ~8k TPM por request
 * (system + schema JSON + user). Versão longa estourava ~8.3k só no input.
 */
export function montar_prompt_sistema(): string {
  return `Você é o InterpretadorIntencoes do LançAI. Só mapeia a mensagem para JSON no schema (campo intencao_detectada). Não valida regras de negócio nem inventa dados.

Intenções:
1) REGISTRAR_MOVIMENTO — gasto/receita/transferência. Valor, descricao limpa (sem reais/data/cartão), conta_nome OU cartao_nome, data_movimento (default dataAtual), perfil, forma_pagamento, categoria_nome da lista.
   Vago sem valor ainda é REGISTRAR (peça via SOLICITAR_INFORMACAO). Nunca NAO_RECONHECIDA para "fiz mercado"/"gastei no uber".
   Cartão sem "débito" → credito; "débito" → debito. Conta sem forma → pix.
   Perfil do LANÇAMENTO: pista explícita → perfil da conta/cartão → perfilPadrao → só então perguntar.
   Categorias: Uber/99→Transporte; iFood/mercado/almoço→Alimentação; farmácia→Saúde; posto→Combustível; Netflix→Assinaturas. Nunca categoria="Uber".
   confirmado=true só se o histórico pediu confirmação de duplicata e o usuário disse sim.
2) CONSULTAR_VISAO — saldos|cartoes|parcelamentos|categoria|futuro|fluxo|evolucao|historico.
   Estabelecimento (Uber, farmácia) → historico + filtros.descricao. Nome da lista (Alimentação) → categoria + categoria_nome.
   "esse mês"/sem período → periodo vazio. Um dia → de=ate. "quanto gastei…" → historico (ou categoria se for da lista).
3) CORRIGIR_MOVIMENTO — altera/cancela lançamento. referencia (descricao/data/codigo); cancelar → status cancelado, confirmado false até o usuário confirmar.
4) CRIAR_CONTA / 5) CRIAR_CARTAO — só se o nome AINDA NÃO existe no contexto. Senão use CORRIGIR_*.
6) CORRIGIR_CONTA / 7) CORRIGIR_CARTAO — alterar/excluir existente (ativo=false pede confirmação).
8) CONSULTAR_DADOS_CARTAO — ver número/CVV (sistema pede senha depois).
9) SOLICITAR_INFORMACAO — falta dado; copie intencaoPendente.dados_parciais; nunca peça de novo o que já tem.
10) NAO_RECONHECIDA — fora do domínio; motivo curto. MENU — pedidos de menu/ajuda.

Datas: hoje/ontem/anteontem/dia N/DD/MM → YYYY-MM-DD via dataAtual.
Números BR: "12.889,00"=12889 (ponto=milhar). fechamento/vencimento = dia 1–31.
Use nomes de contas/cartões do contexto ("cartão azul"→Azul Itaú). JSON do schema apenas.`;
}

const MAX_CHARS_HISTORICO_ITEM = 180;
const MAX_ITENS_HISTORICO = 6;

function compactar_conteudo_historico(conteudo: string): string {
  const texto = conteudo.replace(/\s+/g, " ").trim();
  if (texto.length <= MAX_CHARS_HISTORICO_ITEM) return texto;
  return `${texto.slice(0, MAX_CHARS_HISTORICO_ITEM - 1)}…`;
}

/** Monta o prompt do turno atual: contexto compacto + histórico truncado + mensagem. */
export function montar_prompt_usuario(mensagem: string, contexto: ContextoInterpretacao): string {
  const perfilPadrao = inferir_perfil_padrao(contexto.contas, contexto.cartoes);

  const contextoFormatado = JSON.stringify({
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

  const historico = contexto.historicoRecente.slice(-MAX_ITENS_HISTORICO);
  const historicoFormatado = historico.length
    ? historico
        .map((item) => `${item.papel === "usuario" ? "U" : "S"}: ${compactar_conteudo_historico(item.conteudo)}`)
        .join("\n")
    : "(vazio)";

  return `Contexto:\n${contextoFormatado}\n\nHistórico:\n${historicoFormatado}\n\nMensagem:\n"""${mensagem}"""`;
}
