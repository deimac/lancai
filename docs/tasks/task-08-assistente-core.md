# Task 8: AssistenteCore + Feature Flags

## Arquivos:
- `modulos/assistente/agente/assistente-core.ts` (orquestrador principal)
- `apps/api/src/config/feature-flags.ts` (flags)
- `apps/api/src/servicos/assistente-v2.ts` (factory)
- `apps/api/src/rotas/chat.ts` (integração Web)
- `apps/api/src/rotas/webhooks-evolution.ts` (integração WA)

---

## 1. Feature Flags

## Arquivo: `apps/api/src/config/feature-flags.ts`

```typescript
export const FEATURE_FLAGS = {
  // Fase 1: SessionManager
  ASSISTENTE_V2_SESSION: process.env.ASSISTENTE_V2_SESSION === "true",
  
  // Fase 2: SemanticParser
  ASSISTENTE_V2_PARSER: process.env.ASSISTENTE_V2_PARSER === "true",
  
  // Fase 3: ReferenceResolver
  ASSISTENTE_V2_RESOLVER: process.env.ASSISTENTE_V2_RESOLVER === "true",
  
  // Fase 4: PolicyEngine
  ASSISTENTE_V2_POLICY: process.env.ASSISTENTE_V2_POLICY === "true",
  
  // Fase 5: Commands + ApplicationService
  ASSISTENTE_V2_EXECUTE: process.env.ASSISTENTE_V2_EXECUTE === "true",
  
  // Fase 6: Core Integration
  ASSISTENTE_V2_CORE: process.env.ASSISTENTE_V2_CORE === "true",
  
  // Fase 7: AssistenteCore completo (substitui legacy)
  ASSISTENTE_V2_ASSISTANT: process.env.ASSISTENTE_V2_ASSISTANT === "true",
  
  // Shadow mode: roda v2 em paralelo, loga diferenças
  ASSISTENTE_V2_SHADOW: process.env.ASSISTENTE_V2_SHADOW === "true",
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export function isFlagEnabled(key: FeatureFlagKey): boolean {
  return FEATURE_FLAGS[key];
}
```

## Variáveis de Ambiente (`.env`)

```bash
# Fase 1
ASSISTENTE_V2_SESSION=false
# Fase 2
ASSISTENTE_V2_PARSER=false
# Fase 3
ASSISTENTE_V2_RESOLVER=false
# Fase 4
ASSISTENTE_V2_POLICY=false
# Fase 5
ASSISTENTE_V2_EXECUTE=false
# Fase 6
ASSISTENTE_V2_CORE=false
# Fase 7
ASSISTENTE_V2_ASSISTANT=false
# Shadow mode (logging only)
ASSISTENTE_V2_SHADOW=false
```

---

## 2. AssistenteCore (Orquestrador Principal)

## Arquivo: `modulos/assistente/agente/assistente-core.ts`

