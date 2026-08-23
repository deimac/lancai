# Test Specs — Assistente 2.0 Fase 1

## Estratégia de Testes

| Camada | Tipo | Ferramenta | Cobertura Mínima |
|--------|------|------------|------------------|
| SessionManager | Unit | Vitest | 90% |
| SemanticParser | Unit | Vitest | 90% |
| ReferenceResolver | Unit | Vitest | 90% |
| PolicyEngine | Unit | Vitest | 100% |
| Commands | Unit + Integration | Vitest | 85% |
| ApplicationService | Integration | Vitest | 85% |
| StateUpdater | Unit | Vitest | 90% |
| AssistenteCore | Integration | Vitest | 80% |
| E2E (Web + WA) | E2E | Vitest + Supertest | 30 conversas |

---

## 1. SessionManager Tests

**Arquivo:** `modulos/assistente/__testes__/session-manager.test.ts`

```typescript
describe("SessionManager", () => {
  let manager: SessionManager;
  let repo: SessionRepositoryMemory;
  
  beforeEach(() => {
    repo = new SessionRepositoryMemory();
    manager = new SessionManager(repo);
  });
  
  describe("obterOuCriar", () => {
    it("cria nova sessão Web se sessaoId não fornecido", async () => {
      const session = await manager.obterOuCriar("user-1", "web");
      expect(session.id).toBeDefined();
      expect(session.contexto.version).toBe(0);
      expect(session.contexto.schemaVersion).toBe(1);
    });
    
    it("reusa sessão ativa no WhatsApp", async () => {
      const s1 = await manager.obterOuCriar("user-1", "whatsapp");
      const s2 = await manager.obterOuCriar("user-1", "whatsapp");
      expect(s1.id).toBe(s2.id);
    });
    
    it("cria nova sessão Web se sessaoId inexistente", async () => {
      const session = await manager.obterOuCriar("user-1", "web", "inexistente");
      expect(session.id).not.toBe("inexistente");
    });
  });
  
  describe("atualizarEstado (optimistic locking)", () => {
    it("incrementa version a cada update", async () => {
      const session = await manager.obterOuCriar("user-1", "web");
      await manager.atualizarEstado(session.id, s => ({ ...s, version: s.version + 1 }));
      const updated = await repo.get(session.id);
      expect(updated.contexto.version).toBe(1);
    });
    
    it("falha em race condition e retries", async () => {
      const session = await manager.obterOuCriar("user-1", "web");
      
      // Simula 2 updates simultâneos
      const p1 = manager.atualizarEstado(session.id, s => ({ ...s, explicitPeriod: { tipo: "mes_passado" } }));
      const p2 = manager.atualizarEstado(session.id, s => ({ ...s, explicitPeriod: { tipo: "mes_atual" } }));
      
      await Promise.all([p1, p2]);
      const final = await repo.get(session.id);
      // Um deve ter sucesso, outro retry → version = 2
      expect(final.contexto.version).toBe(2);
    });
    
    it("retries com backoff exponencial", async () => {
      // Mock repo para falhar 2x depois sucesso
      // Verifica sleep(50), sleep(100), sleep(150)
    });
  });
  
  describe("Deduplicação WhatsApp", () => {
    it("jaProcessado retorna false para messageId novo", async () => {
      const session = await manager.obterOuCriar("user-1", "whatsapp");
      const exists = await manager.jaProcessado("msg-123");
      expect(exists).toBe(false);
    });
    
    it("marcarProcessado + jaProcessado = true", async () => {
      const session = await manager.obterOuCriar("user-1", "whatsapp");
      await manager.marcarProcessado("msg-123", session.id);
      const exists = await manager.jaProcessado("msg-123");
      expect(exists).toBe(true);
    });
    
    it("messageId persiste após restart (repo memory)", async () => {
      const session = await manager.obterOuCriar("user-1", "whatsapp");
      await manager.marcarProcessado("msg-123", session.id);
      
      // Novo manager com mesmo repo
      const manager2 = new SessionManager(repo);
      const exists = await manager2.jaProcessado("msg-123");
      expect(exists).toBe(true);
    });
  });
});
```

