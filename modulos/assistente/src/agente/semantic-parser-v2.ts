import type { ContextoInterpretacao } from "@lancai/ia";
import { inferir_perfil_da_mensagem } from "@lancai/ia";
import type { ConversationState, ParseResult, ParserInput, UserRequest } from "@lancai/tipos";
import { hojeISO } from "@lancai/tipos";
import {
  interpretar_consulta_rapida,
  interpretar_correcao_rapida,
  interpretar_enriquecimento_rapido,
  interpretar_lancamento_rapido,
  interpretar_pedido_detalhe_historico,
  interpretar_pedido_mais_historico,
  somar_dias_iso_local,
} from "@lancai/ia";
import type { IntencaoDetectada } from "@lancai/tipos";
import { extrairReferencias } from "./extrair-referencias";
import { mapearIntencaoParaUserRequest } from "./mapear-intencao";
import {
  interpretarOrcamentoRapido,
  interpretarRecorrenciaRapida,
} from "./atalhos-orcamento-recorrencia";

export interface LlmParser {
  parse(input: ParserInput): Promise<UserRequest>;
}

export interface SemanticParserDeps {
  llm?: LlmParser;
  contextoDe?: (
    userId: string,
    state: ConversationState,
  ) => ContextoInterpretacao | Promise<ContextoInterpretacao>;
}

const MENU = /^(menu|ajuda|\/menu|\/ajuda|help)$/i;
const CONFIRMACAO = /^(sim|não|nao|n[aã]o|\d+|todos)$/i;

function contextoMinimo(dataAtual: string): ContextoInterpretacao {
  return {
    dataAtual,
    contas: [],
    cartoes: [],
    categorias: [],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
  };
}

function ehMenu(mensagem: string): boolean {
  return MENU.test(mensagem.trim());
}

function preencherSlots(request: UserRequest, state: ConversationState, mensagem: string): { request: UserRequest; warnings: string[] } {
  const warnings: string[] = [];
  const params = { ...request.params };
  const prefs = state.userPreferencesRef ?? {};

  if (request.op === "create" && request.resource === "transaction") {
    if (!params.dataMovimento) {
      if (/\bontem\b/i.test(mensagem)) {
        /* data relativa fica para o resolvedor/contexto; default hoje */
      }
      params.dataMovimento = params.dataMovimento ?? hojeISO();
    }
    if (!params.perfil && prefs.defaultProfile) params.perfil = prefs.defaultProfile;
    if (!params.contaId && !params.cartaoId) {
      if (prefs.defaultAccountId) params.contaId = prefs.defaultAccountId;
      else if (prefs.defaultCardId) params.cartaoId = prefs.defaultCardId;
      else warnings.push("slot faltando: conta ou cartão");
    }
    if (params.valor == null) warnings.push("slot faltando: valor");
    if (request.references?.card && !params.formaPagamento) params.formaPagamento = "credito";
  }

  return { request: { ...request, params }, warnings };
}

function aplicarReferencias(request: UserRequest, mensagem: string): UserRequest {
  const references = extrairReferencias(mensagem);
  const perfil = inferir_perfil_da_mensagem(mensagem);
  const params = { ...request.params };
  if (perfil && (request.op === "update" || request.op === "classify")) {
    params.perfil = perfil;
  }
  if (perfil && request.op === "create") params.perfil = params.perfil ?? perfil;
  return {
    ...request,
    params,
    references: Object.keys(references).length > 0 ? references : request.references,
  };
}

function resultadoDeIntencao(
  intencao: IntencaoDetectada,
  shortcutName: string,
  mensagem: string,
  state: ConversationState,
): ParseResult {
  let request = mapearIntencaoParaUserRequest(intencao);
  request = aplicarReferencias(request, mensagem);
  const preenchido = preencherSlots(request, state, mensagem);
  return {
    request: preenchido.request,
    usedShortcut: true,
    shortcutName,
    warnings: preenchido.warnings,
  };
}

function ajusteDataDaEntidadeAtual(
  mensagem: string,
  dataAtual: string,
  temEntidadeAtual: boolean,
): IntencaoDetectada | null {
  if (!temEntidadeAtual) return null;
  const m = /^(?:foi|é|e)\s+(ontem|hoje|anteontem)\s*[.!]?\s*$/i.exec(mensagem.trim());
  if (!m?.[1]) return null;
  const rel = m[1].toLocaleLowerCase("pt-BR");
  const data =
    rel === "hoje" ? dataAtual : rel === "anteontem" ? somar_dias_iso_local(dataAtual, -2) : somar_dias_iso_local(dataAtual, -1);
  return {
    intencao: "CORRIGIR_MOVIMENTO",
    referencia: { descricao: null, data_movimento: null, codigo: null },
    campos_alterados: { data_movimento: data },
  };
}

function correcaoValorDaEntidadeAtual(
  mensagem: string,
  temEntidadeAtual: boolean,
): IntencaoDetectada | null {
  if (!temEntidadeAtual) return null;
  if (!/\b(corrige|corrigir|altera|alterar|muda|mudar)\b/i.test(mensagem)) return null;
  const comValor =
    /\bpara\s+(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,2})?)\s*(?:reais?)?\s*[.!]?\s*$/i.exec(
      mensagem.trim(),
    );
  if (!comValor?.[1]) return null;
  const bruto = comValor[1];
  const valor = bruto.includes(",") ? Number(bruto.replace(/\./g, "").replace(",", ".")) : Number(bruto);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const refs = extrairReferencias(mensagem);
  if (refs.target) return null;
  return {
    intencao: "CORRIGIR_MOVIMENTO",
    referencia: { descricao: null, data_movimento: null, codigo: null },
    campos_alterados: { valor },
  };
}

