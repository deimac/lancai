# REAVALIAÇÃO CRÍTICA FINAL — ARQUITETURA DEFINITIVA LANÇAI ASSISTENTE 2.0

> **Data:** 2024
> **Status:** Aprovado para implementação
> **Princípio:** *Menor arquitetura capaz de interpretar conversas complexas de forma confiável*

---

## RESUMO EXECUTIVO

Após análise profunda de **6 repositórios de referência** (Stately Agent, Simulacra, Reservation-Agent, AutoTOD, alphaXiv Agents, Google Task-Oriented Dialogue) e reavaliação crítica das arquiteturas anteriores, chegamos a uma conclusão definitiva:

> **A arquitetura anterior (Fase 1 original + "corrigida") ainda dependia de atalhos determinísticos (regex) como inteligência principal.** O LLM era apenas fallback.

**A arquitetura definitiva elimina atalhos semânticos completamente.** O LLM entende UMA VEZ no início. Todo o resto é determinístico. Capacidades generalizam. Atalhos memorizam.

---

## O QUE A ARQUITETURA ANTERIOR TINHA CERTO (MANTENHA)

| Componente | Por que manter |
|------------|----------------|
| **Core Financeiro como autoridade** | `MotorFinanceiro` / `ServicoConhecimento` decidem validade; LLM nunca escreve direto |
| **PolicyEngine** | Regras de segurança corretas: 3 níveis (`none`/`confirm`/`blocked`) + OF blocks absolutos |
| **ReferenceResolver** | Pipeline determinístico (positional/temporal/value/merchant/anaphoric) funciona |
| **SimpleCommand Handlers** | 6 comandos atômicos (`create/update/cancel/query/recurrence/rule`) corretos |
| **ApplicationService** | Transação, idempotência, auditoria, re-validação corretas |
| **Core Financeiro Authority** | Princípio inegociável: LLM nunca escreve no banco |
| **Idempotência (messageId + idempotencyKey)** | Crítico para WhatsApp |
| **Optimistic Locking Session** | Concorrência resolvida |
| **Feature Flags + Shadow Mode** | Migração segura |
| **ConversationState minimal** | Base para referências, queries encadeadas, multi-turno |

---

## O QUE ESTÁ ERRADO E DEVE SER REMOVIDO

| Componente | Por que remover | Substituto |
|------------|-----------------|------------|
| **SemanticParser** | 50+ regexes = inteligência semântica disfarçada | **ConversationUnderstanding (LLM puro)** |
| **UserRequest** | Contrato confuso misturando intent + operation + refs | **ConversationUnderstanding + InformationNeed + QueryPlan/CommandPlan** |
| **ReferenceExtractor** | Referências extraídas DEPOIS do parser (tarde demais) | Referências extraídas NO Understanding |
| **ContextBuilder** | Decide contexto baseado em `request.op/resource` (tarde demais) | ContextBuilder usa `ConversationContext` (topic, goal, last_query) |
| **Planner obrigatório + OperationPlan p/ tudo** | 90% = 1 comando; planner só para compostas reais | **QueryPlanner + CommandPlanner determinísticos** |
| **Executor + Tool Registry + Tools** | Tools = adaptadores p/ LLM; internamente = CoreCommands | **ApplicationService.executeCommand()** |
| **FinanceApplicationService (wrapper)** | Core já tem transação, auditoria, idempotência | Responsabilidades distribuídas |
| **MerchantMemory / aprendizado implícito** | MVP acerta básico primeiro | Pós-MVP |
| **Scores configuráveis / CandidateRanker** | Thresholds fixos são mais seguros | `resolve()` retorna `Resolved \| Ambiguous \| NotFound` |
| **ResultSet versioning/stale/invalidation** | Verifica na execução | `lastResultSet` + re-validação |
| **ConversationState inchado (12 campos)** | 6 essenciais | `ConversationContext` (topic, goal, active_query, focused_entity, topic_history) |
| **Scores configuráveis / CandidateRanker complexo** | Thresholds fixos são mais seguros | `resolve()` retorna `Resolved \| Ambiguous \| NotFound` |

---

