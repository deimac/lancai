import {
  enxugar_descricao_lancamento,
  preferir_termo_referencia,
  type MensagemHistorico,
} from "@lancai/ia";
import type { IntencaoCorrigirMovimento, IntencaoDetectada } from "@lancai/tipos";

const PADRAO_CONTA_CARTAO =
  /Deseja realmente excluir (?:a|o) (conta|cartão) "([^"]+)"\?/;

const PADRAO_LANCAMENTO =
  /Deseja realmente excluir o lançamento "([^"]+)"(?:\s+#([a-f0-9]{6,12}))?(?: de (\d{2})\/(\d{2})\/(\d{4}))?(?:\s*\([^)]*\))?\?/;

/** Formato antigo (antes da desambiguação): "excluir os N lançamentos…". */
const PADRAO_LANCAMENTOS =
  /Deseja realmente excluir os (\d+) lançamentos de "([^"]+)"(?: de (\d{2})\/(\d{2})\/(\d{4}))?(?:\s*\([^)]*\))?\?/;

/** Cabeçalho comum das listas numeradas. */
const PADRAO_LISTA_NUMERADA =
  /Encontrei (\d+) lançamentos(?: semelhantes a "([^"]+)")?:/;

const AFIRMATIVAS = /^(sim|confirmo|confirma|pode excluir|pode apagar|ok|quero|yes)\.?$/i;
const AFIRMATIVAS_TODOS = /^(todos|todas|ambos|ambas|os dois|as duas)\.?$/i;
const NUMERO_ESCOLHA = /^(?:o\s+|n[uú]mero\s+)?(\d+)\.?$/i;
const NEGATIVAS = /^(não|nao|cancela|cancelar|não quero|nao quero|no)\.?$/i;

export type PendenciaExclusao =
  | { tipo: "conta" | "cartão"; nome: string }
  | {
      tipo: "lançamento";
      descricao: string;
      dataMovimento: string | null;
      codigo: string | null;
    }
  | {
      tipo: "lançamentos_excluir";
      descricao: string;
      quantidade: number;
    }
  | {
      tipo: "lançamentos_corrigir";
      descricao: string;
      quantidade: number;
    };

function data_br_para_iso(dia: string, mes: string, ano: string): string {
  return `${ano}-${mes}-${dia}`;
}

function termo_busca_da_mensagem_usuario(mensagem: string): string | null {
  // "corrige a descrição do X para Y" → busca por X (não por Y nem pela palavra descrição).
  const alvoCorrecao =
    /\bdescri[cç][aã]o\s+(?:do|da|de)\s+(.+?)\s+para\b/i.exec(mensagem) ??
    /\b(?:corrige|corrigir|altera|alterar|muda|mudar|troca|trocar)\b[\s\S]*?\b(?:do|da|de)\s+(.+?)\s+para\b/i.exec(
      mensagem,
    );
  if (alvoCorrecao?.[1]) {
    const termo = enxugar_descricao_lancamento(alvoCorrecao[1]);
    if (termo && termo.toLocaleLowerCase("pt-BR") !== "lançamento") return termo;
  }

  const termo = preferir_termo_referencia(mensagem);
  if (termo && termo !== "não especificado") return termo;
  return null;
}

function termo_busca_do_historico(
  historicoRecente: MensagemHistorico[],
  indiceSistema: number,
  legadoEntreAspas?: string,
): string {
  if (legadoEntreAspas?.trim()) return legadoEntreAspas.trim();

  for (let j = indiceSistema - 1; j >= 0; j -= 1) {
    const anterior = historicoRecente[j];
    if (anterior?.papel !== "usuario") continue;
    const termo = termo_busca_da_mensagem_usuario(anterior.conteudo);
    if (termo) return termo;
  }
  return "lançamento";
}

function mensagem_usuario_antes_da_lista(
  historicoRecente: MensagemHistorico[],
): string | null {
  for (let i = historicoRecente.length - 1; i >= 0; i -= 1) {
    if (historicoRecente[i]?.papel !== "sistema") continue;
    if (!PADRAO_LISTA_NUMERADA.test(historicoRecente[i]!.conteudo)) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (historicoRecente[j]?.papel === "usuario") {
        return historicoRecente[j]!.conteudo;
      }
    }
  }
  return null;
}

