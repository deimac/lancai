import type { IntencaoCriarRecorrencia, IntencaoDetectada, IntencaoSolicitarInformacao } from "@lancai/tipos";
import { parsear_data_br } from "./datas-relativas";
import { personalizar_pergunta, perguntar_campo } from "./personalizar-pergunta";
import type { ContextoInterpretacao, IntencaoPendenteSlot } from "./prompt";

type CampoFaltante = "valor" | "dia" | "descricao" | "conta";

function dados_de_parcial(parciais: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!parciais || typeof parciais !== "object") return {};
  return { ...parciais };
}

function parciais_da_pendente(pendente: IntencaoPendenteSlot | null | undefined): Record<string, unknown> {
  if (!pendente || pendente.intencao_pendente !== "CRIAR_RECORRENCIA") return {};
  return dados_de_parcial(pendente.dados_parciais);
}

function extrair_valor_mensagem(mensagem: string): number | null {
  // Evita confundir "dia 10" / "hoje" com o valor da assinatura.
  const texto = mensagem
    .trim()
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b(?:hoje|hj)\b/gi, " ")
    .replace(/\b(?:todo\s+m[eê]s|mensal(?:mente)?|recorrente)\b/gi, " ");
  if (!texto.trim()) return null;
  const m =
    /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(texto) ??
    /(?:r\$\s*)?(\d+[.,]?\d*)/.exec(texto);
  if (!m?.[1]) return null;
  const bruto = m[1];
  const n = bruto.includes(",")
    ? Number(bruto.replace(/\./g, "").replace(",", "."))
    : Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dia_de_data_iso(dataAtual?: string | null): number | null {
  if (!dataAtual || !/^\d{4}-\d{2}-\d{2}/.test(dataAtual)) return null;
  const dia = Number(dataAtual.slice(8, 10));
  return dia >= 1 && dia <= 31 ? dia : null;
}