## A ARQUITETURA DEFINITIVA

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LANÇAI ASSISTENTE 2.0 — ARQUITETURA FINAL               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MENSAGEM (Web/WA)                                                          │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SESSION MANAGER                                                     │   │
│  │  (lock por sessão + optimistic version, carrega ConversationContext)│   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CONVERSATION UNDERSTANDING (LLM PURO — ÚNICA CHAMADA LLM)         │   │
│  │  Input: mensagem + ConversationContext + histórico (8 turnos)      │   │
│  │  Output: ConversationUnderstanding                                 │   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  UNDERSTANDING → NEED (DETERMINÍSTICO — REGRAS PURO)               │   │
│  │  ConversationUnderstanding → InformationNeed                       │   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  QUERY/COMMAND PLANNER (DETERMINÍSTICO)                            │   │
│  │  InformationNeed → QueryPlan OU CommandPlan                        │   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  POLICY ENGINE (REGRAS DETERMINÍSTICAS)                            │   │
│  │  Regras: none / confirm / blocked + OF blocks absolutos            │   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│               ┌────────┴────────┐                                         │
│               ▼                 ▼                                         │
│        Simple Command        Compound Plan                                │
│               │                 │                                         │
│               └────────┬────────┘                                         │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  APPLICATION SERVICE                                                │   │
│  │  executeCommand(cmd, ctx)                                          │   │
│  │  - injeta userId, idempotencyKey, traceId                          │   │
│  │  - inicia transação                                                │   │
│  │  - chama Core (MotorFinanceiro / ServicoConhecimento)             │   │
│  │  - auditoria automática                                            │   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CORE FINANCEIRO (MotorFinanceiro / ServicoConhecimento)           │   │
│  │  Transação única por comando. Validação de fatoImutavel.           │   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  STATE UPDATER                                                       │   │
│  │  version++, invalida lastResultSet se movimento alterado,          │   │
│  │  atualiza ConversationContext (topic, goal, last_query, entity)    │   │
│  └─────────────────────┬──────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  RESPONSE GENERATOR (LLM)                                          │   │
│  │  Dados + Contexto → Resposta natural / Pergunta / Confirmação      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**4 camadas essenciais:** Understanding → Need → Plan → Execute → Core

---

## CONTRATOS PRINCIPAIS (Zod/TypeScript)

