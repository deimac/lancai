# LançAI Assistente 2.0 — Arquitetura Definitiva

> **Versão:** 1.0  
> **Data:** 2026-08-23  
> **Status:** Aprovado para implementação  
> **Princípio:** *Segurança financeira > elegância arquitetural. Cada camada tem responsabilidade única. Se só repassa dados, não existe.*

---

## 1. Resumo Executivo

O Assistente 2.0 substitui o pipeline atual (`processar-turno-conversa.ts`) por uma arquitetura **direta, segura e testável** de 4 camadas essenciais:

```
Semantic Parser → Reference Resolver → Policy Engine → Executor → Core Financeiro
```

**Zero framework de agente.** Zero camadas que só repassam dados. O foco é: entender a mensagem, resolver referências, validar segurança, executar um comando atômico no Core, responder.

---

## 2. Princípios Fundamentais

| Princípio | Aplicação |
|-----------|-----------|
| **Core Financeiro é autoridade** | `MotorFinanceiro` / `ServicoConhecimento` decidem validade; LLM nunca escreve direto |
| **Segurança determinística** | Policy Engine com 3 regras: `none` / `confirmation_required` / `blocked` + OF blocks absolutos |
| **Referências determinísticas** | Positional, temporal, value, merchant, anaphoric = código; LLM fallback **não existe** |
| **Idempotência em 2 níveis** | `messageId` (turno) + `idempotencyKey` (operação financeira) |
| **Estado mínimo** | `ConversationState` com 6 campos; nada de defaults perigosos |
| **Comandos atômicos** | 1 comando = 1 transação Core; OperationPlan só para compostas reais |
| **Testabilidade** | Cada camada pura, testável unitariamente; WAR como métrica norte |
| **Migração incremental** | Feature flags, shadow mode, canary, rollback imediato |

---

## 3. Arquitetura Final

```
┌─────────────────────────────────────────────────────────────────┐
│                    LANÇAI ASSISTENTE 2.0                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MENSAGEM (Web/WA)                                              │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────┐                                        │
│  │  SESSION MANAGER    │  ← Lock por sessão + optimistic version│
│  │  (carrega State)    │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────┐                                        │
│  │  SEMANTIC PARSER    │  ← Atalhos determinísticos + LLM       │
│  │  → UserRequest      │     Retorna UserRequest com references │
│  └──────────┬──────────┘     já estruturadas                     │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────┐                                        │
│  │  REFERENCE RESOLVER │  ← Pipeline: positional→temporal→      │
│  │  (pipeline 5 estágios)   merchant→anaphoric→composite       │
│  │  → ResolvedRequest  │     SEM LLM fallback; ambíguo = ask    │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────┐                                        │
│  │  POLICY ENGINE      │  ← Regras determinísticas:             │
│  │  → PolicyDecision   │     none / confirm / blocked           │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│      ┌──────┴──────┐                                            │
│      ▼             ▼                                            │
│  Simple          Compound                                       │
│  Command          Plan                                           │
│      │             │                                            │
│      └──────┬──────┘                                            │
│             ▼                                                    │
│  ┌─────────────────────┐                                        │
│  │  APPLICATION        │  ← executeCommand(cmd, ctx)            │
│  │  SERVICE            │     - injeta userId, idempotencyKey    │
│  │                     │     - inicia transação                 │
│  │                     │     - chama Core (MotorFinanceiro)     │
│  │                     │     - auditoria automática             │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────┐                                        │
│  │  CORE FINANCEIRO    │  ← MotorFinanceiro / ServicoConhec.    │
│  │  (Authority)        │     Transação única por comando        │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────┐                                        │
│  │  STATE UPDATER      │  ← version++, invalida lastResultSet   │
│  │                     │     se movementId alterado             │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────┐                                        │
│  │  RESPONSE GENERATOR │                                        │
│  └─────────────────────┘                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Contratos Principais

### 4.1 UserRequest (Contrato Canônico)

```typescript
// pacotes/tipos/src/assistente-v2.ts

interface UserRequest {
  op: "create" | "update" | "delete" | "query" | "classify";
  resource: "transaction" | "recurrence" | "rule" | "account" | "card";
  params: TransactionParams | RecurrenceParams | RuleParams | QuerySpec;
  references?: {
    target?: EntityReference;
    account?: EntityReference;
    card?: EntityReference;
    category?: EntityReference;
  };
  meta?: { source: "shortcut" | "llm" | "multimodal"; confidence: number };
}

