import type { IntencaoCriarRecorrencia, IntencaoDetectada, IntencaoSolicitarInformacao } from "@lancai/tipos";
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
  // Evita confundir "dia 10" com o valor da assinatura.
  const texto = mensagem
    .trim()
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
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

function mesclar_criar_recorrencia(
  atual: Partial<IntencaoCriarRecorrencia>,
  pendentes: Record<string, unknown>,
  mensagem: string,
): IntencaoCriarRecorrencia {
  const valorMensagem = extrair_valor_mensagem(mensagem);
  const valor =
    atual.valor ??
    (typeof pendentes.valor === "number" ? pendentes.valor : null) ??
    valorMensagem;

  const diaBruto =
    atual.dia_do_mes ??
    (typeof pendentes.dia_do_mes === "number" ? pendentes.dia_do_mes : null);
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
    dia: "Em qual dia do mês?",
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
    const completa = mesclar_criar_recorrencia(
      dados_de_parcial(intencao.dados_parciais) as Partial<IntencaoCriarRecorrencia>,
      pendentes,
      mensagem,
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
      pergunta: intencao.pergunta
        ? personalizar_pergunta(intencao.pergunta, nome)
        : montar_pergunta(faltantes, nome),
    };
  }

  if (intencao.intencao !== "CRIAR_RECORRENCIA") return intencao;

  const completa = mesclar_criar_recorrencia(intencao, pendentes, mensagem);
  const faltantes = faltantes_recorrencia(completa);
  if (faltantes.length > 0) return solicitar(completa, faltantes, nome);

  return {
    ...completa,
    valor: completa.valor!,
    dia_do_mes: completa.dia_do_mes!,
  };
}
