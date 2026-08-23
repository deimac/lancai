# Task 5: SimpleCommand Handlers

## Arquivos: `modulos/assistente/comandos/*.ts`

## Objetivo
Implementar 6 handlers de comandos atômicos. Cada handler = 1 transação Core.
**Sem OperationPlan, sem rollback compensatório** — Core é atômico.

---

## 5.1 Create Transaction

## Arquivo: `modulos/assistente/comandos/create-transaction.ts`

```typescript
interface CreateTransactionInput {
  tipo: "receita" | "despesa" | "transferencia" | "reembolso" | "emprestimo" | "estorno" | "retirada" | "aporte";
  valor: number;
  dataMovimento: string; // YYYY-MM-DD
  descricao: string;
  contaId?: string;
  cartaoId?: string;
  contaDestinoId?: string; // só transferência
  categoriaId?: string;
  pessoaId?: string;
  perfil?: "pf" | "pj";
  formaPagamento?: "pix" | "credito" | "debito" | "dinheiro" | "transferencia" | "boleto" | "ted" | "doc" | "outro";
  parcelamento?: ParcelamentoFonte;
}

async function handleCreateTransaction(input: CreateTransactionInput, ctx: CommandContext): Promise<CommandResult> {
  // 1. Validação de domínio (antes de chamar Core)
  validateCreateTransaction(input);
  
  // 2. Chama Core via ApplicationService
  return applicationService.executeCommand({
    type: "create_transaction",
    input
  }, ctx);
}

function validateCreateTransaction(input: CreateTransactionInput) {
  // Regra: conta XOR cartão (exceto transferência = conta + contaDestino)
  if (input.tipo === "transferencia") {
    if (!input.contaId || !input.contaDestinoId) throw new Error("Transferência exige contaId e contaDestinoId");
    if (input.contaId === input.contaDestinoId) throw new Error("Conta origem e destino devem ser diferentes");
  } else if (input.formaPagamento === "credito") {
    if (!input.cartaoId) throw new Error("Cartão obrigatório para crédito");
    if (input.contaId) throw new Error("Conta não permitida para crédito");
  } else if (input.formaPagamento === "debito") {
    if (!input.contaId) throw new Error("Conta obrigatória para débito");
  } else {
    // pix, dinheiro, etc → conta obrigatória
    if (!input.contaId) throw new Error("Conta obrigatória");
  }
  
  // Valida posse (Core valida de novo, mas falha rápido aqui)
  // ...
}
```

---

## 5.2 Update Transaction

## Arquivo: `modulos/assistente/comandos/update-transaction.ts`

```typescript
interface UpdateTransactionInput {
  movementId: string;
  fatoPatch?: Partial<Pick<TransactionParams, "valor" | "dataMovimento" | "contaId" | "cartaoId" | "tipo" | "descricaoFonte" | "formaPagamento" | "parcelamento">>;
  conhecimentoPatch?: Partial<Pick<TransactionParams, "categoriaId" | "pessoaId" | "perfil" | "tags" | "observacoes" | "ignoradoEmRelatorio">>;
}

async function handleUpdateTransaction(input: UpdateTransactionInput, ctx: CommandContext): Promise<CommandResult> {
  // 1. Pelo menos um patch
  if (!input.fatoPatch && !input.conhecimentoPatch) {
    throw new Error("Nenhum campo para alterar");
  }
  
  // 2. Se fatoPatch + conhecimentoPatch → 1 comando atômico (Core faz transação única)
  // 3. Core valida fatoImutavel internamente
  
  return applicationService.executeCommand({
    type: "update_transaction",
    movementId: input.movementId,
    fatoPatch: input.fatoPatch,
    conhecimentoPatch: input.conhecimentoPatch
  }, ctx);
}
```

---

## 5.3 Cancel Transaction

## Arquivo: `modulos/assistente/comandos/cancel-transaction.ts`

```typescript
interface CancelTransactionInput {
  movementId: string;
}

async function handleCancelTransaction(input: CancelTransactionInput, ctx: CommandContext): Promise<CommandResult> {
  return applicationService.executeCommand({
    type: "cancel_transaction",
    movementId: input.movementId
  }, ctx);
}
```