---

## 2. SemanticParser Tests

**Arquivo:** `modulos/assistente/__testes__/semantic-parser-v2.test.ts`

```typescript
describe("SemanticParserV2", () => {
  let parser: SemanticParserV2;
  let state: ConversationState;
  
  beforeEach(() => {
    parser = new SemanticParserV2();
    state = createInitialState();
  });
  
  describe("Atalhos determinísticos", () => {
    const cases = [
      { input: "gastei 50 no uber no nubank", shortcut: "lancamento", op: "create", resource: "transaction", params: { valor: 50, descricao: "Uber", contaId: "nubank_id" } },
      { input: "recebi 1000 de salário no itaú", shortcut: "lancamento", op: "create", resource: "transaction", params: { valor: 1000, tipo: "receita" } },
      { input: "quanto gastei com uber", shortcut: "consulta", op: "query", resource: "transaction", params: { merchant: "Uber" } },
      { input: "corrige o uber para 80", shortcut: "correcao", op: "update", resource: "transaction", params: { valor: 80 } },
      { input: "aquele uber foi pessoal", shortcut: "enriquecimento", op: "update", resource: "transaction", params: { perfil: "pj" } },
      { input: "todo mês dia 10 netflix 55 no nubank", shortcut: "recorrencia", op: "create", resource: "recurrence", params: { descricao: "Netflix", valor: 55, diaDoMes: 10 } },
      { input: "não considera ifood nos relatórios", shortcut: "enriquecimento", op: "update", resource: "transaction", params: { ignoradoEmRelatorio: true } },
    ];
    
    cases.forEach(({ input, shortcut, op, resource, params }) => {
      it(`atalho "${shortcut}": "${input}"`, async () => {
        const result = await parser.parse({ mensagem: input, state, userId: "user-1", canal: "web" });
        expect(result.usedShortcut).toBe(true);
        expect(result.request.op).toBe(op);
        expect(result.request.resource).toBe(resource);
        expect(result.request.params).toMatchObject(params);
        expect(result.request.references).toBeDefined();
      });
    });
  });
  
  describe("Referências estruturadas", () => {
    it("posicional: 'o segundo' → reference.target={type:'positional',index:2}", async () => {
      state = { ...state, lastResultSet: { ids: ["1","2","3"], query: {}, expiresAt: Date.now()+600000 } };
      const result = await parser.parse({ mensagem: "o segundo foi pessoal", state, userId: "u1", canal: "web" });
      expect(result.request.references?.target).toEqual({ type: "positional", index: 2 });
    });
    
    it("temporal: 'o de ontem' → reference.target={type:'temporal',relative:'yesterday'}", async () => {
      const result = await parser.parse({ mensagem: "corrige o de ontem para 50", state, userId: "u1", canal: "web" });
      expect(result.request.references?.target).toEqual({ type: "temporal", relative: "yesterday" });
    });
    
    it("merchant: 'o uber' → reference.target={type:'merchant',name:'uber'}", async () => {
      const result = await parser.parse({ mensagem: "o uber foi caro", state, userId: "u1", canal: "web" });
      expect(result.request.references?.target).toEqual({ type: "merchant", name: "uber" });
    });
    
    it("anafórico: 'aquele' → reference.target={type:'anaphoric',pronoun:'that'}", async () => {
      const result = await parser.parse({ mensagem: "aquele foi pessoal", state, userId: "u1", canal: "web" });
      expect(result.request.references?.target).toEqual({ type: "anaphoric", pronoun: "that" });
    });
    
    it("valor: 'o de 50' → reference.target={type:'value',amount:50}", async () => {
      const result = await parser.parse({ mensagem: "corrige o de 50 para 80", state, userId: "u1", canal: "web" });
      expect(result.request.references?.target).toEqual({ type: "value", amount: 50 });
    });
    
    it("conta: 'no nubank' → reference.account={type:'merchant',name:'nubank'}", async () => {
      const result = await parser.parse({ mensagem: "gastei 50 no nubank", state, userId: "u1", canal: "web" });
      expect(result.request.references?.account).toEqual({ type: "merchant", name: "nubank" });
    });
  });
  
  describe("Slot filling", () => {
    it("preenche data 'ontem'", async () => {
      const result = await parser.parse({ mensagem: "gastei 50 no uber", state, userId: "u1", canal: "web" });
      // Parser retorna com data = hoje; slot filling posterior aplica "ontem" se mencionado
    });
    
    it("forma pagamento default: cartão → credito", async () => {
      const result = await parser.parse({ mensagem: "gastei 50 no nubank", state, userId: "u1", canal: "web" });
      // Se cartão detectado, formaPagamento = "credito"
    });
  });
  
  describe("LLM Fallback", () => {
    it("caso não coberto por atalhos → usa LLM", async () => {
      // Mock LLM retorna UserRequest válido
      // Verifica meta.source = "llm"
    });
  });
});
```