type EntityReference =
  | { type: "positional"; index: number }
  | { type: "temporal"; relative: "today" | "yesterday" | "last_week" | "this_month" | "last_month" | string }
  | { type: "value"; amount: number }
  | { type: "merchant"; name: string }
  | { type: "anaphoric"; pronoun: "that" | "last" | "previous" }
  | { type: "composite"; parts: EntityReference[] };
```

### 4.2 ResolvedRequest

```typescript
interface ResolvedRequest {
  request: UserRequest;
  resolved: {
    target?: EntityRef;
    account?: EntityRef;
    card?: EntityRef;
    category?: EntityRef;
  };
  semanticConfidence: number;
}
```

### 4.3 ConversationState (Mínimo)

```typescript
interface ConversationState {
  schemaVersion: 1;
  version: number;                              // optimistic lock
  lastResultSet?: { ids: string[]; query: QuerySpec; expiresAt: number };
  currentEntity?: EntityRef;                    // última entidade RESOLVIDA explicitamente
  pendingConfirmation?: ConfirmationRequest;
  explicitPeriod?: PeriodSpec;                  // se usuário disse "mês passado"
  userPreferencesRef: UserPreferencesRef;
}

interface EntityRef {
  id: string;
  type: "transaction" | "account" | "card" | "recurrence" | "rule" | "category";
  label: string;
  metadata?: Record<string, unknown>;
}
```

### 4.4 PolicyDecision

```typescript
type RiskLevel = "none" | "confirmation_required" | "blocked";

interface PolicyDecision {
  allowed: boolean;
  risk: RiskLevel;
  confirm: boolean;
  reason: "risk" | "of_fato_immutable" | "of_cannot_delete" | "ambiguity" | "auto";
  message?: string;
}
```

### 4.5 SimpleCommand (Atômico)

```typescript
type SimpleCommand =
  | { type: "create_transaction"; input: CreateTransactionInput }
  | { type: "update_transaction"; movementId: string; fatoPatch?: FatoPatch; conhecimentoPatch?: ConhecimentoPatch }
  | { type: "cancel_transaction"; movementId: string }
  | { type: "query_transactions"; spec: QuerySpec }
  | { type: "create_recurrence"; input: CreateRecurrenceInput }
  | { type: "create_rule"; input: CreateRuleInput };
```

### 4.6 CommandContext

```typescript
interface CommandContext {
  authenticatedUserId: string;
  sessionId: string;
  idempotencyKey: string;      // UUID por comando
  traceId: string;
  stateVersion: number;        // para re-validação
}
```

---

## 5. Pipeline Detalhado

### 5.1 Semantic Parser
- **Atalhos determinísticos** (regex) para 80% dos casos: lançamento, consulta, correção, orçamento, recorrência, enriquecimento
- **LLM fallback** apenas para casos complexos
- **Saída:** `UserRequest` com `references` já estruturadas (não strings soltas)

### 5.2 Reference Resolver (Pipeline 5 Estágios)

```typescript
const RESOLUTION_PIPELINE = [
  { name: "positional",   resolver: resolvePositional,   applies: isPositional },    // "o segundo"
  { name: "temporal",     resolver: resolveTemporal,     applies: isTemporal },      // "o de ontem"
  { name: "value",        resolver: resolveValue,        applies: isValueRef },      // "o de 50"
  { name: "merchant",     resolver: resolveMerchant,     applies: isMerchantRef },   // "o Uber"
  { name: "anaphoric",    resolver: resolveAnaphoric,    applies: isAnaphoric },     // "aquele"
  // composite é decomposto nos estágios acima
];
```

**Regras:**
- Curto-circuito: se resolve com confiança alta → retorna
- Ambíguo (múltiplos candidatos próximos) → `ask` (pergunta numerada)
- Nenhum candidato → `ask`
- **SEM LLM fallback** — ambiguidade resulta em pergunta, não em chute

### 5.3 Policy Engine (Determinístico)

```typescript
function evaluatePolicy(request: ResolvedRequest): PolicyDecision {
  // 1. BLOQUEIOS ABSOLUTOS
  if (isOFMutation(request)) return { allowed: false, reason: "of_fato_immutable" };
  if (isOFDelete(request)) return { allowed: false, reason: "of_cannot_delete" };
  
  // 2. CLASSIFICAÇÃO DE RISCO (3 níveis)
  const risk = classifyRisk(request);
  
  // 3. DECISÃO
  switch (risk) {
    case "none": return { allowed: true, confirm: false };
    case "confirmation_required": return { allowed: true, confirm: true, reason: "risk" };
    case "blocked": return { allowed: false, reason: "blocked_by_policy" };
  }
}

