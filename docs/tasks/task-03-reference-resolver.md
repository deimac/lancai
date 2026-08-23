# Task 3: Reference Resolver

## Arquivo: `modulos/assistente/agente/reference-resolver.ts`

## Objetivo
Resolver `EntityReference` (estruturada pelo Parser) para `EntityRef` (ID real + metadata).
Pipeline determinístico de 5 estágios. **SEM LLM fallback.**

## Contratos

```typescript
interface EntityReference { /* ver assistente-v2.ts */ }

interface EntityRef {
  id: string;
  type: "transaction" | "account" | "card" | "recurrence" | "rule" | "category";
  label: string;
  metadata?: Record<string, unknown>;
}

interface ResolvedEntity {
  entity: EntityRef;
  confidence: number; // 0-1
  method: "exact" | "positional" | "temporal" | "merchant" | "anaphoric" | "composite";
}

type ResolutionResult = 
  | { status: "resolved"; entity: ResolvedEntity }
  | { status: "ambiguous"; candidates: ResolvedEntity[] }
  | { status: "not_found"; reason: string };
```

## Pipeline de 5 Estágios (Ordem Fixa)

```typescript
const RESOLUTION_PIPELINE: ResolutionStage[] = [
  { name: "positional",   resolver: resolvePositional,   applies: (r) => r.type === "positional" },
  { name: "temporal",     resolver: resolveTemporal,     applies: (r) => r.type === "temporal" },
  { name: "value",        resolver: resolveValue,        applies: (r) => r.type === "value" },
  { name: "merchant",     resolver: resolveMerchant,     applies: (r) => r.type === "merchant" },
  { name: "anaphoric",    resolver: resolveAnaphoric,    applies: (r) => r.type === "anaphoric" },
  // composite: decompose → resolve parts → intersect
];
```

## Estágio 1: Positional ("o segundo", "o 3º")

```typescript
function resolvePositional(ref: PositionalRef, deps: ResolverDeps, state: ConversationState): ResolutionResult {
  if (!state.lastResultSet) return { status: "not_found", reason: "Nenhuma lista anterior" };
  
  const index = ref.index - 1 + (state.lastResultSet.query.offset ?? 0);
  if (index < 0 || index >= state.lastResultSet.ids.length) {
    return { status: "not_found", reason: `Lista tem ${state.lastResultSet.ids.length} itens` };
  }
  
  const id = state.lastResultSet.ids[index];
  const entity = await deps.getEntityById(id, state.lastResultSet.query.entityType);
  return { status: "resolved", entity: { entity, confidence: 1.0, method: "positional" } };
}
```

## Estágio 2: Temporal ("o de ontem", "o da semana passada")

```typescript
function resolveTemporal(ref: TemporalRef, deps: ResolverDeps, state: ConversationState): ResolutionResult {
  const targetDate = parseTemporalRelative(ref.relative, state.currentDate);
  
  // 1. Tenta lastResultSet (já em memória)
  if (state.lastResultSet) {
    const entities = await deps.getEntitiesByIds(state.lastResultSet.ids);
    const matches = entities.filter(e => sameDay(e.metadata?.dataMovimento, targetDate));
    return decide(matches, "temporal");
  }
  
  // 2. Busca ampla (últimos 30 dias)
  const entities = await deps.searchEntities({
    userId: state.usuarioId,
    dateFrom: targetDate,
    dateTo: targetDate,
    limit: 20
  });
  return decide(entities, "temporal");
}
```

## Estágio 3: Value ("o de 50", "o de R$ 42,50")

```typescript
function resolveValue(ref: ValueRef, deps: ResolverDeps, state: ConversationState): ResolutionResult {
  const amount = ref.amount;
  
  if (state.lastResultSet) {
    const entities = await deps.getEntitiesByIds(state.lastResultSet.ids);
    const matches = entities.filter(e => Number(e.metadata?.valor) === amount);
    return decide(matches, "value");
  }
  
  const entities = await deps.searchEntities({
    userId: state.usuarioId,
    valor: amount,
    limit: 20
  });
  return decide(entities, "value");
}
```

## Estágio 4: Merchant ("o Uber", "o iFood")

```typescript
function resolveMerchant(ref: MerchantRef, deps: ResolverDeps, state: ConversationState): ResolutionResult {
  const merchant = normalizeMerchant(ref.name);
  
  // 1. lastResultSet
  if (state.lastResultSet) {
    const entities = await deps.getEntitiesByIds(state.lastResultSet.ids);
    const matches = entities.filter(e => 
      fuzzyMatch(normalizeMerchant(e.metadata?.merchant), merchant) > 0.8
    );
    const result = decide(matches, "merchant");
    if (result.status !== "not_found") return result;
  }
  
  // 2. recentEntities (state.currentEntity + últimos 5)
  // 3. Busca ampla últimos 30 dias
  const entities = await deps.searchEntities({
    userId: state.usuarioId,
    merchant: merchant,
    limit: 20
  });
  return decide(entities, "merchant");
}
```