```typescript
// pacotes/tipos/src/assistente-v3.ts

// ============================================
// 1. CONVERSATION UNDERSTANDING (Saída do LLM)
// ============================================

export const ConversationUnderstandingSchema = z.object({
  // 1. OBJETIVO PRIMÁRIO
  goal: z.enum(["answer", "execute", "clarify", "confirm", "greet", "continue"]),
  
  // 2. PERGUNTA/INTENÇÃO
  question: z.object({
    intent: z.enum([
      "total", "list", "detail", "compare", "explain", "trend",
      "top", "breakdown", "projection", "create", "update", "delete"
    ]),
    entities: z.object({
      merchant: z.string().optional(),
      category: z.string().optional(),
      account: z.string().optional(),
      card: z.string().optional(),
      period: PeriodSpecSchema.optional(),
      metric: z.enum(["sum", "count", "avg", "max", "min", "balance", "available"]).optional(),
      computation: z.enum(["diff", "pct_change", "trend", "top_n", "breakdown", "explanation"]).optional(),
      amount: z.number().optional(),
      value: z.unknown().optional(), // para updates genéricos
    }).optional(),
    implicit_filters: z.object({
      tipo: z.enum(["receita", "despesa", "transferencia"]).optional(),
      fonte: z.enum(["transacoes", "recorrencias"]).optional(),
    }).optional(),
    ambiguity: z.array(AmbiguitySchema).optional(),
  }).optional(),
  
  // 3. CONTINUAÇÃO CONTEXTUAL
  continuation: z.object({
    type: z.enum(["period_shift", "filter_add", "filter_remove", "entity_ref", "correction", "detail_request", "filter_modify"]),
    reference: EntityReferenceSchema,
    inherits_from_previous: z.boolean(),
  }).optional(),
  
  // 4. REFERÊNCIAS EXPLÍCITAS
  explicit_references: z.array(EntityReferenceSchema).optional(),
  
  // 5. AMBIGUIDADE GLOBAL
  ambiguity: z.array(AmbiguitySchema).optional(),
  
  // 6. CONFIANÇA GLOBAL
  confidence: z.number().min(0).max(1),
  
  // 7. FONTES NECESSÁRIAS
  required_sources: z.array(z.enum(["transactions", "accounts", "cards", "recurrences", "categories"])),
});

export type ConversationUnderstanding = z.infer<typeof ConversationUnderstandingSchema>;

// ============================================
// 2. INFORMATION NEED (O que buscar)
// ============================================

export const InformationNeedSchema = z.object({
  data_sources: z.array(z.enum(["transactions", "accounts", "cards", "recurrences", "categories"])),
  filters: z.object({
    transactions: TransactionFiltersSchema.optional(),
    accounts: z.object({}).optional(),
    cards: z.object({}).optional(),
  }).optional(),
  aggregation: z.object({
    type: z.enum(["sum", "count", "avg", "max", "min", "none"]),
    field: z.string(),
    group_by: z.array(z.string()).optional(),
  }).optional(),
  computation: z.object({
    type: z.enum(["diff", "pct_change", "trend", "top_n", "breakdown", "explanation", "comparison"]),
    params: z.record(z.unknown()).optional(),
  }).optional(),
  expected_output: z.enum(["single_value", "list", "table", "comparison", "explanation", "chart"]),
  source_priority: z.array(z.string()),
});

export type InformationNeed = z.infer<typeof InformationNeedSchema>;

// ============================================
// 3. QUERY/COMMAND PLANS
// ============================================

export const QueryPlanSchema = z.object({
  type: z.literal("query"),
  spec: QuerySpecSchema,
  computation: z.object({
    type: z.enum(["none", "diff", "pct_change", "trend", "top_n", "breakdown", "explanation"]),
    params: z.record(z.unknown()).optional(),
  }).optional(),
});

export const CommandPlanSchema = z.object({
  type: z.literal("command"),
  steps: z.array(z.object({
    stepId: z.string(),
    command: SimpleCommandSchema,
    description: z.string(),
    dependsOn: z.array(z.string()).optional(),
  })),
});

export type ExecutionPlan = z.infer<typeof QueryPlanSchema> | z.infer<typeof CommandPlanSchema>;

// ============================================
// 4. SIMPLE COMMAND (ATÔMICO)
// ============================================

export const SimpleCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_transaction"), input: CreateTransactionInputSchema }),
  z.object({ type: z.literal("update_transaction"), input: UpdateTransactionInputSchema }),
  z.object({ type: z.literal("cancel_transaction"), input: CancelTransactionInputSchema }),
  z.object({ type: z.literal("query_transactions"), spec: QuerySpecSchema }),
  z.object({ type: z.literal("create_recurrence"), input: CreateRecurrenceInputSchema }),
  z.object({ type: z.literal("create_rule"), input: CreateRuleInputSchema }),
]);

// ============================================
// 5. CONVERSATION CONTEXT (Estado da conversa)
// ============================================

export const ConversationContextSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().nonnegative(),
  
  // Tópico ativo
  active_topic: z.object({
    domain: z.enum(["spending", "income", "balance", "cards", "accounts", "recurrences", "categories", "budget"]).optional(),
    entities: z.array(EntityRefSchema).optional(),
    metric: z.enum(["sum", "count", "balance", "available", "limit"]).optional(),
    period: PeriodSpecSchema.optional(),
  }).nullable(),
  
  // Objetivo atual
  active_goal: z.enum(["explore", "analyze", "execute", "correct", "configure"]).nullable(),
  
  // Última consulta executada
  last_query: z.object({
    information_need: InformationNeedSchema,
    query_spec: QuerySpecSchema,
    result_ids: z.array(z.string().uuid()),
    result_summary: QueryResultSummarySchema,
    expires_at: z.number().int().positive(),
  }).optional(),
  
  // Entidade em foco
  focused_entity: EntityRefSchema.nullable(),
  
  // Ação pendente
  pending_action: z.object({
    type: z.enum(["confirmation", "clarification", "slot_fill"]),
    payload: z.unknown(),
  }).nullable(),
  
  // Histórico de tópicos
  topic_history: z.array(z.object({
    topic: z.object({ domain: z.string(), entities: z.array(EntityRefSchema) }),
    goal: z.string(),
    started_at: z.number().int().positive(),
  })).max(10),
  
  // Preferências para este tópico
  topic_preferences: z.object({
    default_period: PeriodSpecSchema.optional(),
    default_account: EntityRefSchema.optional(),
    default_card: EntityRefSchema.optional(),
  }).optional(),
  
  // Metadados
  version: z.number().int().nonnegative(),
  updated_at: z.number().int().positive(),
});

export type ConversationContext = z.infer<typeof ConversationContextSchema>;
```