function classifyRisk(request: ResolvedRequest): RiskLevel {
  if (request.op === "query" || request.op === "classify") return "none";
  if (request.op === "create" && request.resource === "transaction") return "confirmation_required";
  if (request.op === "update" && request.resource === "transaction") {
    const fatoFields = ["valor", "dataMovimento", "contaId", "cartaoId", "tipo"];
    return fatoFields.some(k => k in request.params) ? "blocked" : "confirmation_required";
  }
  if (request.op === "delete") return "blocked";
  return "confirmation_required";
}
```

### 5.4 Executor

```typescript
// Simple Command (90% dos casos)
async function executeSimpleCommand(cmd: SimpleCommand, ctx: CommandContext) {
  return applicationService.executeCommand(cmd, ctx);
}

// Compound Plan (apenas operações compostas reais)
async function executeCompoundPlan(plan: CompoundPlan, ctx: CommandContext) {
  for (const step of plan.steps) {
    await applicationService.executeCommand(step, ctx);
    // Se falha: para; Core já é atômico por step
  }
}
```

---

## 6. Segurança Financeira (Matriz Final)

| Operação | Risco | Auto? | Confirma? | Bloqueio Core |
|----------|-------|-------|-----------|---------------|
| Query (qualquer) | none | Sim | Não | — |
| Create transaction (completo) | low | Sim | **Sim** | Valida conta/cartão manual |
| Create transaction (slots faltando) | low | Não (ask_info) | — | — |
| Update Conhecimento (tags, obs, ignorado) | low | Sim | Não | Sempre permitido |
| Update Conhecimento (categoria) | low | Sim | **Sim** (1ª vez) | `classificado_por=usuario` não sobrescrito |
| Update Conhecimento (perfil) | medium | Sim | **Sim** | Afeta relatórios PF/PJ |
| Update Fato (valor, data, conta, cartão) | high | **Não** | **Sim** | **Bloqueia se `fatoImutavel`** |
| Update Fato (múltiplos campos) | high | **Não** | **Sim** (1x p/ todos) | **Bloqueia se `fatoImutavel`** |
| Delete/Cancel transaction | critical | **Não** | **Sim** | **Bloqueia se `fatoImutavel`** |
| Create recurrence | medium | Não | **Sim** | Valida dia 1-31, conta manual |
| Create rule | low | Não | **Sim** | `ServicoConhecimento` |

**Regra de Ouro:** Em caso de dúvida entre "arquitetura elegante" e "não permitir alteração financeira indevida", **sempre escolha a segunda**.

---

## 7. Idempotência & Concorrência

| Nível | Chave | Onde | Escopo |
|--------|-------|------|--------|
| Mensagem | `messageId` (WA) / `requestId` (Web) | SessionManager | Turno de conversa |
| Operação | `idempotencyKey` (UUID por comando) | ApplicationService | Comando atômico |

**Concorrência:**
- Lock por sessão (Redis/Postgres advisory lock)
- Optimistic version no `ConversationState`
- Processamento sequencial por sessão
- Deduplicação de `messageId` no WhatsApp

---

## 8. Componentes MVP (Obrigatórios)

| # | Componente | Critério Pronto |
|---|------------|-----------------|
| 1 | **SessionManager** | Lock por sessão, optimistic version, carrega/salva state |
| 2 | **SemanticParser v2** | 100% atalhos atuais cobertos; LLM só casos complexos |
| 3 | **ReferenceResolver** | 30 casos: ≥95% resolvidos ou ask correto |
| 4 | **PolicyEngine** | Zero execução indevida em staging |
| 5 | **SimpleCommand Handlers** | Todos atalhos atuais funcionam |
| 6 | **ApplicationService.executeCommand()** | Idempotência funciona; Core valida tudo |
| 7 | **StateUpdater** | Estado nunca stale |
| 8 | **AssistenteCore** | Lado a lado com legado; feature flag `use_v2` |
| 9 | **Testes WAR** | WAR = 0 em staging |

**Fora do MVP:** CompoundPlan, MerchantMemory, ContextBuilder avançado, LLM fallback, métricas de tokens, dashboard.

---

## 9. Testes de Aceitação (Baseados em WAR)

### Suite Mínima (30 Conversas Críticas)

| Categoria | Casos | Valida |
|-----------|-------|--------|
| Criação | 5 | Campos obrigatórios, conta/cartão correto, forma pagamento, parcelamento, transferência |
| Consulta | 5 | Filtros, paginação ("mais"), "detalhado" |
| Referência Posicional | 3 | "o segundo", "o terceiro", "o primeiro" |
| Referência Temporal | 3 | "o de ontem", "o da semana passada", "o de julho" |
| Referência Merchant | 3 | "o Uber", "o iFood", ambíguo (3 Ubers) |
| Referência Anafórica | 2 | "aquele", "o anterior" |
| Correção Fato | 3 | valor, data, conta — todos com confirmação |
| Correção Conhecimento | 2 | categoria, perfil, tag |
| Cancelamento | 2 | manual (confirma), OF (bloqueia + oferece hide) |
| Ambiguidade | 2 | múltiplos candidatos → pergunta numerada |
| Concorrência | 2 | Web+WA simultâneo, mensagem duplicada WA |
| Open Finance | 2 | update fato bloqueado, delete bloqueado, conhecimento permitido |

**Critério GO:** WAR = 0 em todos os 30 casos + 0 falsos positivos em 100 casos adversariais.

---

## 10. GO / NO-GO (Critérios Produção)

| Métrica | GO | NO-GO |
|---------|-----|-------|
| **Wrong Action Rate** | 0 em 30 dias | > 0 em qualquer dia |
| **Latência p95** | < 3s | > 5s |
| **Taxa de esclarecimento** | 10-25% | > 40% ou < 5% |
| **Regressão funcional** | 0 (suite 16-ASSISTENTE passa) | Qualquer falha |
| **Concorrência** | 0 race conditions em 1M turnos | 1+ race condition |
| **Idempotência** | 0 duplicatas em 10k msgs WA duplicadas | 1+ duplicata financeira |

---

## 11. Migração Incremental (Sem Parar Sistema)

| Etapa | Ação | Feature Flag | Rollback |
|-------|------|--------------|----------|
| 1 | Migration `ConversationState` + SessionManager | `use_v2_session` | Desliga flag |
| 2 | SemanticParser v2 | `use_v2_parser` | Parser antigo roda em paralelo |
| 3 | ReferenceResolver pipeline | `use_v2_resolver` | Testa 30 casos |
| 4 | PolicyEngine + SimpleCommands | `use_v2_execute` | Shadow mode 1 semana |
| 5 | ApplicationService + Core | `use_v2_core` | Canary 5% users |
| 6 | AssistenteCore orquestra tudo | `use_v2_assistant` | Gradual 10%→50%→100% |
| 7 | Desligar legado | `use_v2_assistant=false` | Monitora 48h |

**Troca definitiva:** WAR=0 em produção por 7 dias + latência p95 < 3s + 0 regressões.

---

## 12. Fluxos Reais Demonstrados

### F1: Criar Lançamento
```
U: "Gastei 50 no Uber no Nubank"
→ Parser (atalho): UserRequest{create, transaction, params:{valor:50, descricao:"Uber", contaId:nubank_id}}
→ Policy: confirm=true → "Confirmar: R$ 50 no Uber no Nubank?"
U: "Sim" → executeCommand(create_transaction) → Core valida conta manual
→ Response: "Lançado: Uber R$ 50 no Nubank."
```

### F2: Consulta + Referência Posicional
```
U: "Quanto gastei com Uber?" → query → lastResultSet={ids:[1,2,3]}
U: "O segundo foi pessoal" → positional index=2 → mov_2
→ Policy: confirm=true → "Marcar Uber R$ 35 como PJ?"
U: "Sim" → executeCommand(update_transaction, {movementId:mov_2, conhecimentoPatch:{perfil:"pj"}})
```

### F3: Correção Multi-campo (Mesmo Recurso)
```
U: "Corrige aquele almoço para 80 no Itaú"
→ anaphoric → currentEntity=mov_almoco
→ fatoPatch={valor:80, contaId:itau_id} → UMA transação Core
→ Policy: blocked (update fato) → confirm
U: "Sim" → Core recalcula saldos AMBAS contas em transação única
```

### F4: Ambiguidade
```
U: "Corrige o Uber" → 3 candidatos → Response numerada
U: "2" → positional resolve → fluxo normal
```

### F5: Open Finance (Proteção Absoluta)
```
U: "Apaga aquele lançamento do banco"
→ Policy: isOFDelete → blocked
→ Response: "Esse lançamento veio do banco. Não posso apagar. Posso esconder dos relatórios."
```

### F6: Mensagem Duplicada WA
```
WA entrega 2x → SessionManager vê messageId já processado → ignora, retorna cache
```

### F7: Concorrência Web + WA
```
Lock por sessão → ordem determinística → version++ a cada turno
```

---

## 13. O Que Fica para Pós-MVP

1. **CompoundPlan** — operações compostas reais ("cancela recorrência X e cria Y")
2. **MerchantMemory** — aprendizado "Uber → Transporte" após 5+ correções confirmadas
3. **ContextBuilder dinâmico** — se tokens/turno > 2000
4. **LLM fallback no resolver** — só se WAR.subjetiva > 1%
5. **Insights proativos** — "Seu gasto com Uber subiu 40%"
6. **Voice-first** — conversa contínua por áudio

---

## 14. Decisões Rejeitadas (Overengineering Removido)

| Componente Removido | Por que | Substituto |
|---------------------|---------|------------|
| ReferenceExtractor | Parser já estrutura referências | SemanticParser |
| ContextBuilder sofisticado | Contexto necessário é pequeno | `buildContext()` função pura 50 linhas |
| Planner obrigatório + OperationPlan p/ tudo | 90% = 1 comando | SimpleCommand direto |
| Executor + Tool Registry + Tools | Tools = adaptadores LLM | ApplicationService.executeCommand() |
| FinanceApplicationService (wrapper) | Core já tem transação/auditoria | Responsabilidades distribuídas |
| MerchantMemory / aprendizado implícito | MVP acerta básico primeiro | Pós-MVP |
| Scores configuráveis / CandidateRanker | Thresholds fixos são mais seguros | `resolve()` retorna ResolvedEntity \| Ambiguous[] \| NotFound |
| ResultSet versioning / stale / invalidation | Verifica na execução | lastResultSet + re-validação |
| ConversationState inchado (12 campos) | 6 essenciais | Ver seção 4.3 |

---

## 15. Implementação — Fase 1 (Ordem)

1. **Migration** — `ConversationState` JSONB em `sessao` + `schemaVersion` + `version`
2. **SessionManager** — Lock por sessão, optimistic version, carrega/salva state
3. **SemanticParser v2** — Atalhos → `UserRequest` + `references`; LLM só fallback
4. **ReferenceResolver** — Pipeline 5 estágios determinísticos
5. **PolicyEngine** — 3 regras: `none` / `confirmation_required` / `blocked` + OF blocks
6. **SimpleCommand Handlers** — `create/update/cancel/query_transaction`, `create_recurrence`, `create_rule`

---

## 16. Arquivo de Contratos (Criar em `pacotes/tipos/src/assistente-v2.ts`)

Ver seção 4 deste documento para todos os tipos TypeScript/Zod necessários.

---

## 17. Critério Final de Sucesso

> **WAR = 0 em produção por 7 dias** + latência p95 < 3s + 0 regressões na suite 16-ASSISTENTE.

---

> **Este documento é a especificação arquitetural completa.**  
> Cada fase deve ser implementada com testes correspondentes e validação de métricas antes de prosseguir.  
> Não implemente código além do escopo do MVP sem aprovação baseada em métricas reais.

---

*Fim do documento — Arquitetura Assistente 2.0 aprovada para implementação.*