```typescript
interface AssistenteInput {
  usuarioId: string;
  mensagem: string;
  sessaoId?: string;
  canal: "web" | "whatsapp";
  messageId?: string; // WhatsApp message ID para deduplicação
  intencaoPrevia?: Partial<UserRequest>; // multimodal
}

interface AssistenteOutput {
  resposta: string;
  sessaoId: string;
  traceId: string;
}

class AssistenteCore {
  constructor(
    private sessionManager: SessionManager,
    private semanticParser: SemanticParserV2,
    private referenceResolver: ReferenceResolver,
    private policyEngine: PolicyEngine,
    private commandExecutor: CommandExecutor, // usa ApplicationService
    private stateUpdater: StateUpdater,
    private responseGenerator: ResponseGenerator,
    private featureFlags: FeatureFlags
  ) {}

  async processar(input: AssistenteInput): Promise<AssistenteOutput> {
    const traceId = generateTraceId();
    const startTime = Date.now();
    
    try {
      // 1. SESSION MANAGER
      const session = await this.sessionManager.obterOuCriar(
        input.usuarioId, input.canal, input.sessaoId
      );
      
      // Deduplicação WhatsApp
      if (input.canal === "whatsapp" && input.messageId) {
        const jaProcessado = await this.sessionManager.jaProcessado(input.messageId);
        if (jaProcessado) {
          return this.getCachedResponse(session.sessaoId);
        }
        await this.sessionManager.marcarProcessado(input.messageId, session.id);
      }
      
      let state = session.contexto;
      
      // 2. SEMANTIC PARSER
      const parseResult = await this.semanticParser.parse({
        mensagem: input.mensagem,
        state,
        userId: input.usuarioId,
        canal: input.canal,
        intencaoPrevia: input.intencaoPrevia
      });
      
      // Shadow mode: log diferenças vs legacy
      if (this.featureFlags.ASSISTENTE_V2_SHADOW) {
        await this.logShadowComparison(input, parseResult);
      }
      
      // 3. REFERENCE RESOLVER
      const resolvedRequest = await this.referenceResolver.resolve(
        parseResult.request,
        state,
        { usuarioId: input.usuarioId }
      );
      
      // 4. POLICY ENGINE
      const policyDecision = this.policyEngine.evaluate(resolvedRequest, state);
      
      // 5. HANDLE POLICY DECISION
      let result: CommandResult;
      
      if (!policyDecision.allowed) {
        if (policyDecision.reason === "ambiguity") {
          return this.handleAmbiguity(resolvedRequest, state, policyDecision);
        }
        return this.handleBlocked(policyDecision);
      }
      
      if (policyDecision.confirm) {
        return this.requestConfirmation(resolvedRequest, state, policyDecision);
      }
      
      // 6. EXECUTE COMMAND
      result = await this.commandExecutor.execute(
        resolvedRequest.request,
        {
          authenticatedUserId: input.usuarioId,
          sessionId: session.id,
          idempotencyKey: generateIdempotencyKey(),
          traceId,
          stateVersion: state.version
        }
      );
      
      // 7. UPDATE STATE
      state = this.stateUpdater.updateAfterCommand(state, resolvedRequest.request, result);
      await this.sessionManager.atualizarEstado(session.id, s => state);
      
      // 8. GENERATE RESPONSE
      const resposta = await this.responseGenerator.generate(result, state, resolvedRequest);
      
      return { resposta, sessaoId: session.id, traceId };
      
    } catch (error) {
      return this.handleError(error, traceId);
    }
  }
  
  private async handleAmbiguity(request: ResolvedRequest, state: ConversationState, decision: PolicyDecision) {
    // Gera pergunta numerada com candidatos
    const candidates = request.resolved.target?.metadata?.candidates || [];
    const message = buildClarificationMessage(candidates);
    
    // Salva estado para próxima resposta
    // (próxima mensagem do usuário conterá "1", "2", etc.)
    return { resposta: message, sessaoId: "", traceId: "" };
  }
  
  private async requestConfirmation(request: ResolvedRequest, state: ConversationState, decision: PolicyDecision) {
    const confirmationRequest: ConfirmationRequest = {
      confirmationId: uuid(),
      requestHash: hashRequest(request),
      stateVersion: state.version,
      message: decision.message!,
      options: ["sim", "não"],
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 min
    };
    
    const newState = { ...state, version: state.version + 1, pendingConfirmation: confirmationRequest };
    // Salva estado com confirmação pendente
    await this.sessionManager.atualizarEstado(/* sessionId */, s => newState);
    
    return { resposta: decision.message!, sessaoId: "", traceId: "" };
  }
}
```

---

## 3. CommandExecutor

## Arquivo: `modulos/assistente/agente/command-executor.ts`

```typescript
class CommandExecutor {
  constructor(
    private applicationService: ApplicationService,
    private commandHandlers: Record<string, CommandHandler>
  ) {}

  async execute(request: UserRequest, context: CommandContext): Promise<CommandResult> {
    const handler = this.commandHandlers[request.op + "_" + request.resource];
    if (!handler) throw new Error(`Handler não encontrado: ${request.op}_${request.resource}`);
    
    return handler(request.params, context);
  }
}
```

---

## 4. ResponseGenerator

## Arquivo: `modulos/assistente/agente/response-generator.ts`

```typescript
class ResponseGenerator {
  async generate(result: CommandResult, state: ConversationState, request: ResolvedRequest): Promise<string> {
    if (!result.success) {
      return `Erro: ${result.error}`;
    }
    
    switch (request.request.op) {
      case "create":
        return this.formatCreate(result.data, request.request.resource);
      case "update":
        return `Pronto. ${request.resolved.target?.label} atualizado.`;
      case "delete":
        return "Cancelado.";
      case "query":
        return this.formatQueryResult(result.data, request.request.resource);
      case "classify":
        return `Classificado como ${result.data.categoria}.`;
    }
    return "Operação realizada.";
  }
  
  private formatCreate(data: any, resource: string): string {
    if (resource === "transaction") {
      return `Lançado: ${data.descricao} ${formatCurrency(data.valor)} no ${data.contaNome || data.cartaoNome}.`;
    }
    if (resource === "recurrence") {
      return `Recorrência criada: ${data.descricao} todo dia ${data.diaDoMes}.`;
    }
    if (resource === "rule") {
      return `Regra criada: ${data.merchant} → ${data.categoriaNome}.`;
    }
    return "Criado com sucesso.";
  }
  
  private formatQueryResult(data: any, resource: string): string {
    // Formatação existente (ModuloRelatorios) + paginação
    return data.formattedText;
  }
}
```