/** Extrai "para &lt;nova descrição&gt;" da mensagem de correção do usuário. */
export function extrair_nova_descricao_correcao(mensagem: string): string | null {
  const match =
    /\b(?:corrige|corrigir|altera|alterar|muda|mudar|troca|trocar)\b[\s\S]*?\bpara\b\s+(.+)$/i.exec(
      mensagem.trim(),
    );
  if (!match?.[1]) return null;
  let bruto = match[1].trim().replace(/^["']|["']$/g, "");
  // Corta lixo residual de data/código no fim.
  bruto = bruto.replace(/\s+de\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/i, "").trim();
  if (bruto.length < 2) return null;
  const enxuta = enxugar_descricao_lancamento(bruto);
  if (!enxuta || enxuta.toLocaleLowerCase("pt-BR") === "lançamento") return null;
  return enxuta;
}

function campos_correcao_pendente(
  ultimaIntencaoIa: IntencaoDetectada | null | undefined,
  historicoRecente: MensagemHistorico[],
): IntencaoCorrigirMovimento["campos_alterados"] | null {
  if (
    ultimaIntencaoIa?.intencao === "CORRIGIR_MOVIMENTO" &&
    ultimaIntencaoIa.campos_alterados.status !== "cancelado"
  ) {
    const campos = { ...ultimaIntencaoIa.campos_alterados };
    // Garante que não há status cancelado residual.
    delete (campos as { status?: unknown }).status;
    delete (campos as { confirmado?: unknown }).confirmado;
    if (Object.keys(campos).some((k) => campos[k as keyof typeof campos] != null)) {
      return campos;
    }
  }

  const mensagemUsuario = mensagem_usuario_antes_da_lista(historicoRecente);
  if (!mensagemUsuario) return null;
  const novaDescricao = extrair_nova_descricao_correcao(mensagemUsuario);
  if (!novaDescricao) return null;
  return { descricao: novaDescricao };
}

/** Extrai a pendência de exclusão/correção da última mensagem do sistema no histórico. */
export function extrair_pendencia_exclusao(
  historicoRecente: MensagemHistorico[],
): PendenciaExclusao | null {
  for (let i = historicoRecente.length - 1; i >= 0; i -= 1) {
    const mensagem = historicoRecente[i];
    if (mensagem?.papel !== "sistema") continue;

    const lista = PADRAO_LISTA_NUMERADA.exec(mensagem.conteudo);
    if (lista) {
      const descricao = termo_busca_do_historico(historicoRecente, i, lista[2]);
      const quantidade = Number(lista[1]);
      if (/Qual deseja corrigir\b/i.test(mensagem.conteudo)) {
        return { tipo: "lançamentos_corrigir", descricao, quantidade };
      }
      if (/Qual deseja excluir\b/i.test(mensagem.conteudo)) {
        return { tipo: "lançamentos_excluir", descricao, quantidade };
      }
      // Lista ambígua sem rodapé claro — não assume exclusão.
      return null;
    }

    const varios = PADRAO_LANCAMENTOS.exec(mensagem.conteudo);
    if (varios) {
      return {
        tipo: "lançamento",
        descricao: varios[2]!,
        dataMovimento:
          varios[3] && varios[4] && varios[5]
            ? data_br_para_iso(varios[3], varios[4], varios[5])
            : null,
        codigo: null,
      };
    }

    const lancamento = PADRAO_LANCAMENTO.exec(mensagem.conteudo);
    if (lancamento) {
      return {
        tipo: "lançamento",
        descricao: lancamento[1]!,
        codigo: lancamento[2] ?? null,
        dataMovimento:
          lancamento[3] && lancamento[4] && lancamento[5]
            ? data_br_para_iso(lancamento[3], lancamento[4], lancamento[5])
            : null,
      };
    }

    const contaCartao = PADRAO_CONTA_CARTAO.exec(mensagem.conteudo);
    if (contaCartao) {
      return { tipo: contaCartao[1] as "conta" | "cartão", nome: contaCartao[2]! };
    }

    return null;
  }
  return null;
}

/**
 * Atalho determinístico: confirmação de exclusão OU escolha numérica na
 * desambiguação. Correção (alterar) nunca vira exclusão.
 */
export function interpretar_resposta_confirmacao_exclusao(
  mensagem: string,
  historicoRecente: MensagemHistorico[],
  ultimaIntencaoIa?: IntencaoDetectada | null,
): IntencaoDetectada | null {
  const pendencia = extrair_pendencia_exclusao(historicoRecente);
  if (!pendencia) return null;

  const texto = mensagem.trim();

  if (pendencia.tipo === "lançamentos_corrigir") {
    if (NEGATIVAS.test(texto)) {
      return { intencao: "MENSAGEM_INFO", motivo: "Correção cancelada." };
    }

    const escolha = NUMERO_ESCOLHA.exec(texto);
    if (!escolha) return null;

    const indice = Number(escolha[1]);
    if (indice < 1 || indice > pendencia.quantidade) {
      return {
        intencao: "MENSAGEM_INFO",
        motivo: `Número inválido. Escolha entre 1 e ${pendencia.quantidade} para corrigir (alterar) o lançamento.`,
      };
    }

    const campos = campos_correcao_pendente(ultimaIntencaoIa, historicoRecente);
    if (!campos) {
      return {
        intencao: "MENSAGEM_INFO",
        motivo: `Ok, lançamento ${indice}. O que deseja alterar? (ex.: "descrição Tênis Adidas" ou "valor 300"). Isso não apaga o lançamento.`,
      };
    }

    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {
        descricao: pendencia.descricao,
        data_movimento: null,
        codigo: null,
        indice,
      },
      campos_alterados: campos,
    };
  }

  if (pendencia.tipo === "lançamentos_excluir") {
    if (AFIRMATIVAS_TODOS.test(texto)) {
      return {
        intencao: "CORRIGIR_MOVIMENTO",
        referencia: {
          descricao: pendencia.descricao,
          data_movimento: null,
          codigo: null,
          indice: null,
        },
        campos_alterados: { status: "cancelado", confirmado: true },
      };
    }

    const escolha = NUMERO_ESCOLHA.exec(texto);
    if (escolha) {
      const indice = Number(escolha[1]);
      if (indice < 1 || indice > pendencia.quantidade) {
        return {
          intencao: "MENSAGEM_INFO",
          motivo: `Número inválido. Escolha entre 1 e ${pendencia.quantidade} para excluir, ou diga "todos".`,
        };
      }
      return {
        intencao: "CORRIGIR_MOVIMENTO",
        referencia: {
          descricao: pendencia.descricao,
          data_movimento: null,
          codigo: null,
          indice,
        },
        campos_alterados: { status: "cancelado", confirmado: true },
      };
    }

    if (NEGATIVAS.test(texto)) {
      return { intencao: "MENSAGEM_INFO", motivo: "Exclusão cancelada." };
    }
    return null;
  }

  if (AFIRMATIVAS.test(texto)) {
    if (pendencia.tipo === "lançamento") {
      return {
        intencao: "CORRIGIR_MOVIMENTO",
        referencia: {
          descricao: pendencia.descricao,
          data_movimento: pendencia.dataMovimento,
          codigo: pendencia.codigo,
        },
        campos_alterados: { status: "cancelado", confirmado: true },
      };
    }
    if (pendencia.tipo === "conta") {
      return {
        intencao: "CORRIGIR_CONTA",
        conta_nome: pendencia.nome,
        campos_alterados: { ativo: false, confirmado: true },
      };
    }
    return {
      intencao: "CORRIGIR_CARTAO",
      cartao_nome: pendencia.nome,
      campos_alterados: { ativo: false, confirmado: true },
    };
  }

  if (NEGATIVAS.test(texto)) {
    return { intencao: "MENSAGEM_INFO", motivo: "Exclusão cancelada." };
  }

  return null;
}