function classificarPerfilSolto(mensagem: string): IntencaoDetectada | null {
  const perfil = inferir_perfil_da_mensagem(mensagem);
  if (!perfil) return null;
  if (!/\b(foi|é|e|era|classifica)\b/i.test(mensagem) && !/\bpessoal|empresa|pj|pf\b/i.test(mensagem)) {
    return null;
  }
  if (/\b(gastei|recebi|paguei|quanto|corrige|altera)\b/i.test(mensagem)) return null;
  return {
    intencao: "CORRIGIR_MOVIMENTO",
    referencia: { descricao: null, data_movimento: null, codigo: null },
    campos_alterados: { perfil },
  };
}

/**
 * Parser v2: atalhos determinísticos na ordem do legado; LLM só como fallback injetável.
 */
export class SemanticParserV2 {
  constructor(private readonly deps: SemanticParserDeps = {}) {}

  async parse(input: ParserInput): Promise<ParseResult> {
    const mensagem = input.mensagem.trim();
    const dataAtual = hojeISO();
    const contexto =
      (await this.deps.contextoDe?.(input.userId, input.state)) ?? contextoMinimo(dataAtual);

    if (input.intencaoPrevia && typeof input.intencaoPrevia === "object") {
      const previa = input.intencaoPrevia as Record<string, unknown>;
      if (typeof previa.op === "string") {
        const request = aplicarReferencias(previa as unknown as UserRequest, mensagem);
        request.meta = { source: "multimodal", confidence: 0.85 };
        return { request, usedShortcut: false, shortcutName: "multimodal", warnings: [] };
      }
      if (typeof previa.intencao === "string") {
        return resultadoDeIntencao(previa as unknown as IntencaoDetectada, "multimodal", mensagem, input.state);
      }
    }

    if (ehMenu(mensagem)) {
      return {
        request: {
          op: "query",
          resource: "transaction",
          params: {},
          meta: { source: "shortcut", confidence: 1 },
        },
        usedShortcut: true,
        shortcutName: "menu",
        warnings: [],
      };
    }

    if (CONFIRMACAO.test(mensagem)) {
      return {
        request: {
          op: "query",
          resource: "transaction",
          params: { descricao: mensagem.toLocaleLowerCase("pt-BR") },
          meta: { source: "shortcut", confidence: 1 },
        },
        usedShortcut: true,
        shortcutName: "confirmacao",
        warnings: [],
      };
    }

    const detalhado = interpretar_pedido_detalhe_historico(mensagem, null);
    if (detalhado) return resultadoDeIntencao(detalhado, "detalhado", mensagem, input.state);

    const mais = interpretar_pedido_mais_historico(mensagem, null);
    if (mais) return resultadoDeIntencao(mais, "mais", mensagem, input.state);

    const orcamento = interpretarOrcamentoRapido(mensagem);
    if (orcamento) return resultadoDeIntencao(orcamento, "orcamento", mensagem, input.state);

    const recorrencia = interpretarRecorrenciaRapida(mensagem, contexto);
    if (recorrencia) return resultadoDeIntencao(recorrencia, "recorrencia", mensagem, input.state);

    const ajusteData = ajusteDataDaEntidadeAtual(
      mensagem,
      contexto.dataAtual || dataAtual,
      Boolean(input.state.currentEntity),
    );
    if (ajusteData) return resultadoDeIntencao(ajusteData, "correcao", mensagem, input.state);

    const enriquecimento = interpretar_enriquecimento_rapido(mensagem, dataAtual);
    if (enriquecimento) return resultadoDeIntencao(enriquecimento, "enriquecimento", mensagem, input.state);

    const perfilSolto = classificarPerfilSolto(mensagem);
    if (perfilSolto) return resultadoDeIntencao(perfilSolto, "enriquecimento", mensagem, input.state);

    const correcao = interpretar_correcao_rapida(mensagem, dataAtual);
    if (correcao) return resultadoDeIntencao(correcao, "correcao", mensagem, input.state);

    const correcaoAtual = correcaoValorDaEntidadeAtual(mensagem, Boolean(input.state.currentEntity));
    if (correcaoAtual) return resultadoDeIntencao(correcaoAtual, "correcao", mensagem, input.state);

    if (/\b(corrige|corrigir|altera|alterar|muda|mudar)\b/i.test(mensagem)) {
      const refs = extrairReferencias(mensagem);
      if (refs.target) {
        return resultadoDeIntencao(
          {
            intencao: "CORRIGIR_MOVIMENTO",
            referencia: { descricao: null, data_movimento: null, codigo: null },
            campos_alterados: {},
          },
          "correcao",
          mensagem,
          input.state,
        );
      }
    }

    const lancamento = interpretar_lancamento_rapido(mensagem, contexto);
    if (lancamento) return resultadoDeIntencao(lancamento, "lancamento", mensagem, input.state);

    const consulta = interpretar_consulta_rapida(mensagem, contexto);
    if (consulta) return resultadoDeIntencao(consulta, "consulta", mensagem, input.state);

    if (this.deps.llm) {
      const request = aplicarReferencias(await this.deps.llm.parse(input), mensagem);
      request.meta = { source: "llm", confidence: request.meta?.confidence ?? 0.6 };
      return { request, usedShortcut: false, shortcutName: undefined, warnings: [] };
    }

    const request = aplicarReferencias(
      {
        op: "query",
        resource: "transaction",
        params: {},
        meta: { source: "llm", confidence: 0 },
      },
      mensagem,
    );
    return {
      request,
      usedShortcut: false,
      warnings: ["nao_reconhecida"],
    };
  }
}
