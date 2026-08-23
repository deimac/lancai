import type { IntencaoDetectada, UserRequest } from "@lancai/tipos";

function limparNulo<T extends Record<string, unknown>>(obj: T): T {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) saida[k] = v;
  }
  return saida as T;
}

/**
 * Converte IntencaoDetectada (legado) para UserRequest v2.
 */
export function mapearIntencaoParaUserRequest(intencao: IntencaoDetectada): UserRequest {
  switch (intencao.intencao) {
    case "REGISTRAR_MOVIMENTO":
      return {
        op: "create",
        resource: "transaction",
        params: limparNulo({
          tipo: intencao.tipo_movimento,
          valor: intencao.valor ?? undefined,
          dataMovimento: intencao.data_movimento ?? undefined,
          descricao: intencao.descricao,
          perfil: intencao.perfil ?? undefined,
          formaPagamento: intencao.forma_pagamento ?? undefined,
        }),
        meta: { source: "shortcut", confidence: 0.9 },
      };
    case "CONSULTAR_VISAO":
      return {
        op: "query",
        resource: "transaction",
        params: limparNulo({
          visionType: intencao.tipo_visao,
          categoriaNome: intencao.filtros.categoria_nome ?? undefined,
          merchant: intencao.filtros.descricao ?? undefined,
          descricao: intencao.filtros.descricao ?? undefined,
          contaNome: intencao.filtros.conta_nome ?? undefined,
          cartaoNome: intencao.filtros.cartao_nome ?? undefined,
          perfil: intencao.filtros.perfil ?? undefined,
          tipos: intencao.filtros.tipos ?? undefined,
          period: intencao.filtros.periodo
            ? {
                tipo: "personalizado" as const,
                de: intencao.filtros.periodo.de,
                ate: intencao.filtros.periodo.ate,
              }
            : undefined,
          offset: intencao.deslocamento ?? undefined,
        }),
        meta: { source: "shortcut", confidence: 0.9 },
      };
    case "CORRIGIR_MOVIMENTO": {
      const cancelar = intencao.campos_alterados.status === "cancelado";
      const campos = intencao.campos_alterados;
      return {
        op: cancelar ? "delete" : "update",
        resource: "transaction",
        params: limparNulo({
          valor: campos.valor ?? undefined,
          dataMovimento: campos.data_movimento ?? undefined,
          descricao: campos.descricao ?? undefined,
          perfil: campos.perfil ?? undefined,
          formaPagamento: campos.forma_pagamento ?? undefined,
          ignoradoEmRelatorio: campos.ignorado_em_relatorio ?? undefined,
          tags: campos.tags ?? undefined,
          observacoes: campos.observacoes ?? undefined,
        }),
        meta: { source: "shortcut", confidence: 0.9 },
      };
    }
    case "CRIAR_RECORRENCIA":
      return {
        op: "create",
        resource: "recurrence",
        params: limparNulo({
          descricao: intencao.descricao,
          valor: intencao.valor ?? undefined,
          diaDoMes: intencao.dia_do_mes ?? undefined,
        }),
        meta: { source: "shortcut", confidence: 0.9 },
      };
    case "DEFINIR_ORCAMENTO":
    case "CONSULTAR_ORCAMENTO":
      return {
        op: "query",
        resource: "transaction",
        params: limparNulo({
          visionType: "categoria" as const,
          categoriaNome: intencao.categoria_nome ?? undefined,
          aggregation: "sum" as const,
        }),
        meta: { source: "shortcut", confidence: 0.85 },
      };
    case "MENU":
      return {
        op: "query",
        resource: "transaction",
        params: {},
        meta: { source: "shortcut", confidence: 1 },
      };
    default:
      return {
        op: "query",
        resource: "transaction",
        params: {},
        meta: { source: "shortcut", confidence: 0.3 },
      };
  }
}