---

## FLUXOS REAIS DEMONSTRADOS

### Fluxo 1: Criação + Correção de Data
```
U: "Gastei 50 no Uber no Nubank"
→ Understanding: {goal:"execute", question:{intent:"create", entities:{merchant:"Uber", valor:50, contaId:"nubank_id", tipo:"despesa"}}}
→ Need: {sources:["transactions"], filters:{merchant:"Uber", tipo:"despesa"}, aggregation:{type:"sum", field:"valor"}}
→ Plan: CommandPlan {steps:[{type:"create_transaction", input:{...}}]}
→ Policy: confirm=true
→ Assistant: "Confirmar: R$ 50 no Uber no Nubank?"
U: "Sim"
→ executeCommand(create_transaction) → Core valida conta manual
→ State: version++; currentEntity=mov_123
→ Response: "Lançado: Uber R$ 50 no Nubank."

U: "Foi ontem"
→ Understanding: {continuation:{type:"temporal", reference:{type:"temporal", relative:"yesterday"}, inherits:true}}
→ ResolvedRequest: update mov_123, fatoPatch={dataMovimento:"2026-08-22"}
→ Policy: blocked (update fato) → confirm
U: "Sim" → Core recalcula saldos AMBAS contas em transação única
```

### Fluxo 2: Consulta + Referência Posicional
```
U: "Quanto gastei com Uber?" → query → lastResultSet={ids:[mov_1, mov_2, mov_3]}
U: "O segundo foi pessoal" → positional index=2 → mov_2
→ update conhecimento {perfil:"pj"} → confirm
```

### Fluxo 3: Correção Multi-campo
```
U: "Corrige aquele almoço para 80 no Itaú"
→ Understanding: {goal:"execute", question:{intent:"update", entities:{valor:80, contaId:"itau_id"}}, continuation:{type:"anaphoric"}}
→ anaphoric → currentEntity=mov_almoco
→ fatoPatch={valor:80, contaId:itau_id} → UMA transação Core
→ Policy: blocked → confirm
U: "Sim" → Core recalcula saldos AMBAS contas em transação única
```

### Fluxo 4: Ambiguidade
```
U: "Corrige o Uber"
→ 3 Ubers no lastResultSet → Ambiguous[candidates:3]
→ Response numerada: "1. R$ 42 (21/08) 2. R$ 35 (19/08) 3. R$ 62 (18/08)"
U: "2" → positional resolve → fluxo normal
```

### Fluxo 5: Open Finance (Proteção Absoluta)
```
U: "Apaga aquele lançamento do banco"
→ Resolver: currentEntity=mov_of (fonte=open_finance, fatoImutavel=true)
→ Policy: isOFDelete → blocked=true
→ Response: "Esse lançamento veio do banco. Não posso apagar. Posso marcar 'não considera nos relatórios'."
```

### Fluxo 6: Consulta Encadeada
```
U: "Quanto gastei com Uber?" → query → lastResultSet
U: "E mês passado?" → continuation.period_shift → herda merchant="Uber", period="last_month"
U: "E no cartão?" → continuation.filter_add → adiciona cartaoId
```

### Fluxo 7: Computação + Explicação
```
U: "Estou gastando mais que mês passado?"
→ Understanding: {goal:"answer", question:{intent:"compare", entities:{metric:"sum", period:"current_month", computation:"diff", breakdown_by:"category"}}}
→ Need: {sources:["transactions"], computation:{type:"diff", params:{group_by:"category"}}}
→ QueryPlan: 2 queries (mês atual + mês anterior) + ComputationPlan: diff + pct_change + breakdown
→ ComputationEngine: current - previous, pct_change, breakdown by category
→ Response: "Sim, +15% (R$ 450 a mais). Principal: Alimentação +R$ 200, Transporte +R$ 150."
```

---

## MÉTRICAS DE SUCESSO