function numero_parcial(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim()) {
    const n = Number(valor.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const MESES_PT: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/**
 * Resolve o dia do mês a partir da mensagem: "hoje", "esse mês", "agosto",
 * "dia 10"/"dia 09", ou "10" (número isolado só com valor já conhecido).
 */
export function extrair_dia_do_mes_mensagem(
  mensagem: string,
  dataAtual?: string | null,
  opcoes: { permitirNumeroIsolado?: boolean } = {},
): number | null {
  const texto = mensagem
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!texto) return null;

  if (
    /\b(hoje|hj)\b/.test(texto) ||
    /\b(esse|este|neste)\s+mes\b/.test(texto) ||
    /\b(a\s+partir\s+de\s+agora|ainda\s+esse\s+mes)\b/.test(texto)
  ) {
    return dia_de_data_iso(dataAtual);
  }

  // Nome do mês sozinho (ex.: "agosto") → dia de hoje no calendário atual.
  const soMes = texto.replace(/[.!?,]/g, "").trim();
  if (MESES_PT[soMes] != null) {
    return dia_de_data_iso(dataAtual);
  }

  const comRotulo = /\bdia\s+(\d{1,2})\b/.exec(texto);
  if (comRotulo) {
    const n = Number(comRotulo[1]);
    return n >= 1 && n <= 31 ? n : null;
  }

  const dataCompleta = parsear_data_br(mensagem, dataAtual ?? "");
  if (dataCompleta) {
    const n = Number(dataCompleta.slice(8, 10));
    return n >= 1 && n <= 31 ? n : null;
  }

  if (opcoes.permitirNumeroIsolado && /^\d{1,2}\s*[.!?]?\s*$/.test(texto)) {
    const n = Number(texto.replace(/\D/g, ""));
    return n >= 1 && n <= 31 ? n : null;
  }

  return null;
}

function mesclar_criar_recorrencia(
  atual: Partial<IntencaoCriarRecorrencia>,
  pendentes: Record<string, unknown>,
  mensagem: string,
  dataAtual?: string | null,
): IntencaoCriarRecorrencia {
  const valorPendente = numero_parcial(pendentes.valor);
  const valorAtual = numero_parcial(atual.valor);
  const valorJaConhecido = valorAtual != null || valorPendente != null;
  const valorMensagem = extrair_valor_mensagem(mensagem);
  const valor = valorAtual ?? valorPendente ?? valorMensagem;

  const diaMensagem = extrair_dia_do_mes_mensagem(mensagem, dataAtual, {
    permitirNumeroIsolado: valorJaConhecido,
  });
  const diaBruto =
    numero_parcial(atual.dia_do_mes) ??
    diaMensagem ??
    numero_parcial(pendentes.dia_do_mes);
  const dia =
    typeof diaBruto === "number" && diaBruto >= 1 && diaBruto <= 31 ? diaBruto : null;

  const descAtual = atual.descricao?.trim() ?? "";
  const descPendente = typeof pendentes.descricao === "string" ? pendentes.descricao.trim() : "";
  // Placeholder do atalho de slot — não sobrescreve a descrição já capturada.
  const descAtualUtil = descAtual && descAtual !== "Recorrência" ? descAtual : "";
  const descricaoBruta = descAtualUtil || descPendente;

  return {
    intencao: "CRIAR_RECORRENCIA",
    descricao: descricaoBruta || "Recorrência",
    valor: valor ?? null,
    dia_do_mes: dia,
    tipo_movimento:
      atual.tipo_movimento ??
      (pendentes.tipo_movimento === "receita" || pendentes.tipo_movimento === "despesa"
        ? pendentes.tipo_movimento
        : "despesa"),
    categoria_nome:
      atual.categoria_nome ??
      (typeof pendentes.categoria_nome === "string" ? pendentes.categoria_nome : null),
    conta_nome:
      atual.conta_nome ?? (typeof pendentes.conta_nome === "string" ? pendentes.conta_nome : null),
    cartao_nome:
      atual.cartao_nome ??
      (typeof pendentes.cartao_nome === "string" ? pendentes.cartao_nome : null),
  };
}

function eh_lixo_origem(nome: string): boolean {
  const lower = nome.trim().toLocaleLowerCase("pt-BR");
  if (!lower) return true;
  if (/^valor(\s|$|de\b)/i.test(lower)) return true;
  if (/^r\$/.test(lower)) return true;
  if (/^\d+[.,]?\d*$/.test(lower)) return true;
  return false;
}

function origem_existe_no_cadastro(
  nome: string,
  contexto: ContextoInterpretacao,
): boolean {
  const lower = nome.toLocaleLowerCase("pt-BR");
  const casa = (cadastro: string) => {
    const a = cadastro.toLocaleLowerCase("pt-BR");
    return a === lower || a.includes(lower) || lower.includes(a);
  };
  return (
    contexto.cartoes.some((c) => casa(c.nome)) || contexto.contas.some((c) => casa(c.nome))
  );
}

/** Descarta origem inventada ("Valor de 28") ou inexistente no cadastro. */
function sanitizar_origem(
  completa: IntencaoCriarRecorrencia,
  contexto: ContextoInterpretacao,
): IntencaoCriarRecorrencia {
  let conta_nome = completa.conta_nome?.trim() || null;
  let cartao_nome = completa.cartao_nome?.trim() || null;

  if (conta_nome && (eh_lixo_origem(conta_nome) || !origem_existe_no_cadastro(conta_nome, contexto))) {
    conta_nome = null;
  }
  if (
    cartao_nome &&
    (eh_lixo_origem(cartao_nome) || !origem_existe_no_cadastro(cartao_nome, contexto))
  ) {
    cartao_nome = null;
  }

  return { ...completa, conta_nome, cartao_nome };
}

function faltantes_recorrencia(completa: IntencaoCriarRecorrencia): CampoFaltante[] {
  const faltantes: CampoFaltante[] = [];
  if (completa.valor == null) faltantes.push("valor");
  if (completa.dia_do_mes == null) faltantes.push("dia");
  if (!completa.descricao.trim() || completa.descricao === "Recorrência") {
    faltantes.push("descricao");
  }
  if (!completa.conta_nome && !completa.cartao_nome) faltantes.push("conta");
  return faltantes;
}

function dados_parciais_de(completa: IntencaoCriarRecorrencia): Record<string, unknown> {
  const dados: Record<string, unknown> = {
    descricao: completa.descricao,
    tipo_movimento: completa.tipo_movimento ?? "despesa",
  };
  if (completa.valor != null) dados.valor = completa.valor;
  if (completa.dia_do_mes != null) dados.dia_do_mes = completa.dia_do_mes;
  if (completa.categoria_nome) dados.categoria_nome = completa.categoria_nome;
  if (completa.conta_nome) dados.conta_nome = completa.conta_nome;
  if (completa.cartao_nome) dados.cartao_nome = completa.cartao_nome;
  return dados;
}

function montar_pergunta(faltantes: CampoFaltante[], nomeUsuario?: string | null): string {
  const perguntas: Record<CampoFaltante, string> = {
    valor: "Qual é o valor?",
    dia: "Em qual dia do mês (1 a 31)? Pode ser “hoje” ou “dia 10”.",
    descricao: "Qual é a descrição?",
    conta: "Em qual conta ou cartão?",
  };
  const primeiro = faltantes[0];
  if (!primeiro) return perguntar_campo("Pode me dar mais detalhes?", nomeUsuario);
  return perguntar_campo(perguntas[primeiro], nomeUsuario);
}

function solicitar(
  completa: IntencaoCriarRecorrencia,
  faltantes: CampoFaltante[],
  nomeUsuario?: string | null,
): IntencaoSolicitarInformacao {
  return {
    intencao: "SOLICITAR_INFORMACAO",
    intencao_pendente: "CRIAR_RECORRENCIA",
    pergunta: montar_pergunta(faltantes, nomeUsuario),
    dados_parciais: dados_parciais_de(completa),
  };
}

/**
 * Completa CRIAR_RECORRENCIA com dados_parciais pendentes e, se faltar
 * valor/dia/conta, converte para SOLICITAR_INFORMACAO (slot-filling).
 */
export function normalizar_intencao_recorrencia(
  intencao: IntencaoDetectada,
  contexto: ContextoInterpretacao,
  mensagem = "",
): IntencaoDetectada {
  const pendentes = parciais_da_pendente(contexto.intencaoPendente);
  const nome = contexto.nomeUsuario;

  if (intencao.intencao === "SOLICITAR_INFORMACAO") {
    if (intencao.intencao_pendente !== "CRIAR_RECORRENCIA") {
      return {
        ...intencao,
        pergunta: personalizar_pergunta(intencao.pergunta, nome),
      };
    }
    const completa = sanitizar_origem(
      mesclar_criar_recorrencia(
        dados_de_parcial(intencao.dados_parciais) as Partial<IntencaoCriarRecorrencia>,
        pendentes,
        mensagem,
        contexto.dataAtual,
      ),
      contexto,
    );
    const faltantes = faltantes_recorrencia(completa);
    if (faltantes.length === 0) {
      return {
        ...completa,
        valor: completa.valor!,
        dia_do_mes: completa.dia_do_mes!,
      };
    }
    return {
      ...solicitar(completa, faltantes, nome),
      // Sempre a pergunta do próximo faltante real (não ecoar pergunta velha de dia).
      pergunta: montar_pergunta(faltantes, nome),
    };
  }

  if (intencao.intencao !== "CRIAR_RECORRENCIA") return intencao;

  const completa = sanitizar_origem(
    mesclar_criar_recorrencia(intencao, pendentes, mensagem, contexto.dataAtual),
    contexto,
  );
  const faltantes = faltantes_recorrencia(completa);
  if (faltantes.length > 0) return solicitar(completa, faltantes, nome);

  return {
    ...completa,
    valor: completa.valor!,
    dia_do_mes: completa.dia_do_mes!,
  };
}
