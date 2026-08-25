import type { ConversationContext, DialogueAct, QueryState, ResultContext } from "@lancai/tipos";

export const HISTORICO_MAX_TURNOS_ACT = 8;
export const HISTORICO_MAX_CHARS_ACT = 300;

export type TurnoDialogueAct = {
  papel: "usuario" | "sistema";
  conteudo: string;
};

export type EntradaPromptDialogueAct = {
  mensagem: string;
  context: ConversationContext;
  historico?: TurnoDialogueAct[];
  dataAtual: string;
};

function truncar(texto: string, max = HISTORICO_MAX_CHARS_ACT): string {
  const t = texto.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function compactarQuery(query: QueryState | null | undefined): Record<string, unknown> | null {
  if (!query) return null;
  const { contaId, cartaoId, categoriaId, pessoaId, ...visivel } = query;
  return visivel;
}

function compactarResultado(result: ResultContext | null | undefined): Record<string, unknown> | null {
  if (!result) return null;
  return {
    stale: result.stale,
    summary: result.summary,
    rows: result.rows.map((row) => ({
      ordinal: row.ordinal,
      label: row.label,
      amount: row.amount,
      entityType: row.entityType,
    })),
  };
}

export function compactarContextoDialogueAct(context: ConversationContext): Record<string, unknown> {
  return {
    query: compactarQuery(context.query),
    result: compactarResultado(context.result),
    pending: context.pending_action ? { type: context.pending_action.type } : null,
  };
}

export function montarPromptSistemaDialogueAct(): string {
  return `Você é o extrator de DialogueAct do LançAI. Extraia UM objeto DialogueAct. Não execute ação, não invente IDs, não escreva no banco.

act: greet | new_query | patch_query | change_grain | refresh | refer_result | write | update | delete | diagnose | confirm | cancel

Regras:
- O estado da consulta NÃO é reescrito. new_query só na pergunta nova. Follow-up = patch_query com ops (set|clear). Slot omitido = CARRYOVER (o código mantém).
- Nomes de conta/cartão/categoria vão em names, nunca como UUID. IDs o código resolve.
- "conta da empresa"/PJ como origem do dinheiro → origemPerfil=pj. Natureza pessoal vs empresa → tipoGasto. São slots independentes. Não use contaNome="empresa".
- "e no sábado?" / "e domingo?" / "e mês passado?" com query anterior → patch_query set period. Dia da semana é período, não correção de lançamento. "Foi sábado" (sem "e") com foco é update.
- "mostre detalhado" / "me detalhe" com query anterior → change_grain list. Não new_query.
- "e no cartão?" → patch_query set canal=cartao (e names.cartaoNome se houver nome).
- "tira a empresa" → patch_query clear origemPerfil.
- "compara com junho" → patch_query set comparison.period.
- "esse de 850" → refer_result { by:"amount", value:850 }. Código resolve o id.
- "foi 580 não 850" → update com target amount 850 e patch valor 580. QueryState inalterado.
- "por que?" → diagnose. Nunca vire patch nem update sozinho.
- "e agora?" / "quanto ficou" depois de um mutate (result.stale) → refresh.
- sim/não com pending confirmation → confirm / cancel.
- Olá sem pedido → greet.
- Lançar gasto → write. Corrigir → update. Apagar → delete.

new_query.query campos: entityDomain, grain, period, comparison, tipos, tipoGasto, origemPerfil, cruzado, direcao, canal, merchant, descricao, sort, limit.
grain: summary | list | top | category | month | explain
canal: cartao | conta
period: { tipo: mes_atual | mes_passado | ultimos_n_meses | ano_atual | personalizado, de?, ate?, nMeses? }

Few-shot:
U: "Quanto gastei na conta da empresa ontem?"
→ {"act":"new_query","query":{"grain":"summary","tipos":["despesa"],"origemPerfil":"pj","period":{"tipo":"personalizado","de":"<ontem>","ate":"<ontem>"}}}
U: "mostre detalhado"
→ {"act":"change_grain","grain":"list"}
U: "e no sábado?"
→ {"act":"patch_query","ops":[{"op":"set","slot":"period","value":{"tipo":"personalizado","de":"<sábado>","ate":"<sábado>"}}]}
U: "e no cartão?"
→ {"act":"patch_query","ops":[{"op":"set","slot":"canal","value":"cartao"}]}
U: "Gastei 50 no Uber no Nubank"
→ {"act":"write","intent":{"tipo":"despesa","valor":50,"descricao":"Uber","contaNome":"Nubank"}}

Responda só o JSON do schema.`;
}

export function montarPromptUsuarioDialogueAct(entrada: EntradaPromptDialogueAct): string {
  const historico = (entrada.historico ?? []).slice(-HISTORICO_MAX_TURNOS_ACT).map((turno) => ({
    papel: turno.papel,
    conteudo: truncar(turno.conteudo),
  }));
  const linhas =
    historico.length === 0
      ? "(vazio)"
      : historico.map((t) => `${t.papel}: ${t.conteudo}`).join("\n");
  return [
    `dataAtual: ${entrada.dataAtual}`,
    "ConversationState (query + result; sem UUIDs):",
    JSON.stringify(compactarContextoDialogueAct(entrada.context)),
    "Histórico (mais antigo primeiro, máx. 8):",
    linhas,
    "Mensagem:",
    entrada.mensagem,
  ].join("\n");
}