## Estágio 5: Anaphoric ("aquele", "o anterior")

```typescript
function resolveAnaphoric(ref: AnaphoricRef, deps: ResolverDeps, state: ConversationState): ResolutionResult {
  // "aquele", "essa", "este" → currentEntity
  if (["that", "last", "previous"].includes(ref.pronoun)) {
    if (state.currentEntity) {
      return { status: "resolved", entity: { entity: state.currentEntity, confidence: 0.9, method: "anaphoric" } };
    }
    // Fallback: recentEntities[0]
    // (recentEntities derivado de lastResultSet + currentEntity)
  }
  return { status: "not_found", reason: "Nenhuma entidade anterior" };
}
```

## Composite ("aquele Uber de ontem")

```typescript
function resolveComposite(ref: CompositeRef, deps: ResolverDeps, state: ConversationState): ResolutionResult {
  const results = await Promise.all(
    ref.parts.map(p => resolveSingle(p, deps, state))
  );
  
  // Interseção: entities que satisfazem TODAS as partes
  const candidateSets = results.map(r => r.status === "resolved" ? new Set([r.entity.entity.id]) : new Set());
  const intersection = candidateSets.reduce((acc, set) => new Set([...acc].filter(x => set.has(x))));
  
  if (intersection.size === 1) {
    const id = intersection.values().next().value;
    const entity = await deps.getEntityById(id, "transaction");
    return { status: "resolved", entity: { entity, confidence: 0.95, method: "composite" } };
  }
  if (intersection.size > 1) {
    const entities = await Promise.all([...intersection].map(id => deps.getEntityById(id, "transaction")));
    return { status: "ambiguous", candidates: entities.map(e => ({ entity: e, confidence: 0.7, method: "composite" })) };
  }
  return { status: "not_found", reason: "Nenhuma entidade corresponde a todos os critérios" };
}
```

## Decide Helper (Política de Ambiguidade)

```typescript
function decide(entities: Entity[], method: ResolutionMethod): ResolutionResult {
  if (entities.length === 0) return { status: "not_found", reason: "Nenhum candidato" };
  if (entities.length === 1) return { status: "resolved", entity: { entity: toRef(entities[0]), confidence: 0.9, method } };
  
  // Múltiplos: ordena por score (recência, match exato, etc.)
  const sorted = entities.sort((a, b) => score(b) - score(a));
  const top = sorted[0];
  const second = sorted[1];
  
  // Se top claramente melhor → resolve
  if (score(top) - score(second) >= 0.3) {
    return { status: "resolved", entity: { entity: toRef(top), confidence: 0.75, method } };
  }
  
  // Caso contrário → ambíguo (top 3)
  return { status: "ambiguous", candidates: sorted.slice(0, 3).map(e => ({ entity: toRef(e), confidence: score(e), method })) };
}
```

## ResolverDeps (Injeção de Dependência)

```typescript
interface ResolverDeps {
  getEntityById(id: string, type: string): Promise<Entity | null>;
  getEntitiesByIds(ids: string[]): Promise<Entity[]>;
  searchEntities(criteria: SearchCriteria): Promise<Entity[]>;
}
```

## Testes Obrigatórios (100+ casos)

| Estágio | Casos | Exemplos |
|---------|-------|----------|
| Positional | 20 | "o primeiro", "o segundo", "o 3º", paginação ("mais") |
| Temporal | 20 | "o de ontem", "o da semana passada", "o de julho", "o dia 15" |
| Value | 15 | "o de 50", "o de R$ 42,50", "o de 1000" |
| Merchant | 20 | "o uber", "o ifood", "o mercado", fuzzy ("ubr" → uber) |
| Anaphoric | 10 | "aquele", "essa", "o anterior", "o último" |
| Composite | 10 | "aquele uber de ontem", "o de 50 no nubank" |
| Ambiguidade | 15 | 2-5 candidatos → pergunta numerada |
| Not Found | 10 | Referência sem contexto, lista vazia |

---

## Critério de Conclusão Task 3
- [ ] Pipeline executa em ordem fixa, curto-circuito se resolvido
- [ ] **SEM LLM fallback** — ambíguo retorna `ambiguous`, não escolhe
- [ ] 100+ testes passam
- [ ] Latência < 50ms (cached lastResultSet) / < 200ms (busca ampla)
- [ ] Composite decompõe e intersecta corretamente