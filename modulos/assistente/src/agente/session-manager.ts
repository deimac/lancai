import { estadoInicialConversacao, type ConversationState } from "@lancai/tipos";
import { err, ok, type Result } from "../resultado";
import type { CanalSessao, SessionRecord, SessionRepository } from "../repositorio/tipos-sessao";

const MAX_TENTATIVAS = 4;
const TTL_MESSAGE_ID_MS = 24 * 60 * 60 * 1000;

export type SessionManagerOpcoes = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

function sleepPadrao(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Carrega/cria sessão, versiona ConversationState com CAS e deduplica messageId do WhatsApp.
 */
export class SessionManager {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: SessionRepository,
    private readonly opcoes: SessionManagerOpcoes = {},
  ) {}

  private agora(): Date {
    return this.opcoes.now?.() ?? new Date();
  }

  private sleep(ms: number): Promise<void> {
    return (this.opcoes.sleep ?? sleepPadrao)(ms);
  }

  /**
   * Serializa atualizações por sessão mesmo no repositório em memória.
   * O lock é sempre liberado (try/finally), inclusive se o updater lançar.
   */
  private async comLock<T>(sessionId: string, tarefa: () => Promise<T>): Promise<T> {
    const anterior = this.locks.get(sessionId) ?? Promise.resolve();
    let liberar: () => void = () => undefined;
    const atual = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    this.locks.set(sessionId, anterior.then(() => atual));
    await anterior;
    try {
      return await tarefa();
    } finally {
      liberar();
      if (this.locks.get(sessionId) === atual) this.locks.delete(sessionId);
    }
  }

  /**
   * Web: usa sessaoId se existir; senão cria. WhatsApp: reusa a sessão ativa mais recente.
   */
  async obterOuCriar(
    usuarioId: string,
    canal: CanalSessao,
    sessaoId?: string,
  ): Promise<SessionRecord> {
    if (sessaoId) {
      const existente = await this.repo.get(sessaoId);
      if (existente && existente.usuarioId === usuarioId) return existente;
    }

    if (canal === "whatsapp") {
      const ativa = await this.repo.getByUsuarioAtiva(usuarioId);
      if (ativa) return ativa;
    }

    return this.repo.create(usuarioId, estadoInicialConversacao());
  }

  /**
   * Aplica updater com optimistic locking. `version` é incrementada pelo manager.
   */
  async atualizarEstado(
    sessionId: string,
    updater: (state: ConversationState) => ConversationState,
  ): Promise<Result<ConversationState, string>> {
    return this.comLock(sessionId, async () => {
      for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
        const sessao = await this.repo.get(sessionId);
        if (!sessao) return err("Sessão não encontrada");

        const versaoAtual = sessao.contexto.version;
        const novo = updater(sessao.contexto);
        const estado: ConversationState = { ...novo, version: versaoAtual + 1 };

        const gravou = await this.repo.compareAndSwap(sessionId, versaoAtual, estado);
        if (gravou) return ok(estado);

        if (tentativa < MAX_TENTATIVAS - 1) {
          await this.sleep(50 * (tentativa + 1));
        }
      }
      return err("Concurrency conflict: max retries exceeded");
    });
  }

  /** Verifica se o messageId WhatsApp já foi processado. */
  async jaProcessado(messageId: string): Promise<boolean> {
    return this.repo.findMessageId(messageId);
  }

  /** Marca messageId como processado (idempotente). */
  async marcarProcessado(messageId: string, sessionId: string): Promise<void> {
    await this.repo.upsertMessageId(messageId, sessionId);
  }

  /** Remove messageIds com mais de 24h. */
  async limparMessageIdsAntigos(): Promise<number> {
    const corte = new Date(this.agora().getTime() - TTL_MESSAGE_ID_MS);
    return this.repo.deleteMessageIdsOlderThan(corte);
  }
}