---

## 3. ReferenceResolver Tests

**Arquivo:** `modulos/assistente/__testes__/reference-resolver.test.ts`

```typescript
describe("ReferenceResolver", () => {
  let resolver: ReferenceResolver;
  let deps: ResolverDeps;
  let state: ConversationState;
  
  beforeEach(() => {
    deps = createMockDeps();
    resolver = new ReferenceResolver(deps);
    state = createInitialState();
  });
  
  describe("Positional", () => {
    it("resolves 'o segundo' com lastResultSet", async () => {
      state.lastResultSet = { ids: ["mov-1", "mov-2", "mov-3"], query: { entityType: "transaction" }, expiresAt: Date.now()+600000 };
      deps.getEntitiesByIds.mockResolvedValue([
        { id: "mov-1", type: "transaction", label: "Uber R$ 42" },
        { id: "mov-2", type: "transaction", label: "Uber R$ 35" },
        { id: "mov-3", type: "transaction", label: "Uber R$ 62" },
      ]);
      
      const result = await resolver.resolve({ type: "positional", index: 2 }, deps, state);
      expect(result.status).toBe("resolved");
      expect(result.entity.entity.id).toBe("mov-2");
    });
    
    it("index fora do range → not_found", async () => {
      state.lastResultSet = { ids: ["mov-1"], query: {}, expiresAt: Date.now()+600000 };
      const result = await resolver.resolve({ type: "positional", index: 2 }, deps, state);
      expect(result.status).toBe("not_found");
    });
    
    it("paginação: offset considerado", async () => {
      state.lastResultSet = { ids: ["mov-1","mov-2","mov-3","mov-4"], query: { offset: 2, entityType: "transaction" }, expiresAt: Date.now()+600000 };
      // "o primeiro" da página = index 1 + offset 2 = ids[2]
    });
  });
  
  describe("Temporal", () => {
    it("resolves 'o de ontem' via lastResultSet", async () => {
      state.lastResultSet = { ids: ["mov-1", "mov-2"], query: {}, expiresAt: Date.now()+600000 };
      deps.getEntitiesByIds.mockResolvedValue([
        { id: "mov-1", metadata: { dataMovimento: "2026-08-22" } },
        { id: "mov-2", metadata: { dataMovimento: "2026-08-21" } },
      ]);
      
      const result = await resolver.resolve({ type: "temporal", relative: "yesterday" }, deps, state);
      expect(result.status).toBe("resolved");
      expect(result.entity.entity.id).toBe("mov-2"); // ontem
    });
  });
  
  describe("Value", () => {
    it("resolves 'o de 50' exact match", async () => {
      state.lastResultSet = { ids: ["mov-1", "mov-2"], query: {}, expiresAt: Date.now()+600000 };
      deps.getEntitiesByIds.mockResolvedValue([
        { id: "mov-1", metadata: { valor: 50 } },
        { id: "mov-2", metadata: { valor: 35 } },
      ]);
      
      const result = await resolver.resolve({ type: "value", amount: 50 }, deps, state);
      expect(result.status).toBe("resolved");
      expect(result.entity.entity.id).toBe("mov-1");
    });
  });
  
  describe("Merchant", () => {
    it("fuzzy match 'ubr' → uber", async () => {
      state.lastResultSet = { ids: ["mov-1"], query: {}, expiresAt: Date.now()+600000 };
      deps.getEntitiesByIds.mockResolvedValue([
        { id: "mov-1", metadata: { merchant: "Uber" } },
      ]);
      
      const result = await resolver.resolve({ type: "merchant", name: "ubr" }, deps, state);
      expect(result.status).toBe("resolved");
    });
    
    it("ambíguo: 3 ubers → ambiguous", async () => {
      state.lastResultSet = { ids: ["mov-1","mov-2","mov-3"], query: {}, expiresAt: Date.now()+600000 };
      deps.getEntitiesByIds.mockResolvedValue([
        { id: "mov-1", metadata: { merchant: "Uber", valor: 42 } },
        { id: "mov-2", metadata: { merchant: "Uber", valor: 35 } },
        { id: "mov-3", metadata: { merchant: "Uber", valor: 62 } },
      ]);
      
      const result = await resolver.resolve({ type: "merchant", name: "uber" }, deps, state);
      expect(result.status).toBe("ambiguous");
      expect(result.candidates.length).toBe(3);
    });
  });
  
  describe("Anaphoric", () => {
    it("'aquele' → currentEntity", async () => {
      state.currentEntity = { id: "mov-123", type: "transaction", label: "Uber R$ 50" };
      const result = await resolver.resolve({ type: "anaphoric", pronoun: "that" }, deps, state);
      expect(result.status).toBe("resolved");
      expect(result.entity.entity.id).toBe("mov-123");
    });
  });
  
  describe("Composite", () => {
    it("'aquele uber de ontem' → intersect positional+temporal+merchant", async () => {
      // Decompose parts → resolve each → intersect
      // Deve retornar único candidato que satisfaça todos
    });
  });
  
  describe("Política de ambiguidade", () => {
    it("nenhum candidato → not_found", async () => {
      const result = await resolver.resolve({ type: "merchant", name: "xyz" }, deps, state);
      expect(result.status).toBe("not_found");
    });
    
    it("1 candidato forte → resolved", async () => {
      // score diff >= 0.3 → resolved
    });
    
    it("múltiplos próximos → ambiguous", async () => {
      // score diff < 0.3 → ambiguous top 3
    });
  });
});
```