---

## 4. Factory (Dependency Injection)

## Arquivo: `apps/api/src/servicos/assistente-v2.ts`

```typescript
export function criarAssistenteCore(): AssistenteCore {
  const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());
  const repositorio = new RepositorioFinanceiroDrizzle();
  const idempotencyStore = new RedisIdempotencyStore(); // ou Postgres
  const auditoria = new AuditoriaService();
  
  const applicationService = new ApplicationService(motor, repositorio, idempotencyStore, new AuditoriaService());
  const commandExecutor = new CommandExecutor(applicationService, COMMAND_HANDLERS);
  
  return new AssistenteCore(
    new SessionManager(new SessionRepositoryDrizzle()),
    new SemanticParserV2(),
    new ReferenceResolver(new ReferenceResolverDepsDrizzle()),
    new PolicyEngine(),
    commandExecutor,
    new StateUpdater(),
    new ResponseGenerator(),
    FEATURE_FLAGS
  );
}
```

---

## 5. Integração Web (Chat)

## Arquivo: `apps/api/src/rotas/chat.ts`

```typescript
import { criarAssistenteCore } from "../servicos/assistente-v2";
import { FEATURE_FLAGS, isFlagEnabled } from "../config/feature-flags";

const assistenteV2 = criarAssistenteCore();

export async function registrarRotasChat(app: FastifyInstance) {
  app.post("/chat", async (req, res) => {
    const { usuarioId, mensagem, sessaoId } = schemaChat.parse(req.body);
    
    if (isFlagEnabled("ASSISTENTE_V2_ASSISTANT")) {
      const resultado = await assistenteV2.processar({
        usuarioId,
        mensagem,
        sessaoId,
        canal: "web"
      });
      return res.send({ resposta: resultado.resposta, sessaoId: resultado.sessaoId });
    }
    
    // Legacy
    return processarTurnoLegado(req, res);
  });
}
```

---

## 6. Integração WhatsApp

## Arquivo: `apps/api/src/servicos/processar-mensagem-whatsapp.ts`

```typescript
import { criarAssistenteCore } from "../servicos/assistente-v2";
import { isFlagEnabled } from "../config/feature-flags";

const assistenteV2 = criarAssistenteCore();

export async function processarMensagemWhatsApp(input: WhatsAppInput) {
  if (isFlagEnabled("ASSISTENTE_V2_ASSISTANT")) {
    return assistenteV2.processar({
      usuarioId: input.usuarioId,
      mensagem: input.texto,
      canal: "whatsapp",
      messageId: input.messageId, // para deduplicação
      intencaoPrevia: input.intencaoPrevia
    });
  }
  
  return processarTurnoLegado(input);
}
```

---

## 7. Shadow Mode (Logging Comparativo)

```typescript
// Em assistente-core.ts, dentro de processar()
if (this.featureFlags.ASSISTENTE_V2_SHADOW) {
  const legacyResult = await this.runLegacy(input); // processar-turno-conversa atual
  const v2Result = { resposta, sessaoId, traceId };
  
  // Log estruturado para comparação
  req.log.info({
    traceId,
    shadow: true,
    legacy: { resposta: legacyResult.resposta, intencao: legacyResult.intencao },
    v2: { resposta: v2Result.resposta, request: parseResult.request, policy: policyDecision }
  }, "[assistant-v2] Shadow comparison");
}
```

---

## Testes Obrigatórios

| Teste | Descrição |
|-------|-----------|
| Fluxo completo: create → query → reference → update | 5 conversas E2E passam |
| Feature flag OFF → usa legacy | `ASSISTENTE_V2_ASSISTANT=false` → legacy roda |
| Feature flag ON → usa v2 | `ASSISTENTE_V2_ASSISTANT=true` → v2 roda |
| Shadow mode loga diferenças | `ASSISTENTE_V2_SHADOW=true` → logs comparativos |
| Deduplicação WA | messageId duplicado → resposta cacheada |
| Confirmação "sim"/"não" | pendingConfirmation resolvido corretamente |
| Ambiguidade → pergunta | 3 candidatos → resposta numerada |
| Bloqueio OF | update fato OF → bloqueado com mensagem |
| Error handling | Erro no Core → resposta amigável + traceId |

---

## Critério de Conclusão Task 8
- [ ] Feature flags funcionam (ON/OFF/SHADOW)
- [ ] AssistenteCore orquestra todos componentes
- [ ] Integração Web + WA funcional
- [ ] Shadow mode loga diferenças sem afetar usuário
- [ ] Deduplicação WA: 1000 msgs duplicadas → 0 processadas 2x
- [ ] Testes E2E: 15 conversas passam
- [ ] Feature flag `ASSISTENTE_V2_ASSISTANT=true` em staging → 0 regressões