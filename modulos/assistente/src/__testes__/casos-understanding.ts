import {
  ConversationContextSchema,
  ConversationUnderstandingSchema,
  InformationNeedSchema,
  estadoInicialConversacaoV3,
  type ConversationContext,
  type ConversationUnderstanding,
  type InformationNeed,
} from "@lancai/tipos";

export const AGORA = 1_777_000_000_000;
export const MOVIMENTO_UBER = "11111111-1111-4111-8111-111111111111";
export const MOVIMENTO_UBER_B = "00000000-0000-4000-8000-000000000102";
export const MOVIMENTO_UBER_C = "00000000-0000-4000-8000-000000000103";
export const MOVIMENTO_IFOOD = "00000000-0000-4000-8000-000000000104";
export const CATEGORIA_LAZER = "00000000-0000-4000-8000-000000000201";
export const DATA_ATUAL = "2026-08-23";

export type CasoUnderstanding = {
  id: string;
  mensagem: string;
  context?: ConversationContext;
  historico?: Array<{ papel: "usuario" | "sistema"; conteudo: string }>;
  dataAtual?: string;
  understanding: ConversationUnderstanding;
  need: InformationNeed | null;
};

function und(bruto: ConversationUnderstanding): ConversationUnderstanding {
  return ConversationUnderstandingSchema.parse(bruto);
}

function need(bruto: InformationNeed): InformationNeed {
  return InformationNeedSchema.parse(bruto);
}

export function needUberMesAtual(): InformationNeed {
  return need({
    data_sources: ["transactions"],
    source_priority: ["transactions"],
    filters: {
      transactions: {
        merchant: "Uber",
        tipos: ["despesa"],
        periodo: { tipo: "mes_atual" },
      },
    },
    aggregation: { type: "sum", field: "valor" },
    expected_output: "single_value",
  });
}

export function understandingFluxoPessoalEmpresa(
  confidence = 0.92,
): ConversationUnderstanding {
  return und({
    goal: "answer",
    question: {
      intent: "total",
      entities: { metric: "sum", period: { tipo: "mes_atual" } },
      implicit_filters: { tipo: "despesa", tipoGasto: "pf", origemPerfil: "pj" },
    },
    confidence,
    required_sources: ["transactions"],
  });
}

export function needFluxoPessoalEmpresa(): InformationNeed {
  return need({
    data_sources: ["transactions"],
    source_priority: ["transactions"],
    filters: {
      transactions: {
        tipos: ["despesa"],
        periodo: { tipo: "mes_atual" },
        cruzado: true,
        origemPerfil: "pj",
        direcao: "pessoal_com_empresa",
      },
    },
    aggregation: { type: "sum", field: "valor" },
    expected_output: "single_value",
  });
}

export function contextoAposConsultaFluxo(): ConversationContext {
  return ConversationContextSchema.parse({
    ...estadoInicialConversacaoV3(AGORA),
    active_topic: { domain: "spending", period: { tipo: "mes_atual" } },
    active_goal: "analyze",
    last_query: {
      information_need: needFluxoPessoalEmpresa(),
      query_spec: {
        visionType: "fluxo",
        entityType: "transaction",
        tipos: ["despesa"],
        period: { tipo: "mes_atual" },
        aggregation: "sum",
        direcao: "pessoal_com_empresa",
      },
      result_ids: [],
      result_summary: { count: 4, total: 3482.44, period: { tipo: "mes_atual" } },
      expires_at: AGORA + 60_000,
    },
  });
}

export function contextoAposConsultaUber(): ConversationContext {
  return ConversationContextSchema.parse({
    ...estadoInicialConversacaoV3(AGORA),
    active_topic: { domain: "spending", period: { tipo: "mes_atual" } },
    active_goal: "analyze",
    last_query: {
      information_need: needUberMesAtual(),
      query_spec: { merchant: "Uber", period: { tipo: "mes_atual" }, aggregation: "sum" },
      result_ids: [MOVIMENTO_UBER],
      result_summary: { count: 3, total: 140, period: { tipo: "mes_atual" } },
      expires_at: AGORA + 60_000,
    },
    focused_entity: { id: MOVIMENTO_UBER, type: "transaction", label: "Uber" },
  });
}

