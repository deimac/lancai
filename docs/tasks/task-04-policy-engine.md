# Task 4: Policy Engine

## Arquivo: `modulos/assistente/agente/policy-engine.ts`

## Objetivo
Avaliar `ResolvedRequest` e retornar `PolicyDecision` determinística.
**Regras fixas, sem thresholds configuráveis.**

## Contratos

```typescript
type RiskLevel = "none" | "confirmation_required" | "blocked";

interface PolicyDecision {
  allowed: boolean;
  risk: RiskLevel;
  confirm: boolean;
  reason: "risk" | "of_fato_immutable" | "of_cannot_delete" | "ambiguity" | "auto";
  message?: string; // para confirm/ask
}
```

## Regras (Ordem de Avaliação)

```typescript
function evaluatePolicy(request: ResolvedRequest, state: ConversationState): PolicyDecision {
  // 1. BLOQUEIOS ABSOLUTOS (Open Finance)
  if (isOFMutation(request)) {
    return { allowed: false, risk: "blocked", confirm: false, reason: "of_fato_immutable", message: "Esse lançamento veio do banco. Não posso alterar o fato financeiro, só classificar/complementar." };
  }
  if (isOFDelete(request)) {
    return { allowed: false, risk: "blocked", confirm: false, reason: "of_cannot_delete", message: "Esse lançamento veio do banco. Não posso apagar. Posso marcar 'não considera nos relatórios'." };
  }
  
  // 2. CLASSIFICAÇÃO DE RISCO
  const risk = classifyRisk(request);
  
  // 3. DECISÃO DETERMINÍSTICA
  switch (risk) {
    case "none":
      return { allowed: true, risk: "none", confirm: false, reason: "auto" };
    case "confirmation_required":
      return { allowed: true, risk, confirm: true, reason: "risk", message: buildConfirmMessage(request) };
    case "blocked":
      return { allowed: false, risk, confirm: false, reason: "blocked_by_policy", message: "Essa operação requer confirmação explícita e validação de segurança." };
  }
}
```

## Classificação de Risco

```typescript
function classifyRisk(request: ResolvedRequest): "none" | "confirmation_required" | "blocked" {
  // QUERY / CLASSIFY → sem risco
  if (request.op === "query" || request.op === "classify") return "none";
  
  // CREATE TRANSACTION → confirmação (validação de campos)
  if (request.op === "create" && request.resource === "transaction") return "confirmation_required";
  
  // UPDATE TRANSACTION
  if (request.op === "update" && request.resource === "transaction") {
    const fatoFields = ["valor", "dataMovimento", "contaId", "cartaoId", "tipo", "descricaoFonte", "formaPagamento", "parcelamento"];
    const hasFatoChange = Object.keys(request.params).some(k => fatoFields.includes(k));
    return hasFatoChange ? "blocked" : "confirmation_required";
  }
  
  // DELETE / CANCEL
  if (request.op === "delete") return "blocked";
  
  // CREATE RECURRENCE / RULE
  if (request.op === "create" && (request.resource === "recurrence" || request.resource === "rule")) return "confirmation_required";
  
  // DEFAULT
  return "confirmation_required";
}
```

## Verificações Open Finance

```typescript
function isOFMutation(request: ResolvedRequest): boolean {
  if (request.op !== "update" || request.resource !== "transaction") return false;
  const target = request.resolved.target;
  return target?.metadata?.fatoImutavel === true || target?.metadata?.fonte === "open_finance";
}

function isOFDelete(request: ResolvedRequest): boolean {
  if (request.op !== "delete" || request.resource !== "transaction") return false;
  const target = request.resolved.target;
  return target?.metadata?.fatoImutavel === true || target?.metadata?.fonte === "open_finance";
}
```

## Mensagem de Confirmação

```typescript
function buildConfirmMessage(request: ResolvedRequest): string {
  const target = request.resolved.target;
  const label = target?.label || "lançamento";
  
  switch (request.op) {
    case "create":
      return `Confirmar: ${formatTransaction(request.params)}?`;
    case "update":
      const changes = describeChanges(request.params);
      return `Alterar ${label}: ${changes}. Confirmar?`;
    case "delete":
      return `Cancelar ${label}? Ação irreversível.`;
    case "create":
      if (request.resource === "recurrence") return `Criar recorrência: ${formatRecurrence(request.params)}. Confirmar?`;
      if (request.resource === "rule") return `Criar regra: ${request.params.merchant} → ${request.params.categoriaId}. Confirmar?`;
  }
  return "Confirmar operação?";
}
```

## Testes Obrigatórios

| Cenário | Request | Expected Decision |
|---------|---------|-------------------|
| Query gasto | query/transaction | allowed=true, confirm=false, reason="auto" |
| Create transaction completo | create/transaction | allowed=true, confirm=true, reason="risk" |
| Update conhecimento (categoria) | update/transaction + categoriaId | allowed=true, confirm=true, reason="risk" |
| Update fato (valor) | update/transaction + valor | allowed=true, confirm=true, reason="risk" (blocked=false mas confirm=true) |
| Update fato (conta) | update/transaction + contaId | allowed=true, confirm=true, reason="risk" |
| Delete manual | delete/transaction (manual) | allowed=true, confirm=true, reason="risk" |
| Delete OF | delete/transaction (OF) | allowed=false, risk="blocked", reason="of_cannot_delete" |
| Update fato OF | update/transaction (OF) + valor | allowed=false, risk="blocked", reason="of_fato_immutable" |
| Create recurrence | create/recurrence | allowed=true, confirm=true |
| Create rule | create/rule | allowed=true, confirm=true |
| Ambiguidade (resolver) | resolved.target = null | allowed=false, risk="blocked", reason="ambiguity" |

---

## Critério de Conclusão Task 4
- [ ] 100% casos de teste passam
- [ ] Zero execução indevida em staging (WAR = 0)
- [ ] Regras Open Finance absolutas (não configuráveis)
- [ ] Código puro (sem I/O, testável unitariamente)
- [ ] Mensagens de confirmação claras e acionáveis