```typescript
interface UnderstandingMetrics {
  goal_accuracy: number;           // target: > 0.95
  entity_accuracy: number;         // target: > 0.90
  ambiguity_detection: { precision: number; recall: number }; // target: recall > 0.95
  source_selection_accuracy: number; // target: > 0.95
  information_need_accuracy: number; // target: > 0.90
  wrong_action_rate: number;       // target: 0
  generalization_rate: number;     // target: > 0.80
}

interface GeneralizationMetrics {
  semantic_capabilities_count: number;
  capability_coverage: Record<string, { test_cases_total: number; passing_without_shortcuts: number; generalization_rate: number }>;
  overall_generalization_rate: number; // target: > 0.80
  shortcuts_removed: number;
  capabilities_vs_shortcuts_ratio: number; // target: > 3
}
```

---

## SUÍTE DE TESTES CRÍTICOS (35 Conversas)

| Categoria | Casos | Capacidade Testada |
|-----------|-------|-------------------|
| Criação | 5 | Campos obrigatórios, conta/cartão, forma pagamento, parcelamento, transferência |
| Consulta | 5 | Filtros, paginação, "detalhado" |
| Referência Posicional | 3 | "o segundo", "o terceiro", "o primeiro" |
| Referência Temporal | 3 | "o de ontem", "o da semana passada", "o de julho" |
| Referência Merchant | 3 | "o Uber", "o iFood", ambíguo (3 Ubers) |
| Referência Anaforica | 2 | "aquele", "o anterior" |
| Correção Fato | 3 | valor, data, conta — todos com confirmação |
| Correção Conhecimento | 2 | categoria, perfil, tag |
| Cancelamento | 2 | manual (confirma), OF (bloqueia + oferece hide) |
| Ambiguidade | 2 | múltiplos candidatos → pergunta numerada |
| Concorrência | 2 | Web+WA simultâneo, mensagem duplicada WA |
| Open Finance | 2 | update fato bloqueado, delete bloqueado, conhecimento permitido |
| Computação | 3 | diff, pct_change, breakdown, trend |
| Continuidade | 5 | mudança de assunto, correção de contexto |

---

## POLÍTICA ANTI-ATALHO (OBRIGATÓRIA NO CI)

```typescript
// CI roda isto antes de merge
function validateNoSemanticShortcut(newShortcut: Shortcut): ValidationResult {
  const semanticPatterns = [
    /quanto\s+(gastei|recebi|entrei|sa[ií])/,
    /gastei\s+\d+/,
    /corrig(e|a)\s+(o|a)\s+\w+/,
    /(todo\s+m[êe]s|mensalmente|recorrente)/,
    /n[ãa]o\s+considera/,
    /qual\s+(foi|foi\s+a|era)\s+a\s+\w+/,
  ];
  
  if (semanticPatterns.some(p => p.test(newShortcut.pattern))) {
    return {
      valid: false,
      reason: "SHORTCUT_SEMANTICO_PROIBIDO",
      message: "Atalhos não podem codificar inteligência semântica. Corrija o ConversationUnderstanding.",
      required_fix: "Adicione capacidade ao ConversationUnderstanding LLM prompt ou regras determinísticas no UnderstandingToNeed."
    };
  }
  return { valid: true };
}
```

---

## CRONOGRAMA DE IMPLEMENTAÇÃO (FASE 1 DEFINITIVA)

| Semana | Entregável |
|--------|------------|
| 1 | Migration `ConversationContext` + Types (`ConversationUnderstanding`, `InformationNeed`, `QueryPlan`, `CommandPlan`) |
| 2 | `UnderstandingExtractor` (LLM puro) + Prompt engineering + Testes de understanding accuracy |
| 3 | `UnderstandingToNeed` (determinístico) + `InformationNeedExtractor` + `QueryPlanner` + `CommandPlanner` |
| 4 | `ReferenceResolver` integrado no pipeline + `ConversationContext` + `ContextUpdater` |
| 5 | Integração completa: Understanding → Need → Plan → Policy → Executor |
| 6 | Feature flags + Shadow mode + Migração incremental |
| 7 | Testes: 35 conversas críticas + Understanding Accuracy + Generalization Rate |

**Total: 7 semanas** — resolve o problema raiz.

---

## DECISÃO FINAL

> **A arquitetura anterior (Fase 1 original E a "corrigida") ainda tratava atalhos como inteligência.**
>
> **A arquitetura definitiva elimina atalhos semânticos completamente.**
>
> **O LLM entende UMA VEZ no início. Todo o resto é determinístico.**
>
> **Capacidades generalizam. Atalhos memorizam.**

**Esta é a arquitetura que deve ser implementada.**

---

*Fim do documento — Arquitetura Assistente 2.0 aprovada para implementação.*