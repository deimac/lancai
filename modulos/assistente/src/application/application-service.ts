import type { MotorFinanceiro } from "@lancai/financeiro";
import type { ServicoConhecimento } from "@lancai/conhecimento";
import { hojeISO } from "@lancai/tipos";
import type {
  CommandContext,
  CommandResult,
  EntityRef,
  QuerySpec,
  SimpleCommand,
} from "@lancai/tipos";
import type { IdempotencyStore } from "./idempotency-store";

export interface MovimentoResumo {
  id: string;
  status: string;
  fonte: string;
  usuarioId: string;
  descricao: string;
}

export interface FinanceiroPort {
  criarMovimento(entrada: Record<string, unknown>): Promise<{ id: string; descricao: string; valor?: unknown }>;
  corrigirFato(entrada: Record<string, unknown>): Promise<{ id: string; descricao: string }>;
  atualizarConhecimento(entrada: Record<string, unknown>): Promise<{ id: string; descricao: string }>;
  obterMovimento(id: string): Promise<MovimentoResumo | null>;
  obterConta(id: string): Promise<{ id: string; ativo: boolean } | null>;
}

export interface RecurrencePort {
  criar(input: {
    usuarioId: string;
    descricao: string;
    valor: number;
    diaDoMes: number;
    tipo: "despesa" | "receita";
    categoriaId: string;
    contaId?: string;
    cartaoId?: string;
  }): Promise<{ id: string; descricao: string; diaDoMes: number }>;
}

export interface RulePort {
  criar(input: {
    workspaceId: string;
    merchant: string;
    categoriaId: string;
  }): Promise<{ id: string; nome: string }>;
}

export type OpcoesConsultaAssistente = {
  primeiroNome?: string;
  dataAtual?: string;
};

export interface QueryPort {
  consultar(
    spec: QuerySpec,
    usuarioId: string,
    opcoes?: OpcoesConsultaAssistente,
  ): Promise<{ ids: string[]; formattedText: string; data?: unknown }>;
}

export interface CatalogoPort {
  workspaceId(usuarioId: string): Promise<string>;
  categoriaNaoClassificado(usuarioId: string): Promise<string>;
}

export interface AuditoriaPort {
  logCommand(command: SimpleCommand, context: CommandContext, result: CommandResult): Promise<void>;
}

export class NoopAuditoria implements AuditoriaPort {
  async logCommand(): Promise<void> {}
}

/**
 * Adaptador fino: idempotência, revalidação e uma chamada ao Core por comando.
 */
export class ApplicationService {
  constructor(
    private readonly deps: {
      financeiro: FinanceiroPort;
      catalogo: CatalogoPort;
      idempotency: IdempotencyStore;
      auditoria: AuditoriaPort;
      recorrencia?: RecurrencePort;
      regras?: RulePort;
      consultas?: QueryPort;
    },
  ) {}

  async executeCommand(command: SimpleCommand, context: CommandContext): Promise<CommandResult> {
    const cached = await this.deps.idempotency.get(context.idempotencyKey);
    if (cached) return { ...cached, idempotent: true };

    try {
      await this.revalidate(command, context);
      const result = await this.dispatch(command, context);
      await this.deps.auditoria.logCommand(command, context, result);
      if (result.success) await this.deps.idempotency.set(context.idempotencyKey, result);
      return result;
    } catch (erro) {
      const message = erro instanceof Error ? erro.message : String(erro);
      return { success: false, error: message };
    }
  }

  private async revalidate(command: SimpleCommand, context: CommandContext): Promise<void> {
    if (command.type === "update_transaction" || command.type === "cancel_transaction") {
      const id = command.input.movementId;
      const movimento = await this.deps.financeiro.obterMovimento(id);
      if (!movimento) throw new Error("Movimento não encontrado");
      if (movimento.status === "cancelado") throw new Error("Movimento já cancelado");
      if (movimento.usuarioId !== context.authenticatedUserId) throw new Error("Movimento não encontrado");
    }
    if (command.type === "create_transaction" && command.input.contaId) {
      const conta = await this.deps.financeiro.obterConta(command.input.contaId);
      if (!conta || !conta.ativo) throw new Error("Conta inválida ou inativa");
    }
  }