---

## 4. PolicyEngine Tests

**Arquivo:** `modulos/assistente/__testes__/policy-engine.test.ts`

```typescript
describe("PolicyEngine", () => {
  let engine: PolicyEngine;
  let state: ConversationState;
  
  beforeEach(() => {
    engine = new PolicyEngine();
    state = createInitialState();
  });
  
  const cases = [
    { name: "Query", request: { op: "query", resource: "transaction" }, expected: { allowed: true, confirm: false, reason: "auto" } },
    { name: "Create transaction", request: { op: "create", resource: "transaction" }, expected: { allowed: true, confirm: true, reason: "risk" } },
    { name: "Update conhecimento (categoria)", request: { op: "update", resource: "transaction", params: { categoriaId: "cat-1" } }, expected: { allowed: true, confirm: true, reason: "risk" } },
    { name: "Update fato (valor)", request: { op: "update", resource: "transaction", params: { valor: 80 } }, expected: { allowed: true, confirm: true, reason: "risk" } },
    { name: "Update fato (conta)", request: { op: "update", resource: "transaction", params: { contaId: "conta-1" } }, expected: { allowed: true, confirm: true, reason: "risk" } },
    { name: "Delete manual", request: { op: "delete", resource: "transaction", resolved: { target: { metadata: { fatoImutavel: false } } } }, expected: { allowed: true, confirm: true, reason: "risk" } },
    { name: "Delete OF → blocked", request: { op: "delete", resource: "transaction", resolved: { target: { metadata: { fatoImutavel: true } } } }, expected: { allowed: false, risk: "blocked", reason: "of_cannot_delete" } },
    { name: "Update fato OF → blocked", request: { op: "update", resource: "transaction", params: { valor: 80 }, resolved: { target: { metadata: { fatoImutavel: true } } } }, expected: { allowed: false, risk: "blocked", reason: "of_fato_immutable" } },
    { name: "Create recurrence", request: { op: "create", resource: "recurrence" }, expected: { allowed: true, confirm: true, reason: "risk" } },
    { name: "Ambiguidade → blocked", request: { op: "update", resource: "transaction", resolved: { target: null } }, expected: { allowed: false, risk: "blocked", reason: "ambiguity" } },
  ];
  
  cases.forEach(({ name, request, expected }) => {
    it(name, () => {
      const result = engine.evaluate(request, state);
      expect(result).toEqual(expected);
    });
  });
});
```