export function contextoListaTresUbers(): ConversationContext {
  const base = contextoAposConsultaUber();
  return ConversationContextSchema.parse({
    ...base,
    last_query: {
      ...base.last_query!,
      result_ids: [MOVIMENTO_UBER, MOVIMENTO_UBER_B, MOVIMENTO_UBER_C],
      result_summary: { count: 3, total: 140, period: { tipo: "mes_atual" } },
    },
  });
}

export function contextoOfUber(): ConversationContext {
  return ConversationContextSchema.parse({
    ...contextoAposConsultaUber(),
    focused_entity: {
      id: MOVIMENTO_UBER,
      type: "transaction",
      label: "Uber",
      metadata: { fatoImutavel: true, fonte: "open_finance", merchant: "Uber" },
    },
  });
}

export function contextoComConfirmacao(): ConversationContext {
  return ConversationContextSchema.parse({
    ...estadoInicialConversacaoV3(AGORA),
    pending_action: { type: "confirmation", payload: { message: "Confirmar Uber R$ 50?" } },
  });
}

const vazio = (): ConversationContext => estadoInicialConversacaoV3(AGORA);

export const CASOS_UNDERSTANDING: CasoUnderstanding[] = [
  {
    id: "create-uber-nubank",
    mensagem: "Gastei 50 no Uber no Nubank",
    context: vazio(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "create",
        entities: { merchant: "Uber", amount: 50, account: "Nubank" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.93,
      required_sources: ["transactions", "accounts"],
    }),
    need: null,
  },
  {
    id: "create-salario",
    mensagem: "Recebi 1000 de salário no Itaú",
    context: vazio(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "create",
        entities: { merchant: "Salário", amount: 1000, account: "Itaú" },
        implicit_filters: { tipo: "receita" },
      },
      confidence: 0.92,
      required_sources: ["transactions", "accounts"],
    }),
    need: null,
  },
  {
    id: "create-transferencia",
    mensagem: "Transfere 200 do Nubank pro Itaú",
    context: vazio(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "create",
        entities: { amount: 200, account: "Nubank", value: { destino: "Itaú" } },
        implicit_filters: { tipo: "transferencia" },
      },
      confidence: 0.88,
      required_sources: ["transactions", "accounts"],
    }),
    need: null,
  },
  {
    id: "create-parcelado",
    mensagem: "Comprei um notebook de 3000 no cartão em 10x",
    context: vazio(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "create",
        entities: { merchant: "notebook", amount: 3000, card: "cartão", value: { parcelas: 10 } },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.87,
      required_sources: ["transactions", "cards"],
    }),
    need: null,
  },
  {
    id: "consulta-total-uber",
    mensagem: "Quanto gastei com Uber?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: { merchant: "Uber", metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.94,
      required_sources: ["transactions"],
    }),
    need: needUberMesAtual(),
  },
  {
    id: "consulta-lista-uber",
    mensagem: "Mostra os lançamentos de Uber",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "list",
        entities: { merchant: "Uber", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.91,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: { merchant: "Uber", periodo: { tipo: "mes_atual" }, tipos: ["despesa"] },
      },
      aggregation: { type: "none", field: "valor" },
      expected_output: "list",
    }),
  },
  {
    id: "consulta-detalhe",
    mensagem: "Me mostra o detalhe do último Uber",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "detail",
        entities: { merchant: "Uber" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.85,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: { transactions: { merchant: "Uber", tipos: ["despesa"] } },
      aggregation: { type: "none", field: "valor" },
      expected_output: "list",
    }),
  },
  {
    id: "continue-period-shift",
    mensagem: "E mês passado?",
    context: contextoAposConsultaUber(),
    historico: [
      { papel: "usuario", conteudo: "Quanto gastei com Uber?" },
      { papel: "sistema", conteudo: "Você gastou R$ 140 com Uber neste mês." },
    ],
    understanding: und({
      goal: "continue",
      continuation: {
        type: "period_shift",
        reference: { type: "temporal", relative: "last_month" },
        inherits_from_previous: true,
      },
      confidence: 0.9,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          merchant: "Uber",
          tipos: ["despesa"],
          periodo: { tipo: "mes_passado" },
        },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "continue-filter-add-cartao",
    mensagem: "E no cartão Revolut Visa?",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "continue",
      question: {
        intent: "total",
        entities: { card: "Revolut Visa" },
        implicit_filters: { tipo: "despesa" },
      },
      continuation: {
        type: "filter_add",
        reference: { type: "merchant", name: "Revolut Visa" },
        inherits_from_previous: true,
      },
      confidence: 0.86,
      required_sources: ["transactions", "cards"],
    }),
    need: need({
      data_sources: ["transactions", "cards"],
      source_priority: ["transactions", "cards"],
      filters: {
        transactions: {
          merchant: "Uber",
          tipos: ["despesa"],
          periodo: { tipo: "mes_atual" },
          cartaoNome: "Revolut Visa",
        },
        cards: { nome: "Revolut Visa" },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "continue-filter-remove-merchant",
    mensagem: "Tira o filtro do Uber",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "continue",
      continuation: {
        type: "filter_remove",
        reference: { type: "merchant", name: "Uber" },
        inherits_from_previous: true,
      },
      confidence: 0.84,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: { tipos: ["despesa"], periodo: { tipo: "mes_atual" } },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "continue-detail-request",
    mensagem: "Mostra detalhado",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "continue",
      continuation: {
        type: "detail_request",
        reference: { type: "anaphoric", pronoun: "that" },
        inherits_from_previous: true,
      },
      confidence: 0.89,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          merchant: "Uber",
          tipos: ["despesa"],
          periodo: { tipo: "mes_atual" },
        },
      },
      aggregation: { type: "none", field: "valor" },
      expected_output: "list",
    }),
  },
  {
    id: "continue-detail-fluxo",
    mensagem: "me detalhe os gastos",
    context: contextoAposConsultaFluxo(),
    understanding: und({
      goal: "continue",
      continuation: {
        type: "detail_request",
        reference: { type: "anaphoric", pronoun: "that" },
        inherits_from_previous: true,
      },
      confidence: 0.91,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          tipos: ["despesa"],
          periodo: { tipo: "mes_atual" },
          cruzado: true,
          origemPerfil: "pj",
          direcao: "pessoal_com_empresa",
        },
      },
      aggregation: { type: "none", field: "valor" },
      expected_output: "list",
    }),
  },
  {
    id: "continue-filter-modify-periodo",
    mensagem: "Na verdade quero o mês passado",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "continue",
      question: {
        intent: "total",
        entities: { period: { tipo: "mes_passado" } },
      },
      continuation: {
        type: "filter_modify",
        reference: { type: "temporal", relative: "last_month" },
        inherits_from_previous: true,
      },
      confidence: 0.87,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          merchant: "Uber",
          tipos: ["despesa"],
          periodo: { tipo: "mes_passado" },
        },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "correcao-foi-ontem",
    mensagem: "Foi ontem",
    context: contextoAposConsultaUber(),
    dataAtual: DATA_ATUAL,
    understanding: und({
      goal: "continue",
      continuation: {
        type: "correction",
        reference: { type: "temporal", relative: "yesterday" },
        inherits_from_previous: true,
      },
      confidence: 0.91,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ref-posicional-segundo",
    mensagem: "O segundo foi pessoal",
    context: contextoListaTresUbers(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { value: { perfil: "pf" } } },
      continuation: {
        type: "entity_ref",
        reference: { type: "positional", index: 2 },
        inherits_from_previous: true,
      },
      explicit_references: [{ type: "positional", index: 2 }],
      confidence: 0.9,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ref-temporal-ontem",
    mensagem: "O de ontem era alimentação",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { category: "Alimentação" } },
      continuation: {
        type: "entity_ref",
        reference: { type: "temporal", relative: "yesterday" },
        inherits_from_previous: true,
      },
      confidence: 0.86,
      required_sources: ["transactions", "categories"],
    }),
    need: null,
  },
  {
    id: "ref-merchant-uber",
    mensagem: "Corrige o Uber para 80",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "update",
        entities: { merchant: "Uber", amount: 80 },
      },
      continuation: {
        type: "entity_ref",
        reference: { type: "merchant", name: "Uber" },
        inherits_from_previous: true,
      },
      confidence: 0.88,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ref-anaforica",
    mensagem: "Aquele foi da empresa",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { value: { perfil: "pj" } } },
      continuation: {
        type: "entity_ref",
        reference: { type: "anaphoric", pronoun: "that" },
        inherits_from_previous: true,
      },
      confidence: 0.82,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ambiguidade-tres-ubers",
    mensagem: "Corrige o Uber",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { merchant: "Uber" } },
      ambiguity: [{ field: "merchant", reason: "3 Ubers no último resultado" }],
      confidence: 0.7,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "correcao-conta-conhecimento",
    mensagem: "Marca o Uber como lazer",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "update",
        entities: { merchant: "Uber", category: "Lazer" },
      },
      confidence: 0.85,
      required_sources: ["transactions", "categories"],
    }),
    need: null,
  },
  {
    id: "cancelar-manual",
    mensagem: "Apaga aquele lançamento",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: { intent: "delete" },
      continuation: {
        type: "entity_ref",
        reference: { type: "anaphoric", pronoun: "that" },
        inherits_from_previous: true,
      },
      confidence: 0.8,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "of-delete",
    mensagem: "Apaga aquele lançamento do banco",
    context: contextoOfUber(),
    understanding: und({
      goal: "execute",
      question: { intent: "delete" },
      continuation: {
        type: "entity_ref",
        reference: { type: "anaphoric", pronoun: "that" },
        inherits_from_previous: true,
      },
      confidence: 0.78,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "compare-mes-passado",
    mensagem: "Estou gastando mais que mês passado?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "compare",
        entities: { metric: "sum", period: { tipo: "mes_atual" }, computation: "diff" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.88,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: { tipos: ["despesa"], periodo: { tipo: "mes_atual" } },
      },
      aggregation: { type: "sum", field: "valor" },
      computation: { type: "diff" },
      expected_output: "comparison",
    }),
  },
  {
    id: "breakdown-categoria",
    mensagem: "Gastos por categoria este mês",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "breakdown",
        entities: { period: { tipo: "mes_atual" }, computation: "breakdown" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.9,
      required_sources: ["transactions", "categories"],
    }),
    need: need({
      data_sources: ["transactions", "categories"],
      source_priority: ["transactions", "categories"],
      filters: {
        transactions: { tipos: ["despesa"], periodo: { tipo: "mes_atual" } },
      },
      aggregation: { type: "sum", field: "valor", group_by: ["category"] },
      computation: { type: "breakdown", params: { group_by: "category" } },
      expected_output: "table",
    }),
  },
  {
    id: "trend",
    mensagem: "Como estão evoluindo meus gastos?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "trend",
        entities: { metric: "sum", computation: "trend" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.83,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: { transactions: { tipos: ["despesa"] } },
      aggregation: { type: "sum", field: "valor" },
      computation: { type: "trend" },
      expected_output: "chart",
    }),
  },
  {
    id: "top-merchants",
    mensagem: "Onde mais gastei este mês?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "top",
        entities: { period: { tipo: "mes_atual" }, computation: "top_n" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.86,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: { tipos: ["despesa"], periodo: { tipo: "mes_atual" } },
      },
      aggregation: { type: "sum", field: "valor", group_by: ["merchant"] },
      computation: { type: "top_n", params: { n: 5 } },
      expected_output: "table",
    }),
  },
  {
    id: "explain",
    mensagem: "Por que gastei tanto este mês?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "explain",
        entities: { metric: "sum", period: { tipo: "mes_atual" }, computation: "explanation" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.8,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: { tipos: ["despesa"], periodo: { tipo: "mes_atual" } },
      },
      aggregation: { type: "sum", field: "valor" },
      computation: { type: "explanation" },
      expected_output: "explanation",
    }),
  },
  {
    id: "projection",
    mensagem: "Quanto vou gastar até o fim do mês?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "projection",
        entities: { metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.77,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: { tipos: ["despesa"], periodo: { tipo: "mes_atual" } },
      },
      aggregation: { type: "sum", field: "valor" },
      computation: { type: "trend" },
      expected_output: "chart",
    }),
  },
  {
    id: "saldo-nubank",
    mensagem: "Qual o saldo da Nubank?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: { account: "Nubank", metric: "balance" },
      },
      confidence: 0.92,
      required_sources: ["accounts"],
    }),
    need: need({
      data_sources: ["accounts"],
      source_priority: ["accounts"],
      filters: {
        transactions: { contaNome: "Nubank" },
        accounts: { nome: "Nubank" },
      },
      expected_output: "single_value",
    }),
  },
  {
    id: "cartao-disponivel",
    mensagem: "Quanto tem disponível no cartão Nubank?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: { card: "Nubank", metric: "available" },
      },
      confidence: 0.9,
      required_sources: ["cards"],
    }),
    need: need({
      data_sources: ["cards"],
      source_priority: ["cards"],
      filters: {
        transactions: { cartaoNome: "Nubank" },
        cards: { nome: "Nubank" },
      },
      expected_output: "single_value",
    }),
  },
  {
    id: "recorrencias",
    mensagem: "Quais são minhas assinaturas?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "list",
        implicit_filters: { fonte: "recorrencias" },
      },
      confidence: 0.84,
      required_sources: ["recurrences"],
    }),
    need: need({
      data_sources: ["recurrences"],
      source_priority: ["recurrences"],
      aggregation: { type: "none", field: "valor" },
      expected_output: "list",
    }),
  },
  {
    id: "receita-total",
    mensagem: "Quanto recebi este mês?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: { metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "receita" },
      },
      confidence: 0.93,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: { tipos: ["receita"], periodo: { tipo: "mes_atual" } },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "mudanca-assunto-ifood",
    mensagem: "E o iFood?",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: { merchant: "iFood", metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.88,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          merchant: "iFood",
          tipos: ["despesa"],
          periodo: { tipo: "mes_atual" },
        },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "greet",
    mensagem: "Oi, tudo bem?",
    context: vazio(),
    understanding: und({
      goal: "greet",
      confidence: 0.99,
      required_sources: [],
    }),
    need: null,
  },
  {
    id: "confirm-sim",
    mensagem: "Sim",
    context: contextoComConfirmacao(),
    understanding: und({
      goal: "confirm",
      confidence: 0.97,
      required_sources: [],
    }),
    need: null,
  },
  {
    id: "clarify-sem-conta",
    mensagem: "Gastei 40 no mercado",
    context: vazio(),
    understanding: und({
      goal: "clarify",
      question: {
        intent: "create",
        entities: { merchant: "mercado", amount: 40 },
        implicit_filters: { tipo: "despesa" },
        ambiguity: [{ field: "account", reason: "conta ou cartão não informado" }],
      },
      confidence: 0.75,
      required_sources: ["transactions", "accounts"],
    }),
    need: null,
  },
  {
    id: "period-shift-semana-personalizado",
    mensagem: "E na semana passada?",
    context: contextoAposConsultaUber(),
    dataAtual: DATA_ATUAL,
    understanding: und({
      goal: "continue",
      continuation: {
        type: "period_shift",
        reference: { type: "temporal", relative: "last_week" },
        inherits_from_previous: true,
      },
      confidence: 0.85,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          merchant: "Uber",
          tipos: ["despesa"],
          periodo: { tipo: "personalizado", de: "2026-08-16", ate: "2026-08-23" },
        },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "ref-posicional-primeiro",
    mensagem: "O primeiro foi pessoal",
    context: contextoListaTresUbers(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { value: { perfil: "pf" } } },
      continuation: {
        type: "entity_ref",
        reference: { type: "positional", index: 1 },
        inherits_from_previous: true,
      },
      explicit_references: [{ type: "positional", index: 1 }],
      confidence: 0.9,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ref-posicional-terceiro",
    mensagem: "O terceiro foi da empresa",
    context: contextoListaTresUbers(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { value: { perfil: "pj" } } },
      continuation: {
        type: "entity_ref",
        reference: { type: "positional", index: 3 },
        inherits_from_previous: true,
      },
      explicit_references: [{ type: "positional", index: 3 }],
      confidence: 0.88,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ref-merchant-ifood",
    mensagem: "Corrige o iFood para 45",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "update",
        entities: { merchant: "iFood", amount: 45 },
      },
      continuation: {
        type: "entity_ref",
        reference: { type: "merchant", name: "iFood" },
        inherits_from_previous: true,
      },
      confidence: 0.86,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ref-anaforica-anterior",
    mensagem: "O anterior foi pessoal",
    context: ConversationContextSchema.parse({
      ...contextoListaTresUbers(),
      focused_entity: null,
    }),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { value: { perfil: "pf" } } },
      continuation: {
        type: "entity_ref",
        reference: { type: "anaphoric", pronoun: "previous" },
        inherits_from_previous: true,
      },
      confidence: 0.8,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "ambiguidade-dois-ifoods",
    mensagem: "Corrige o iFood",
    context: contextoAposConsultaUber(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { merchant: "iFood" } },
      ambiguity: [{ field: "merchant", reason: "2 iFoods no último resultado" }],
      confidence: 0.68,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "of-update-fato",
    mensagem: "Muda o valor do lançamento do banco para 80",
    context: contextoOfUber(),
    understanding: und({
      goal: "execute",
      question: { intent: "update", entities: { amount: 80 } },
      continuation: {
        type: "entity_ref",
        reference: { type: "anaphoric", pronoun: "that" },
        inherits_from_previous: true,
      },
      confidence: 0.84,
      required_sources: ["transactions"],
    }),
    need: null,
  },
  {
    id: "of-conhecimento-permitido",
    mensagem: "Classifica o lançamento do banco como lazer",
    context: contextoOfUber(),
    understanding: und({
      goal: "execute",
      question: {
        intent: "update",
        entities: { category: "Lazer", value: { categoriaId: CATEGORIA_LAZER } },
      },
      continuation: {
        type: "entity_ref",
        reference: { type: "anaphoric", pronoun: "that" },
        inherits_from_previous: true,
      },
      confidence: 0.83,
      required_sources: ["transactions", "categories"],
    }),
    need: null,
  },
  {
    id: "consulta-pix-ontem-mercado-pago",
    mensagem: "quanto eu enviei de pix ontem da minha conta mercado pago?",
    context: vazio(),
    dataAtual: DATA_ATUAL,
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: {
          merchant: "pix",
          account: "Mercado Pago",
          metric: "sum",
          period: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" },
        },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.92,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          merchant: "pix",
          contaNome: "Mercado Pago",
          tipos: ["despesa"],
          periodo: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" },
        },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "consulta-fluxo-pessoal-empresa",
    mensagem: "quanto tive de gastos pessoais na conta da empresa esse mes?",
    context: vazio(),
    understanding: understandingFluxoPessoalEmpresa(),
    need: needFluxoPessoalEmpresa(),
  },
  {
    id: "consulta-fluxo-usei-pj-coisa-minha",
    mensagem: "o que eu usei da PJ pra coisa minha esse mes?",
    context: vazio(),
    understanding: understandingFluxoPessoalEmpresa(0.9),
    need: needFluxoPessoalEmpresa(),
  },
  {
    id: "consulta-fluxo-empresa-pagou-minhas-coisas",
    mensagem: "quanto a empresa pagou das minhas coisas?",
    context: vazio(),
    understanding: understandingFluxoPessoalEmpresa(0.89),
    need: needFluxoPessoalEmpresa(),
  },
  {
    id: "consulta-extrato-conta-empresa",
    mensagem: "quanto gastei na conta da empresa esse mes?",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: { metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa", origemPerfil: "pj" },
      },
      confidence: 0.9,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          tipos: ["despesa"],
          periodo: { tipo: "mes_atual" },
          origemPerfil: "pj",
        },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
  {
    id: "consulta-pf-mercado-pago",
    mensagem: "despesas PF no Mercado Pago",
    context: vazio(),
    understanding: und({
      goal: "answer",
      question: {
        intent: "total",
        entities: { account: "Mercado Pago", metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa", tipoGasto: "pf" },
      },
      confidence: 0.9,
      required_sources: ["transactions"],
    }),
    need: need({
      data_sources: ["transactions"],
      source_priority: ["transactions"],
      filters: {
        transactions: {
          contaNome: "Mercado Pago",
          tipos: ["despesa"],
          periodo: { tipo: "mes_atual" },
          perfil: "pf",
        },
      },
      aggregation: { type: "sum", field: "valor" },
      expected_output: "single_value",
    }),
  },
];