  private async dispatch(command: SimpleCommand, context: CommandContext): Promise<CommandResult> {
    switch (command.type) {
      case "create_transaction":
        return this.executeCreate(command.input, context);
      case "update_transaction":
        return this.executeUpdate(command.input, context);
      case "cancel_transaction":
        return this.executeCancel(command.input.movementId, context);
      case "query_transactions":
        return this.executeQuery(command.spec, context);
      case "create_recurrence":
        return this.executeRecurrence(command.input, context);
      case "create_rule":
        return this.executeRule(command.input, context);
    }
  }

  private entity(id: string, type: EntityRef["type"], label: string): EntityRef {
    return { id, type, label };
  }

  private async executeCreate(
    input: Extract<SimpleCommand, { type: "create_transaction" }>["input"],
    context: CommandContext,
  ): Promise<CommandResult> {
    const workspaceId = await this.deps.catalogo.workspaceId(context.authenticatedUserId);
    const categoriaId =
      input.categoriaId ?? (await this.deps.catalogo.categoriaNaoClassificado(context.authenticatedUserId));
    const pagamento = input.papel === "pagamento_fatura";
    const descricao =
      input.descricao ?? (pagamento ? "Pagamento de fatura" : "Lançamento");
    const soNoCartao = Boolean(input.cartaoId) && !input.contaId;
    const tipo = pagamento && soNoCartao ? "receita" : input.tipo ?? "despesa";
    const dataMovimento = input.dataMovimento ?? hojeISO();
    const criado = await this.deps.financeiro.criarMovimento({
      workspaceId,
      descricao,
      valor: input.valor,
      tipo,
      tipoGasto: input.perfil ?? "pf",
      dataMovimento,
      contaId: input.contaId,
      cartaoId: input.cartaoId,
      contaDestinoId: input.contaDestinoId,
      categoriaId,
      pessoaId: input.pessoaId,
      formaPagamento: input.formaPagamento,
      usuarioId: context.authenticatedUserId,
      criadoPor: context.authenticatedUserId,
      fonte: "manual",
    });
    if (pagamento) {
      await this.deps.financeiro.atualizarConhecimento({
        movimentoId: criado.id,
        alteradoPor: context.authenticatedUserId,
        conhecimento: {
          papel: "pagamento_fatura",
          cartaoFaturaId: input.cartaoFaturaId ?? input.cartaoId ?? null,
          competenciaFatura: input.competenciaFatura ?? dataMovimento.slice(0, 7),
        },
      });
    }
    return {
      success: true,
      data: criado,
      entityRef: this.entity(criado.id, "transaction", criado.descricao),
    };
  }

  private async executeUpdate(
    input: Extract<SimpleCommand, { type: "update_transaction" }>["input"],
    context: CommandContext,
  ): Promise<CommandResult> {
    let ultimo: { id: string; descricao: string } | undefined;
    if (input.fatoPatch && Object.keys(input.fatoPatch).length > 0) {
      const campos: Record<string, unknown> = {};
      if (input.fatoPatch.valor !== undefined) campos.valor = input.fatoPatch.valor;
      if (input.fatoPatch.dataMovimento !== undefined) campos.dataMovimento = input.fatoPatch.dataMovimento;
      if (input.fatoPatch.contaId) campos.contaId = input.fatoPatch.contaId;
      if (input.fatoPatch.cartaoId) campos.cartaoId = input.fatoPatch.cartaoId;
      if (input.fatoPatch.formaPagamento !== undefined) campos.formaPagamento = input.fatoPatch.formaPagamento;
      ultimo = await this.deps.financeiro.corrigirFato({
        movimentoId: input.movementId,
        alteradoPor: context.authenticatedUserId,
        campos,
      });
    }
    if (input.conhecimentoPatch && Object.keys(input.conhecimentoPatch).length > 0) {
      const conhecimento: Record<string, unknown> = {};
      if (input.conhecimentoPatch.categoriaId !== undefined) conhecimento.categoriaId = input.conhecimentoPatch.categoriaId;
      if (input.conhecimentoPatch.pessoaId !== undefined) conhecimento.pessoaId = input.conhecimentoPatch.pessoaId;
      if (input.conhecimentoPatch.perfil !== undefined) conhecimento.tipoGasto = input.conhecimentoPatch.perfil;
      if (input.conhecimentoPatch.tags !== undefined) conhecimento.tags = input.conhecimentoPatch.tags;
      if (input.conhecimentoPatch.observacoes !== undefined) conhecimento.observacoes = input.conhecimentoPatch.observacoes;
      if (input.conhecimentoPatch.ignoradoEmRelatorio !== undefined) {
        conhecimento.ignoradoEmRelatorio = input.conhecimentoPatch.ignoradoEmRelatorio;
      }
      ultimo = await this.deps.financeiro.atualizarConhecimento({
        movimentoId: input.movementId,
        alteradoPor: context.authenticatedUserId,
        conhecimento,
      });
    }
    if (!ultimo) return { success: false, error: "Nenhum campo para alterar" };
    return {
      success: true,
      data: ultimo,
      entityRef: this.entity(ultimo.id, "transaction", ultimo.descricao),
    };
  }