---

## 5. Commands Integration Tests

**Arquivo:** `modulos/assistente/__testes__/commands.test.ts`

```typescript
describe("Command Handlers Integration", () => {
  let motor: MotorFinanceiro;
  let repositorio: RepositorioFinanceiroDrizzle;
  let appService: ApplicationService;
  
  beforeAll(async () => {
    // Setup real DB (test container)
    motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());
    repositorio = new RepositorioFinanceiroDrizzle();
    appService = new ApplicationService(motor, repositorio, new MemoryIdempotencyStore(), new MockAuditoria());
  });
  
  afterAll(async () => { /* cleanup */ });
  
  describe("create_transaction", () => {
    it("cria despesa simples", async () => {
      const result = await appService.executeCommand({
        type: "create_transaction",
        input: { tipo: "despesa", valor: 50, dataMovimento: "2026-08-23", descricao: "Uber", contaId: "conta-nubank", formaPagamento: "credito" }
      }, { authenticatedUserId: "user-1", idempotencyKey: "key-1", traceId: "trace-1", stateVersion: 0 });
      
      expect(result.success).toBe(true);
      expect(result.data.id).toBeDefined();
      expect(result.entityRef.type).toBe("transaction");
    });
    
    it("falha se conta/cartão inválido", async () => {
      const result = await appService.executeCommand({
        type: "create_transaction",
        input: { tipo: "despesa", valor: 50, dataMovimento: "2026-08-23", descricao: "Test", formaPagamento: "credito" }
      }, { authenticatedUserId: "user-1", idempotencyKey: "key-2", traceId: "trace-2", stateVersion: 0 });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cartão obrigatório");
    });
    
    it("idempotência: mesma key retorna cached", async () => {
      const r1 = await appService.executeCommand({ type: "create_transaction", input: {...} }, ctx);
      const r2 = await appService.executeCommand({ type: "create_transaction", input: {...} }, { ...ctx, idempotencyKey: "same-key" });
      expect(r2.idempotent).toBe(true);
      expect(r2.data.id).toBe(r1.data.id);
    });
  });
  
  describe("update_transaction", () => {
    it("atualiza fato + conhecimento em 1 transação", async () => {
      // Cria movimento primeiro
      const created = await appService.executeCommand({ type: "create_transaction", input: {...} }, ctx);
      const movementId = created.data.id;
      
      // Atualiza valor + perfil
      const result = await appService.executeCommand({
        type: "update_transaction",
        input: { movementId, fatoPatch: { valor: 80 }, conhecimentoPatch: { perfil: "pj" } }
      }, { ...ctx, idempotencyKey: "update-1" });
      
      expect(result.success).toBe(true);
      // Verifica no banco: ambos campos atualizados na MESMA transação
    });
  });
  
  describe("cancel_transaction", () => {
    it("cancela movimento manual", async () => { /* ... */ });
    it("bloqueia OF (Core)", async () => { /* ... */ });
  });
  
  describe("query_transactions", () => {
    it("filtra por merchant", async () => { /* ... */ });
    it("paginação offset/limit", async () => { /* ... */ });
  });
});
```

---

## 6. E2E Tests (Conversas Críticas)

**Arquivo:** `modulos/assistente/__testes__/e2e-critical.test.ts`

