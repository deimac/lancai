export { err, ok, type Result } from "./resultado";
export { SessionManager, type SessionManagerOpcoes } from "./agente/session-manager";
export { SemanticParserV2, type LlmParser, type SemanticParserDeps } from "./agente/semantic-parser-v2";
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
export type { CanalSessao, SessionRecord, SessionRepository } from "./repositorio/tipos-sessao";
export {
  ApplicationService,
  financeiroDoCore,
  NoopAuditoria,
  type FinanceiroPort,
} from "./application/application-service";
export { MemoryIdempotencyStore } from "./application/idempotency-store";