  private async executeCancel(movementId: string, context: CommandContext): Promise<CommandResult> {
    const cancelado = await this.deps.financeiro.corrigirFato({
      movimentoId: movementId,
      alteradoPor: context.authenticatedUserId,
      campos: { status: "cancelado" },
    });
    return {
      success: true,
      data: cancelado,
      entityRef: this.entity(cancelado.id, "transaction", cancelado.descricao),
    };
  }

  private async executeQuery(spec: QuerySpec, context: CommandContext): Promise<CommandResult> {
    if (!this.deps.consultas) return { success: true, data: { ids: [], formattedText: "Sem dados." } };
    const data = await this.deps.consultas.consultar(spec, context.authenticatedUserId, {
      primeiroNome: context.primeiroNome,
      dataAtual: context.dataAtual,
    });
    return { success: true, data };
  }

  private async executeRecurrence(
    input: Extract<SimpleCommand, { type: "create_recurrence" }>["input"],
    context: CommandContext,
  ): Promise<CommandResult> {
    if (!this.deps.recorrencia) return { success: false, error: "Recorrência não configurada" };
    const categoriaId =
      input.categoriaId ?? (await this.deps.catalogo.categoriaNaoClassificado(context.authenticatedUserId));
    const criada = await this.deps.recorrencia.criar({
      usuarioId: context.authenticatedUserId,
      descricao: input.descricao,
      valor: input.valor,
      diaDoMes: input.diaDoMes,
      tipo: "despesa",
      categoriaId,
      contaId: input.contaId,
      cartaoId: input.cartaoId,
    });
    return {
      success: true,
      data: criada,
      entityRef: this.entity(criada.id, "recurrence", criada.descricao),
    };
  }

  private async executeRule(
    input: Extract<SimpleCommand, { type: "create_rule" }>["input"],
    context: CommandContext,
  ): Promise<CommandResult> {
    if (!this.deps.regras) return { success: false, error: "Regras não configuradas" };
    const workspaceId = await this.deps.catalogo.workspaceId(context.authenticatedUserId);
    const criada = await this.deps.regras.criar({
      workspaceId,
      merchant: input.merchant,
      categoriaId: input.categoriaId,
    });
    return {
      success: true,
      data: criada,
      entityRef: this.entity(criada.id, "rule", criada.nome),
    };
  }
}

/** Liga MotorFinanceiro + ServicoConhecimento na porta usada pelo ApplicationService. */
export function financeiroDoCore(
  motor: MotorFinanceiro,
  conhecimento: ServicoConhecimento,
  repositorio: {
    obterMovimento(id: string): Promise<{ id: string; status: string; fonte: string; usuarioId: string; descricao: string } | undefined>;
    obterConta(id: string): Promise<{ id: string; ativo: boolean } | undefined>;
  },
): FinanceiroPort {
  return {
    async criarMovimento(entrada) {
      const r = await motor.criar_movimento(entrada as never);
      const m = r.movimentos[0];
      if (!m) throw new Error("Falha ao criar movimento");
      return { id: m.id, descricao: m.descricao, valor: m.valor };
    },
    async corrigirFato(entrada) {
      const m = await motor.corrigir_fato_manual(entrada as never);
      return { id: m.id, descricao: m.descricao };
    },
    async atualizarConhecimento(entrada) {
      const m = await conhecimento.atualizar(entrada as never);
      return { id: m.id, descricao: m.descricao };
    },
    async obterMovimento(id) {
      const m = await repositorio.obterMovimento(id);
      return m ?? null;
    },
    async obterConta(id) {
      const c = await repositorio.obterConta(id);
      return c ?? null;
    },
  };
}