```typescript
const CRITICAL_CONVERSATIONS = [
  {
    name: "Criar + Corrigir Data",
    turns: [
      { user: "Gastei 50 no Uber no Nubank", expect: { op: "create", success: true } },
      { user: "Foi ontem", expect: { op: "update", success: true, params: { dataMovimento: "2026-08-22" } } },
    ]
  },
  {
    name: "Consulta + Referência Posicional",
    turns: [
      { user: "Quanto gastei com Uber?", expect: { op: "query", lastResultSet: true } },
      { user: "O segundo foi pessoal", expect: { op: "update", params: { perfil: "pj" } } },
    ]
  },
  {
    name: "Correção Multi-campo",
    turns: [
      { user: "Gastei 100 no almoço", expect: { op: "create" } },
      { user: "Corrige aquele almoço para 80 no Itaú", expect: { op: "update", params: { valor: 80, contaId: "itau_id" }, confirm: true } },
    ]
  },
  {
    name: "Ambiguidade",
    turns: [
      { user: "Corrige o Uber", expect: { clarification: true, candidates: 3 } },
      { user: "2", expect: { op: "update", resolved: true } },
    ]
  },
  {
    name: "Open Finance Proteção",
    turns: [
      { user: "Apaga aquele lançamento do banco", expect: { blocked: true, reason: "of_cannot_delete" } },
    ]
  },
  {
    name: "Concorrência Web + WA",
    turns: [
      // Simula 2 requests simultâneos mesma sessão
    ]
  },
  {
    name: "Mensagem Duplicada WA",
    turns: [
      { user: "Gastei 50 no Uber", messageId: "msg-1" },
      { user: "Gastei 50 no Uber", messageId: "msg-1" }, // duplicata
    ]
  },
];

describe("Critical Conversations E2E", () => {
  let assistente: AssistenteCore;
  
  beforeEach(async () => {
    assistente = criarAssistenteCore();
  });
  
  CRITICAL_CONVERSATIONS.forEach(({ name, turns }) => {
    it(name, async () => {
      let state = createInitialState();
      let sessionId: string;
      
      for (const turn of turns) {
        const input: AssistenteInput = {
          usuarioId: "test-user",
          mensagem: turn.user,
          sessaoId,
          canal: "web",
          messageId: turn.messageId
        };
        
        const result = await assistente.processar(input);
        
        if (turn.expect.op) {
          // Verifica se operação correta executada
        }
        if (turn.expect.clarification) {
          expect(result.resposta).toContain("1.");
          expect(result.resposta).toContain("2.");
        }
        if (turn.expect.blocked) {
          expect(result.resposta).toContain("banco");
        }
        
        sessionId = result.sessaoId;
      }
    });
  });
});
```

---

## 7. WAR Metric Test

**Arquivo:** `modulos/assistente/__testes__/war-metric.test.ts`

```typescript
describe("Wrong Action Rate", () => {
  it("WAR = 0 em suite crítica", async () => {
    const results = await runCriticalConversations();
    
    const wrongActions = results.filter(r => r.wrongAction).length;
    const totalActions = results.filter(r => r.actionExecuted).length;
    
    const war = wrongActions / totalActions;
    expect(war).toBe(0);
  });
  
  const WRONG_ACTION_PATTERNS = [
    { type: "wrong_entity", description: "Alterou movimento errado" },
    { type: "unauthorized_write", description: "Escreveu em fato OF" },
    { type: "missing_confirmation", description: "Executou high/critical sem confirmar" },
    { type: "hallucinated_entity", description: "Inventou conta/cartão/categoria" },
    { type: "wrong_account", description: "Usou conta errada" },
  ];
  
  // Detector automático no trace
  function detectWrongAction(trace: TurnTrace): WrongActionType | null { /* ... */ }
});
```

---

## Comando de Execução

```bash
# Unit tests
pnpm --filter @lancai/assistente test

# Integration tests (requer DB)
pnpm --filter @lancai/assistente test:integration

# E2E (requer API rodando)
pnpm --filter @lancai/api test:e2e

# Coverage
pnpm --filter @lancai/assistente test:coverage
```

---

## Critério de Aprovação

| Métrica | Threshold |
|---------|-----------|
| Unit test coverage | ≥ 90% |
| Integration test pass | 100% |
| E2E critical conversations | 30/30 passam |
| WAR (staging) | 0 |
| Latência p95 | < 3s |
| TypeScript strict | 0 erros |