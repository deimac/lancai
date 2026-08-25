# Contrato do Assistente V3

Source of truth da consulta analítica: **um** `QueryState` persistido, idêntico ao contrato de execução. O LLM emite `DialogueAct` com slot ops; o código aplica o patch, compila e chama Relatórios/Motor. O LLM **não** reescreve o estado e **não** calcula dinheiro.

`InformationNeed` + `QuerySpec` dual **não** é SoT. Podem existir como adapter de migração (`last_query`). JSONB da sessão continua schemaVersion 1 misto; em memória o Core usa `query` + `result`.

## Pipeline

```
LLM  →  DialogueAct          (ops / intent / refer; sem estado completo)
Apply (código)               slot ops → QueryState
                             refer → EntityRef via ResultContext
compileQuery (puro)          QueryState → visão + FiltrosVisaoResolvidos
Relatórios / Motor           única verdade financeira
ResultContext gravado        (ids, amount index, summary)
WRITE                        Command → PolicyEngine → CommandExecutor → MotorFinanceiro
```

Após mutate bem-sucedido: `result.stale = true`. QueryState permanece. `refresh` recompila e reexecuta.

## Regras

- Só `set` e `clear`. Omissão em `ops` = CARRYOVER. Sem `append`/`toggle`. `replace` extra não existe (`set` substitui o escalar).
- Defaults **só** em `new_query`: `entityDomain="transactions"`, `grain="summary"`. Sem default silencioso de período no patch.
- Nomes (`"Nubank"`) **não persistem**. Código resolve via catálogo → ID ou `pending.clarification`.
- IDs só do ResultContext/catálogo. LLM nunca inventa UUID.
- Clarificação **não** é act do LLM: o código põe `pending.clarification`. Zod inválido → clarify, não crash.
- `diagnose` nunca vira patch/update sozinho.
- `change_grain` ≡ `patch_query` só em grain/sort/limit.
- `refer_result` hint: `ordinal | amount | label | type`. Código resolve 1 / 0 / N.
- Sem atalho de frase. Sem TTL de 10 min na âncora da consulta. Sem LangGraph/Mem0/CQR/SQL livre.
- HITL de reconciliação Open Finance **não** entra neste Core.

## compileQuery

Não cria um segundo QueryState. Produz `{ visao, filtros, opcoes }`.

Grain → `TipoVisao`: cruzado/direcao → `fluxo`; `entityDomain` accounts → `saldos`; cards + summary → `cartoes`; grain `category` → `categoria`; `month` → `evolucao`; senão `historico`.

`PeriodSpec` simbólico expande para `{de,ate}` com `dataAtual`. `origemPerfil` e `canal` entram em `FiltrosVisaoResolvidos`. `perfil` nos filtros de movimento = `tipoGasto` (natureza). Origem do dinheiro = perfil da conta/cartão (`origemPerfil`).

## TypeScript canónico

```typescript
type Perfil = "pf" | "pj";
type TipoMovimento =
  | "receita" | "despesa" | "transferencia" | "reembolso"
  | "emprestimo" | "estorno" | "retirada" | "aporte";
type DirecaoFluxo = "pessoal_com_empresa" | "empresa_com_pessoal";
type CanalPagamento = "cartao" | "conta";
type QueryGrain = "summary" | "list" | "top" | "category" | "month" | "explain";
type EntityDomain = "transactions" | "accounts" | "cards" | "recurrences";
type ResultEntityType = "transaction" | "account" | "card" | "category";

type QueryState = {
  entityDomain: EntityDomain;
  grain: QueryGrain;
  period?: PeriodSpec;
  comparison?: { period: PeriodSpec };
  tipos?: TipoMovimento[];
  tipoGasto?: Perfil;
  origemPerfil?: Perfil;
  cruzado?: boolean;
  direcao?: DirecaoFluxo;
  canal?: CanalPagamento;
  merchant?: string;
  descricao?: string;
  contaId?: string;
  cartaoId?: string;
  categoriaId?: string;
  pessoaId?: string;
  sort?: { by: "valor" | "data" | "descricao"; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
};

type SlotName =
  | "period" | "comparison" | "tipos" | "tipoGasto" | "origemPerfil"
  | "cruzado" | "direcao" | "canal" | "merchant" | "descricao"
  | "contaId" | "cartaoId" | "categoriaId" | "pessoaId"
  | "grain" | "sort" | "limit" | "entityDomain";

type SlotOp =
  | { op: "set"; slot: SlotName; value: unknown }
  | { op: "clear"; slot: SlotName };

type ResultRefHint =
  | { by: "ordinal"; n: number }
  | { by: "amount"; value: number }
  | { by: "label"; text: string }
  | { by: "type"; entityType: ResultEntityType };

type DiagnoseKind = "query" | "data" | "category" | "duplicate" | "unknown";

type WriteIntent = {
  tipo?: TipoMovimento;
  valor?: number;
  descricao?: string;
  data?: string;
  contaNome?: string;
  cartaoNome?: string;
  categoriaNome?: string;
};

type QueryNames = {
  contaNome?: string;
  cartaoNome?: string;
  categoriaNome?: string;
};

type DialogueAct =
  | { act: "greet" }
  | { act: "new_query"; query: Partial<QueryState>; names?: QueryNames }
  | { act: "patch_query"; ops: SlotOp[]; names?: QueryNames }
  | { act: "change_grain"; grain: QueryGrain; sort?: QueryState["sort"]; limit?: number }
  | { act: "refresh" }
  | { act: "refer_result"; hint: ResultRefHint }
  | { act: "write"; intent: WriteIntent }
  | { act: "update"; target?: ResultRefHint; patch: Record<string, unknown> }
  | { act: "delete"; target?: ResultRefHint }
  | { act: "diagnose"; suspicion?: DiagnoseKind }
  | { act: "confirm" }
  | { act: "cancel" };

type ResultRowRef = {
  ordinal: number;
  entityType: ResultEntityType;
  entityId: string;
  label: string;
  amount?: number;
};

type ResultContext = {
  queryHash: string;
  generatedAt: number;
  stale: boolean;
  summary: { count: number; total?: number };
  rows: ResultRowRef[];
};

type ConversationStateV3 = {
  schemaVersion: 3;
  version: number;
  query: QueryState | null;
  result: ResultContext | null;
  focus: { id: string; type: ResultEntityType; label: string } | null;
  pending: unknown | null;
  preferences: unknown;
  updatedAt: number;
};
```

Campos omitidos em QueryState JSON = ausentes (`undefined`), nunca `null`. `query|result|focus|pending` usam `null` = “não há”.

Implementação Zod: `pacotes/tipos/src/assistente-conversa.ts`. Apply/compile: `modulos/assistente/src/agente/apply-slot-ops.ts` e `compile-query.ts`.
