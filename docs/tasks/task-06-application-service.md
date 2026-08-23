# Task 6: ApplicationService

## Arquivo: `modulos/assistente/application/application-service.ts`

## Objetivo
Camada fina entre Command Handlers e Core Financeiro.
Responsabilidades: **transação, idempotência, auditoria, injeção de contexto**.

## Contrato

```typescript
interface CommandContext {
  authenticatedUserId: string;
  sessionId: string;
  idempotencyKey: string;      // UUID por comando
  traceId: string;
  stateVersion: number;        // para re-validação
}

interface CommandResult {
  success: boolean;
  data?: any;
  error?: string;
  entityRef?: EntityRef;       // entidade criada/alterada
}

interface ApplicationService {
  executeCommand(command: SimpleCommand, context: CommandContext): Promise<CommandResult>;
}
```

## Implementação

```typescript
class ApplicationService implements ApplicationService {
  constructor(
    private motor: MotorFinanceiro,
    private repositorio: RepositorioFinanceiro,
    private idempotencyStore: IdempotencyStore,
    private auditoria: AuditoriaService
  ) {}

  async executeCommand(command: SimpleCommand, context: CommandContext): Promise<CommandResult> {
    const { authenticatedUserId, idempotencyKey, traceId, stateVersion } = context;
    
    // 1. IDEMPOTÊNCIA: verifica se comando já executado
    const existing = await this.idempotencyStore.get(idempotencyKey);
    if (existing) {
      return { success: true, data: existing, idempotent: true };
    }
    
    // 2. RE-VALIDAÇÃO: re-busca entidades e re-avalia policy
    // (evita race condition entre resolver e executar)
    await this.revalidateCommand(command, context);
    
    // 3. EXECUÇÃO EM TRANSAÇÃO
    return this.motor.transaction(async (tx) => {
      let result: CommandResult;
      
      switch (command.type) {
        case "create_transaction":
          result = await this.executeCreateTransaction(command.input, tx, { authenticatedUserId, traceId });
          break;
        case "update_transaction":
          result = await this.executeUpdateTransaction(command.input, tx, { authenticatedUserId, traceId });
          break;
        case "cancel_transaction":
          result = await this.executeCancelTransaction(command.input, tx, { authenticatedUserId, traceId });
          break;
        case "query_transactions":
          result = await this.executeQueryTransactions(command.input.spec, tx, { authenticatedUserId });
          break;
        case "create_recurrence":
          result = await this.executeCreateRecurrence(command.input, tx, { authenticatedUserId, traceId });
          break;
        case "create_rule":
          result = await this.executeCreateRule(command.input, tx, { authenticatedUserId, traceId });
          break;
      }
      
      // 4. AUDITORIA AUTOMÁTICA
      await this.auditoria.logCommand(command, context, result);
      
      // 5. ARMAZENA IDEMPOTÊNCIA
      await this.idempotencyStore.set(idempotencyKey, result);
      
      return result;
    });
  }
  
  private async revalidateCommand(command: SimpleCommand, context: CommandContext): Promise<void> {
    // Re-busca entidades referenciadas para garantir que não foram alteradas/canceladas
    if (command.type === "update_transaction" || command.type === "cancel_transaction") {
      const movement = await this.repositorio.obterMovimento(command.input.movementId);
      if (!movement) throw new Error("Movimento não encontrado");
      if (movement.status === "cancelado") throw new Error("Movimento já cancelado");
      // Verifica se stateVersion ainda válido (opcional)
    }
    if (command.type === "create_transaction" && command.input.contaId) {
      const conta = await this.repositorio.obterConta(command.input.contaId);
      if (!conta || !conta.ativo) throw new Error("Conta inválida ou inativa");
    }
    // ... outras validações
  }
  
  // Métodos de execução delegam para MotorFinanceiro
  private async executeCreateTransaction(input, tx, ctx) { /* ... */ }
  private async executeUpdateTransaction(input, tx, ctx) { /* ... */ }
  // ...
}
```

## IdempotencyStore

```typescript
interface IdempotencyStore {
  get(key: string): Promise<CommandResult | null>;
  set(key: string, value: CommandResult): Promise<void>;
}

// Implementação Redis com TTL 24h
// Ou Postgres: tabela idempotency_key (key, value, expires_at)
```

## Testes Obrigatórios

| Teste | Descrição |
|-------|-----------|
| Idempotência: mesmo idempotencyKey retorna resultado cached | 2 chamadas mesma key → 2ª retorna cached |
| Transação: falha no meio faz rollback | Erro no meio → nenhuma alteração persistida |
| Re-validação: entidade cancelada entre resolver e executar | Lança erro "Movimento já cancelado" |
| Auditoria: todo comando logado | Verifica tabela auditoria |
| Contexto injetado: userId, traceId no Core | MotorFinanceiro recebe contexto correto |
| Falha no Core → rollback + erro retornado | Erro propagado, idempotency não salvo |

---

## Critério de Conclusão Task 6
- [ ] `executeCommand` lida com todos 6 tipos de comando
- [ ] Idempotência funciona: 1000 chamadas duplicadas → 1 execução real
- [ ] Transação atômica: falha no meio → 0 alterações parciais
- [ ] Re-validação pega race conditions
- [ ] Auditoria loga comando + resultado
- [ ] Testes: 20+ casos passam