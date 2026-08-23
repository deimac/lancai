# Task 2: Semantic Parser v2

## Arquivo: `modulos/assistente/agente/semantic-parser-v2.ts`

## Objetivo
Converter mensagem do usuário em `UserRequest` com `references` já estruturadas.
Atalhos determinísticos (regex) para 80% casos; LLM apenas fallback.

## Contratos (de `assistente-v2.ts`)

```typescript
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

## Interface

```typescript
interface SemanticParserV2 {
  parse(input: ParserInput): Promise<ParseResult>;
}

interface ParserInput {
  mensagem: string;
  state: ConversationState;
  userId: string;
  canal: "web" | "whatsapp";
  intencaoPrevia?: Partial<UserRequest>; // foto/PDF no WhatsApp
}

interface ParseResult {
  request: UserRequest;
  usedShortcut: boolean;
  shortcutName?: string;
  warnings: string[]; // ex: "slot faltando: valor"
}
```

## Atalhos Determinísticos (Prioridade Ordem)

| # | Padrão | Shortcut | Extração |
|---|--------|----------|----------|
| 1 | `^menu$|^ajuda$` | `menu` | — |
| 2 | `^sim$|^não$|^\d+$|^todos$` | `confirmacao` | Resolve no ConfirmationHandler |
| 3 | `^detalhado$` | `detalhado` | Paginação histórico |
| 4 | `^mais$` | `mais` | Próxima página |
| 5 | `orçamento|budget` | `orcamento` | Valor + categoria opcional |
| 6 | `todo mês|mensalmente|recorrente|assinatura` | `recorrencia` | Valor + dia + descrição + conta |
| 7 | `não considera|ignora|tag` | `enriquecimento` | Merchant + ação |
| 8 | `corrige|altera|muda.*para \d+|alterar data` | `correcao` | Referência + campos |
| 9 | `gastei|recebi|paguei|transferi\s+\d+` | `lancamento` | Valor + merchant + conta/cartão |
| 10 | `quanto|mostre|liste|extrato` | `consulta` | Filtros + visão |

## LLM Fallback

```typescript
async function parseWithLLM(input: ParserInput): Promise<UserRequest> {
  // Usa prompt estruturado com:
  // - Schema UserRequest (Zod)
  // - Exemplos few-shot
  // - Contexto mínimo (contas, cartões, categorias do usuário)
  // Retorna UserRequest validado por Zod
}
```

## Preenchimento de Slots (Pós-Parser)

```typescript
function fillSlots(request: UserRequest, state: ConversationState): UserRequest {
  // 1. Conta/cartão: explicit > reference > state.explicit > prefs.default > única conta
  // 2. Perfil: explicit > reference > conta/cartão > prefs.default > "pf"
  // 3. Data: explicit > "hoje"/"ontem"/"dia X" > hoje
  // 4. Forma pagamento: explicit > heurística (cartão=credito, conta=pix)
  // Retorna request com params completos ou warnings para ask_info
}
```

## Testes Obrigatórios (200+ casos)

| Categoria | Casos | Exemplos |
|-----------|-------|----------|
| Lançamento completo | 20 | "gastei 50 no uber no nubank", "recebi 1000 de salário no itaú" |
| Lançamento slots faltando | 15 | "gastei no uber", "paguei 100" |
| Consulta simples | 15 | "quanto gastei com uber", "mostre meus gastos" |
| Consulta com filtros | 20 | "quanto gastei com uber no nubank mês passado" |
| Correção fato | 15 | "corrige o uber para 80", "altera data para ontem" |
| Correção conhecimento | 10 | "aquele uber foi pessoal", "tag projeto x no ifood" |
| Recorrência | 10 | "todo mês dia 10 netflix 55 no nubank" |
| Referência posicional | 8 | "o segundo", "o terceiro foi pessoal" |
| Referência temporal | 8 | "o de ontem", "o da semana passada" |
| Referência merchant | 8 | "o uber", "o ifood" |
| Referência anafórica | 5 | "aquele", "o anterior" |
| Ambiguidade | 5 | "corrige o uber" (3 ubers) |
| Cancelamento | 5 | "cancela aquele", "apaga o lançamento" |
| Transferência | 5 | "transferi 500 do nubank pro itau" |
| Slot filling | 10 | Defaults conta/cartão/perfil/data |
| LLM fallback | 10 | Casos não cobertos por atalhos |
| Multimodal | 5 | intencaoPrevia de foto/PDF |

---

## Critério de Conclusão Task 2
- [ ] 100% atalhos atuais cobertos (regressão 0)
- [ ] LLM fallback só para casos não cobertos
- [ ] `references` estruturadas em 100% dos casos aplicáveis
- [ ] Testes: 200+ casos passam
- [ ] Latência parser < 100ms (atalho) / < 2s (LLM)