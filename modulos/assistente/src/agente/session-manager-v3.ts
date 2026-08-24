import { randomUUID } from "node:crypto";
import {
  estadoInicialConversacaoV3,
  normalizarConversationContext,
  type ConversationContext,
} from "@lancai/tipos";
import { err, ok, type Result } from "../resultado";
import type {
  CanalSessao,
  SessionDocumentoRecord,
  SessionRepository,
} from "../repositorio/tipos-sessao";
import { documentoMistoDeContextoV3 } from "./documento-misto";

const MAX_TENTATIVAS = 4;
const TTL_MESSAGE_ID_MS = 24 * 60 * 60 * 1000;

export type SessionManagerV3Opcoes = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  agoraMs?: () => number;
};

export interface SessionRecordV3 {
  id: string;
  usuarioId: string;
  contexto: ConversationContext;
  updatedAt: Date;
}

function sleepPadrao(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function versaoDe(documento: SessionDocumentoRecord["documento"]): number {
  return typeof documento.version === "number" && Number.isFinite(documento.version)
    ? documento.version
    : 0;
}

/**
 * Sessão do Core V3: lê JSONB cru, promove ConversationContext em memória (schema 2)
 * e grava documento misto com schemaVersion 1. Não substitui o SessionManager v1.
 */
export class SessionManagerV3 {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: SessionRepository,
    private readonly opcoes: SessionManagerV3Opcoes = {},
  ) {}

  private agora(): Date {
    return this.opcoes.now?.() ?? new Date();
  }

  private agoraMs(): number {
    const n = this.opcoes.agoraMs?.() ?? this.agora().getTime();
    return n > 0 ? n : 1;
  }

  private sleep(ms: number): Promise<void> {
    return (this.opcoes.sleep ?? sleepPadrao)(ms);
  }

  private paraRegistro(doc: SessionDocumentoRecord): SessionRecordV3 {
    return {
      id: doc.id,
      usuarioId: doc.usuarioId,
      contexto: normalizarConversationContext(doc.documento, this.agoraMs()),
      updatedAt: doc.updatedAt,
    };
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
   * `persistir: false` (shadow): não insere linha se a sessão não existir.
   */
  async obterOuCriar(
    usuarioId: string,
    canal: CanalSessao,
    sessaoId?: string,
    opcoes: { persistir?: boolean } = {},
  ): Promise<SessionRecordV3> {
    const persistir = opcoes.persistir !== false;

    if (sessaoId) {
      const existente = await this.repo.getDocumento(sessaoId);
      if (existente && existente.usuarioId === usuarioId) return this.paraRegistro(existente);
    }

    if (canal === "whatsapp") {
      const ativa = await this.repo.getDocumentoByUsuarioAtiva(usuarioId);
      if (ativa) return this.paraRegistro(ativa);
    }

    if (!persistir) {
      return {
        id: sessaoId ?? randomUUID(),
        usuarioId,
        contexto: estadoInicialConversacaoV3(this.agoraMs()),
        updatedAt: this.agora(),
      };
    }

    const inicial = estadoInicialConversacaoV3(this.agoraMs());
    const criado = await this.repo.createDocumento(usuarioId, documentoMistoDeContextoV3(inicial));
    return this.paraRegistro(criado);
  }

  /**
   * Aplica updater com optimistic locking. `version` é incrementada pelo manager
   * (o mesmo número nos dois lados do documento misto).
   */
  async atualizarEstado(
    sessionId: string,
    updater: (state: ConversationContext) => ConversationContext,
  ): Promise<Result<ConversationContext, string>> {
    return this.comLock(sessionId, async () => {
      for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
        const sessao = await this.repo.getDocumento(sessionId);
        if (!sessao) return err("Sessão não encontrada");

        const versaoAtual = versaoDe(sessao.documento);
        const atual = normalizarConversationContext(sessao.documento, this.agoraMs());
        const novo = updater(atual);
        const estado: ConversationContext = {
          ...novo,
          schemaVersion: 2,
          version: versaoAtual + 1,
        };
        const documento = documentoMistoDeContextoV3(estado);
        documento.version = versaoAtual + 1;

        const gravou = await this.repo.compareAndSwapDocumento(sessionId, versaoAtual, documento);
        if (gravou) return ok(estado);

        if (tentativa < MAX_TENTATIVAS - 1) {
          await this.sleep(50 * (tentativa + 1));
        }
      }
      return err("Concurrency conflict: max retries exceeded");
    });
  }

  async jaProcessado(messageId: string): Promise<boolean> {
    return this.repo.findMessageId(messageId);
  }

  async marcarProcessado(messageId: string, sessionId: string): Promise<void> {
    await this.repo.upsertMessageId(messageId, sessionId);
  }

  async limparMessageIdsAntigos(): Promise<number> {
    const corte = new Date(this.agora().getTime() - TTL_MESSAGE_ID_MS);
    return this.repo.deleteMessageIdsOlderThan(corte);
  }
}