---

## 5.4 Query Transactions

## Arquivo: `modulos/assistente/comandos/query-transactions.ts`

```typescript
interface QueryTransactionsInput {
  spec: QuerySpec;
}

async function handleQueryTransactions(input: QueryTransactionsInput, ctx: CommandContext): Promise<CommandResult> {
  // Query não muda estado — não precisa idempotencyKey no Core
  // Mas ApplicationService injeta userId
  return applicationService.executeCommand({
    type: "query_transactions",
    spec: input.spec
  }, ctx);
}
```

---

## 5.5 Create Recurrence

## Arquivo: `modulos/assistente/comandos/create-recurrence.ts`

```typescript
interface CreateRecurrenceInput {
  descricao: string;
  valor: number;
  diaDoMes: number; // 1-31
  contaId?: string;
  cartaoId?: string;
  categoriaId?: string;
  perfil?: "pf" | "pj";
}

async function handleCreateRecurrence(input: CreateRecurrenceInput, ctx: CommandContext): Promise<CommandResult> {
  validateCreateRecurrence(input);
  return applicationService.executeCommand({
    type: "create_recurrence",
    input
  }, ctx);
}

function validateCreateRecurrence(input: CreateRecurrenceInput) {
  if (input.diaDoMes < 1 || input.diaDoMes > 31) throw new Error("Dia do mês inválido (1-31)");
  // conta XOR cartão (padrão conta se nenhum)
  // ...
}
```

---

## 5.6 Create Rule

## Arquivo: `modulos/assistente/comandos/create-rule.ts`

```typescript
interface CreateRuleInput {
  merchant: string;
  categoriaId: string;
  perfil?: "pf" | "pj";
  contaId?: string;
  cartaoId?: string;
}

async function handleCreateRule(input: CreateRuleInput, ctx: CommandContext): Promise<CommandResult> {
  return applicationService.executeCommand({
    type: "create_rule",
    input
  }, ctx);
}
```

---

## Registry

## Arquivo: `modulos/assistente/comandos/index.ts`

```typescript
import { handleCreateTransaction } from "./create-transaction";
import { handleUpdateTransaction } from "./update-transaction";
import { handleCancelTransaction } from "./cancel-transaction";
import { handleQueryTransactions } from "./query-transactions";
import { handleCreateRecurrence } from "./create-recurrence";
import { handleCreateRule } from "./create-rule";

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  create_transaction: handleCreateTransaction,
  update_transaction: handleUpdateTransaction,
  cancel_transaction: handleCancelTransaction,
  query_transactions: handleQueryTransactions,
  create_recurrence: handleCreateRecurrence,
  create_rule: handleCreateRule,
};

export type SimpleCommand = 
  | { type: "create_transaction"; input: CreateTransactionInput }
  | { type: "update_transaction"; input: UpdateTransactionInput }
  | { type: "cancel_transaction"; input: CancelTransactionInput }
  | { type: "query_transactions"; input: QueryTransactionsInput }
  | { type: "create_recurrence"; input: CreateRecurrenceInput }
  | { type: "create_rule"; input: CreateRuleInput };

export type CommandHandler = (input: any, ctx: CommandContext) => Promise<CommandResult>;
```

---

## Testes Obrigatórios

| Handler | Casos | Validação |
|---------|-------|-----------|
| create_transaction | 20 | Validação conta/cartão, transferência, parcelamento, forma pagamento |
| update_transaction | 15 | fatoPatch + conhecimentoPatch juntos, só fato, só conhecimento |
| cancel_transaction | 5 | Core bloqueia OF |
| query_transactions | 10 | Filtros, paginação, visão |
| create_recurrence | 10 | Dia 1-31, conta/cartão, cron |
| create_rule | 5 | Merchant normalizado, categoria válida |

---

## Critério de Conclusão Task 5
- [ ] 6 handlers implementados com validação de domínio
- [ ] Cada handler = 1 chamada `applicationService.executeCommand`
- [ ] Validações de domínio falham rápido (antes do Core)
- [ ] Testes unitários: 75+ casos passam
- [ ] Integração: Core chamado com parâmetros corretos