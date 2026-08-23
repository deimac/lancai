import type {
  CommandResult,
  ConversationState,
  EntityRef,
  QuerySpec,
  SimpleCommand,
} from "@lancai/tipos";

const TTL_RESULTSET_MS = 10 * 60 * 1000;

function proximaVersao(state: ConversationState): ConversationState {
  return { ...state, version: state.version + 1 };
}

/**
 * Atualiza ConversationState após cada passo. Sempre imutável; incrementa version.
 */
export class StateUpdater {
  updateAfterCommand(
    state: ConversationState,
    command: SimpleCommand,
    result: CommandResult,
  ): ConversationState {
    const novo = proximaVersao(state);
    if (!result.success) return { ...novo, pendingConfirmation: undefined };

    const entityRef = result.entityRef;
    let lastResultSet = state.lastResultSet;
    let currentEntity = state.currentEntity;

    if (entityRef?.type === "transaction") {
      if (state.lastResultSet?.ids.includes(entityRef.id)) lastResultSet = undefined;
      if (command.type === "create_transaction") {
        lastResultSet = undefined;
        currentEntity = entityRef;
      } else if (state.currentEntity?.id === entityRef.id) {
        currentEntity = command.type === "cancel_transaction" ? undefined : { ...entityRef };
      }
    }

    return { ...novo, lastResultSet, currentEntity, pendingConfirmation: undefined };
  }

  updateAfterQuery(state: ConversationState, querySpec: QuerySpec, resultIds: string[]): ConversationState {
    return {
      ...proximaVersao(state),
      lastResultSet: {
        ids: resultIds,
        query: querySpec,
        expiresAt: Date.now() + TTL_RESULTSET_MS,
      },
    };
  }

  updateAfterConfirmation(state: ConversationState, _confirmed: boolean): ConversationState {
    return { ...proximaVersao(state), pendingConfirmation: undefined };
  }

  updateAfterReferenceResolved(state: ConversationState, entityRef: EntityRef): ConversationState {
    return { ...proximaVersao(state), currentEntity: entityRef };
  }

  clearPendingConfirmation(state: ConversationState): ConversationState {
    if (!state.pendingConfirmation) return state;
    return { ...proximaVersao(state), pendingConfirmation: undefined };
  }
}
