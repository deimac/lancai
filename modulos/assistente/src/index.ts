export { err, ok, type Result } from "./resultado";
export { SessionManager, type SessionManagerOpcoes } from "./agente/session-manager";
export { SessionManagerV3, type SessionManagerV3Opcoes, type SessionRecordV3 } from "./agente/session-manager-v3";
export { documentoMistoDeContextoV3 } from "./agente/documento-misto";
export {
  AssistenteCoreV3,
  type AssistenteCoreV3Opcoes,
  type CatalogoNomesAssistente,
} from "./agente/assistente-core-v3";
export { SemanticParserV2, type LlmParser, type SemanticParserDeps } from "./agente/semantic-parser-v2";
export { UnderstandingExtractor, type EntradaUnderstandingExtractor } from "./agente/understanding-extractor";
export { understandingToNeed, type OpcoesUnderstandingToNeed } from "./agente/understanding-to-need";
export { planQuery, QueryPlanner } from "./agente/query-planner";
export { planCommand, CommandPlanner, type CommandPlanResult, type OpcoesCommandPlanner } from "./agente/command-planner";
export {
  ReferenceResolverV3,
  resolveReferenceV3,
  type ResolverDepsV3,
} from "./agente/reference-resolver-v3";
export {
  ContextUpdater,
  updateAfterUnderstanding,
  updateAfterNeed,
  updateAfterPlan,
  updateAfterExecution,
  updateAfterReferenceResolved,
  updateConversationContext,
  type ContextUpdaterOpcoes,
} from "./agente/context-updater";
export {
  montarPromptSistemaUnderstanding,
  montarPromptUsuarioUnderstanding,
  compactarConversationContext,
  HISTORICO_MAX_TURNOS,
  type TurnoUnderstanding,
} from "./prompts/understanding";
export { mapearIntencaoParaUserRequest } from "./agente/mapear-intencao";
export { ReferenceResolver, type ResolverDeps, type ResolverContext } from "./agente/reference-resolver";
export { PolicyEngine } from "./agente/policy-engine";
export { CommandExecutor } from "./agente/command-executor";
export { StateUpdater } from "./agente/state-updater";
export { ResponseGenerator } from "./agente/response-generator";
export { AssistenteCore, type AssistenteInput, type AssistenteOutput } from "./agente/assistente-core";
export { detectWrongAction, type TurnTrace, type WrongActionType } from "./agente/war-detector";
export { SessionRepositoryMemory } from "./repositorio/session-repository-memory";
export {
  SessionRepositoryDrizzle,
  PostgresIdempotencyStore,
} from "./repositorio/session-repository-drizzle";
export { ReferenceResolverDepsDrizzle } from "./repositorio/resolver-deps-drizzle";
export type {
  CanalSessao,
  SessionDocumento,
  SessionDocumentoRecord,
  SessionRecord,
  SessionRepository,
} from "./repositorio/tipos-sessao";
export {
  ApplicationService,
  financeiroDoCore,
  NoopAuditoria,
  type FinanceiroPort,
} from "./application/application-service";
export { MemoryIdempotencyStore } from "./application/idempotency-store";
