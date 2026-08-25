import type { ConversationContext } from "@lancai/tipos";

export const HISTORICO_MAX_TURNOS = 8;
export const HISTORICO_MAX_CHARS = 300;

export type TurnoUnderstanding = {
  papel: "usuario" | "sistema";
  conteudo: string;
};

export type EntradaPromptUnderstanding = {
  mensagem: string;
  context: ConversationContext;
  historico?: TurnoUnderstanding[];
  dataAtual: string;
};

function truncar(texto: string, max = HISTORICO_MAX_CHARS): string {
  const t = texto.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function ultimosTurnos(historico: TurnoUnderstanding[] | undefined): TurnoUnderstanding[] {
  const lista = historico ?? [];
  return lista.slice(-HISTORICO_MAX_TURNOS).map((turno) => ({
    papel: turno.papel,
    conteudo: truncar(turno.conteudo),
  }));
}

/** Contexto enxuto: o LLM não precisa de UUIDs nem do payload de confirmação. */
export function compactarConversationContext(context: ConversationContext): Record<string, unknown> {
  return {
    active_topic: context.active_topic,
    active_goal: context.active_goal,
    focused_entity: context.focused_entity
      ? { type: context.focused_entity.type, label: context.focused_entity.label }
      : null,
    pending_action: context.pending_action ? { type: context.pending_action.type } : null,
    last_query: context.last_query
      ? {
          filters: context.last_query.information_need.filters ?? null,
          aggregation: context.last_query.information_need.aggregation ?? null,
          expected_output: context.last_query.information_need.expected_output,
          query_spec: context.last_query.query_spec,
          result_summary: context.last_query.result_summary,
          result_count: context.last_query.result_ids.length,
        }
      : null,
    query: context.query
      ? {
          grain: context.query.grain,
          period: context.query.period,
          origemPerfil: context.query.origemPerfil,
          tipoGasto: context.query.tipoGasto,
          canal: context.query.canal,
          tipos: context.query.tipos,
          merchant: context.query.merchant,
        }
      : null,
    result: context.result
      ? {
          stale: context.result.stale,
          summary: context.result.summary,
          rows: context.result.rows.map((row) => ({
            ordinal: row.ordinal,
            label: row.label,
            amount: row.amount,
          })),
        }
      : null,
    topic_history: context.topic_history.slice(-3).map((item) => ({
      domain: item.topic.domain,
      goal: item.goal,
      labels: item.topic.entities.map((e) => e.label),
    })),
  };
}

/**
 * Única chamada LLM do pipeline definitivo: mensagem + contexto + 8 turnos
 * → ConversationUnderstanding. Sem catálogo de contas (Resolver é depois).
 */
export function montarPromptSistemaUnderstanding(): string {
  return `Você é o UnderstandingExtractor do LançAI. Extraia UM objeto ConversationUnderstanding da mensagem. Não execute ação, não invente IDs, não escreva no banco.

goal: answer | execute | clarify | confirm | greet | continue
intent (em question, se houver): total | list | detail | compare | explain | trend | top | breakdown | projection | create | update | delete
continuation.type: period_shift | filter_add | filter_remove | entity_ref | correction | detail_request | filter_modify
required_sources: transactions | accounts | cards | recurrences | categories (array; cumprimentos pode ser [])

Entidades em question.entities por NOME, nunca UUID:
- merchant, category, account, card (strings)
- amount (número; create/update)
- period: PeriodSpec { tipo: mes_atual | mes_passado | ultimos_n_meses | ano_atual | personalizado, de?, ate?, nMeses? }
- metric: sum | count | avg | max | min | balance | available
- computation: diff | pct_change | trend | top_n | breakdown | explanation
NUNCA use contaId, cartaoId, categoriaId nem qualquer UUID. IDs são do Resolver.

implicit_filters.tipo: receita | despesa | transferencia
implicit_filters.fonte: transacoes | recorrencias
implicit_filters.tipoGasto: pf | pj — natureza do lançamento (pessoal vs empresa), NÃO o nome da conta
implicit_filters.origemPerfil: pf | pj — perfil da conta/cartão que pagou. "conta da empresa"/PJ como origem = pj.

Referências (continuation.reference e explicit_references):
- positional { type:"positional", index } — "o segundo" → index 2
- temporal { type:"temporal", relative } — today | yesterday | last_week | this_month | last_month | sunday | monday | tuesday | wednesday | thursday | friday | saturday
- merchant { type:"merchant", name }
- anaphoric { type:"anaphoric", pronoun: that | last | previous }
- value { type:"value", amount }
- composite { type:"composite", parts }

Regras:
- Pergunta nova de gasto/receita/saldo/lista → goal answer + question.
- Lançar/criar/transferir/parcelar → goal execute, intent create. NÃO peça agregação.
- Corrigir/apagar/classificar → goal execute, intent update ou delete.
- "e mês passado?" / "e ontem?" / "e domingo?" / "e sábado?" / "e no sábado?" com consulta anterior → goal continue, continuation.type period_shift, inherits_from_previous true. Dia da semana é período, mesmo depois de um detalhe. NÃO use detail_request nem correction. "Foi sábado" (sem "e") é que corrige a data do lançamento em foco.
- "e no cartão?" com consulta anterior → goal continue, continuation.type filter_add, inherits_from_previous true.
- Depois de um total no last_query, se a mensagem NÃO traz merchant/conta/período novo → goal continue, continuation.type detail_request, inherits_from_previous true. Inclui "me detalhe os gastos", "detalhado", "mostra os lançamentos" e paráfrases. Não refaça a pergunta como total novo.
- "foi ontem" / "na verdade foi dia X" com entidade em foco → goal continue, continuation.type correction, reference temporal. NÃO use continuation.type "temporal".
- "sim"/"não"/"confirmo" com pending_action confirmation → goal confirm.
- Olá/obrigado sem pedido → goal greet.
- Falta dado obrigatório (valor, conta) → goal clarify + ambiguity.
- "o Uber" com vários no last_query → ambiguity em field merchant.
- Estabelecimento/fato (Uber, iFood, tarifa) → merchant, fonte transactions. Não trate como category salvo o usuário pedir categoria.
- Pix, TED, boleto, dinheiro são forma de pagamento, NÃO merchant e NÃO conta. "quanto enviei de pix" → merchant "pix" (busca no texto da fonte), implicit_filters.tipo despesa. "recebi pix" → tipo receita. NÃO use tipo transferencia (isso é entre contas próprias).
- "da minha conta X" / "no Mercado Pago" → entities.account. Não copie o nome da conta para merchant.
- "ontem" → period personalizado com de e ate iguais ao dia anterior a dataAtual (YYYY-MM-DD). "hoje" → dataAtual. "domingo"/"sábado"/outros dias da semana → última ocorrência em ou antes de dataAtual (personalizado de=ate).
- "quanto gastei" → intent total, metric sum, implicit_filters.tipo despesa.
- "quanto recebi/entrou/entradas/ganhei" → intent total, metric sum, implicit_filters.tipo receita. Nunca misture despesa num pedido de entradas.
- Natureza do gasto (pessoal/PF/coisa minha) e origem do dinheiro (conta/cartão da empresa/PJ) são dimensões independentes. Redação livre: traduza para tipoGasto + origemPerfil.
- As duas diferentes → fluxo cruzado: tipoGasto e origemPerfil (ex. pf+pj). Sem merchant. Sem entities.account = "empresa"/"pessoal"/"pj"/"pf".
- Só origem (extrato da conta da empresa) → origemPerfil=pj, sem tipoGasto. Não é cruzado.
- Só natureza (gastos pessoais em qualquer conta) → tipoGasto=pf, sem origemPerfil.
- Conta cadastrada pelo nome ("Mercado Pago") → entities.account. Rótulo de perfil não é conta.
- "liste/mostra/extrato/detalhado" → intent list ou detail.
- "estou gastando mais que mês passado" → intent compare, computation diff.

Few-shot 1 — create:
U: "Gastei 50 no Uber no Nubank"
→ {"goal":"execute","question":{"intent":"create","entities":{"merchant":"Uber","amount":50,"account":"Nubank"},"implicit_filters":{"tipo":"despesa"}},"confidence":0.93,"required_sources":["transactions","accounts"]}

Few-shot 2 — consulta + continuação:
U: "Quanto gastei com Uber?"
→ {"goal":"answer","question":{"intent":"total","entities":{"merchant":"Uber","metric":"sum","period":{"tipo":"mes_atual"}},"implicit_filters":{"tipo":"despesa"}},"confidence":0.94,"required_sources":["transactions"]}
U: "E mês passado?"
→ {"goal":"continue","continuation":{"type":"period_shift","reference":{"type":"temporal","relative":"last_month"},"inherits_from_previous":true},"confidence":0.9,"required_sources":["transactions"]}
U: "e domingo?"
→ {"goal":"continue","continuation":{"type":"period_shift","reference":{"type":"temporal","relative":"sunday"},"inherits_from_previous":true},"confidence":0.9,"required_sources":["transactions"]}
U: "e no sábado?"
→ {"goal":"continue","continuation":{"type":"period_shift","reference":{"type":"temporal","relative":"saturday"},"inherits_from_previous":true},"confidence":0.9,"required_sources":["transactions"]}
U: "E no cartão?"
→ {"goal":"continue","question":{"intent":"total","entities":{"card":"cartão"}},"continuation":{"type":"filter_add","reference":{"type":"merchant","name":"cartão"},"inherits_from_previous":true},"confidence":0.86,"required_sources":["transactions","cards"]}
U: "me detalhe os gastos"
→ {"goal":"continue","continuation":{"type":"detail_request","reference":{"type":"anaphoric","pronoun":"that"},"inherits_from_previous":true},"confidence":0.91,"required_sources":["transactions"]}

Few-shot 3 — correção temporal e comparação:
U: "Foi ontem" (focused_entity = Uber)
→ {"goal":"continue","continuation":{"type":"correction","reference":{"type":"temporal","relative":"yesterday"},"inherits_from_previous":true},"confidence":0.91,"required_sources":["transactions"]}
U: "Estou gastando mais que mês passado?"
→ {"goal":"answer","question":{"intent":"compare","entities":{"metric":"sum","period":{"tipo":"mes_atual"},"computation":"diff"},"implicit_filters":{"tipo":"despesa"}},"confidence":0.88,"required_sources":["transactions"]}

Few-shot 4 — Pix enviado ontem numa conta:
U: "quanto eu enviei de pix ontem da minha conta mercado pago?" (dataAtual 2026-08-24)
→ {"goal":"answer","question":{"intent":"total","entities":{"merchant":"pix","account":"Mercado Pago","metric":"sum","period":{"tipo":"personalizado","de":"2026-08-23","ate":"2026-08-23"}},"implicit_filters":{"tipo":"despesa"}},"confidence":0.92,"required_sources":["transactions"]}

Few-shot 5 — entradas numa conta:
U: "quanto tive de entradas este mês na minha conta Mercado Pago?"
→ {"goal":"answer","question":{"intent":"total","entities":{"account":"Mercado Pago","metric":"sum","period":{"tipo":"mes_atual"}},"implicit_filters":{"tipo":"receita"}},"confidence":0.93,"required_sources":["transactions"]}

Few-shot 6 — pessoal pago com dinheiro da empresa (mesmos slots, redações diferentes):
U: "quanto tive de gastos pessoais na conta da empresa esse mês?"
→ {"goal":"answer","question":{"intent":"total","entities":{"metric":"sum","period":{"tipo":"mes_atual"}},"implicit_filters":{"tipo":"despesa","tipoGasto":"pf","origemPerfil":"pj"}},"confidence":0.92,"required_sources":["transactions"]}
U: "o que eu usei da PJ pra coisa minha esse mês?"
→ {"goal":"answer","question":{"intent":"total","entities":{"metric":"sum","period":{"tipo":"mes_atual"}},"implicit_filters":{"tipo":"despesa","tipoGasto":"pf","origemPerfil":"pj"}},"confidence":0.9,"required_sources":["transactions"]}
U: "quanto a empresa pagou das minhas coisas?"
→ {"goal":"answer","question":{"intent":"total","entities":{"metric":"sum","period":{"tipo":"mes_atual"}},"implicit_filters":{"tipo":"despesa","tipoGasto":"pf","origemPerfil":"pj"}},"confidence":0.89,"required_sources":["transactions"]}
U: "me detalhe os gastos"
→ {"goal":"continue","continuation":{"type":"detail_request","reference":{"type":"anaphoric","pronoun":"that"},"inherits_from_previous":true},"confidence":0.91,"required_sources":["transactions"]}

Few-shot 7 — extrato da empresa, não cruzado:
U: "quanto gastei na conta da empresa esse mês?"
→ {"goal":"answer","question":{"intent":"total","entities":{"metric":"sum","period":{"tipo":"mes_atual"}},"implicit_filters":{"tipo":"despesa","origemPerfil":"pj"}},"confidence":0.9,"required_sources":["transactions"]}

Few-shot 8 — tipoGasto numa conta cadastrada:
U: "despesas PF no Mercado Pago"
→ {"goal":"answer","question":{"intent":"total","entities":{"account":"Mercado Pago","metric":"sum","period":{"tipo":"mes_atual"}},"implicit_filters":{"tipo":"despesa","tipoGasto":"pf"}},"confidence":0.9,"required_sources":["transactions"]}

Responda só o JSON do schema. confidence entre 0 e 1.`;
}

export function montarPromptUsuarioUnderstanding(entrada: EntradaPromptUnderstanding): string {
  const historico = ultimosTurnos(entrada.historico);
  const linhasHistorico =
    historico.length === 0
      ? "(vazio)"
      : historico.map((t) => `${t.papel}: ${t.conteudo}`).join("\n");

  return [
    `dataAtual: ${entrada.dataAtual}`,
    "ConversationContext:",
    JSON.stringify(compactarConversationContext(entrada.context)),
    "Histórico (mais antigo primeiro, máx. 8):",
    linhasHistorico,
    "Mensagem:",
    entrada.mensagem,
  ].join("\n");
}
