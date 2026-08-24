import type {
  FormaPagamento,
  IntencaoDetectada,
  IntencaoRegistrarMovimento,
  IntencaoSolicitarInformacao,
  Perfil,
  TipoMovimento,
} from "@lancai/tipos";
import { inferir_forma_pagamento_da_mensagem } from "./inferir-forma-pagamento";
import {
  inferir_origem_da_mensagem,
  nome_corresponde_cadastro,
  resolver_nome_canonico,
} from "./inferir-origem-movimento";
import { inferir_perfil_padrao } from "./inferir-perfil-padrao";
import { enxugar_descricao_lancamento } from "./normalizar-descricao";
import { personalizar_pergunta, perguntar_campo } from "./personalizar-pergunta";
import type { ContextoInterpretacao, IntencaoPendenteSlot } from "./prompt";

/** Perfil explícito na mensagem (tem prioridade sobre perfil da conta/cartão). */
export function inferir_perfil_da_mensagem(mensagem: string): Perfil | null {
  const texto = mensagem.toLocaleLowerCase("pt-BR");
  const pf =
    /\b(?:para\s+)?uso\s+pessoal\b/.test(texto) ||
    /\bgastos?\s+(?:pessoais|pessoal)\b/.test(texto) ||
    /\bganho\s+pessoal\b/.test(texto) ||
    /\bpf\b/.test(texto) ||
    /\b(?:pessoalmente|pessoais|pessoal)\b/.test(texto);
  const pj =
    /\b(?:para\s+)?(?:a\s+)?empresa\b/.test(texto) ||
    /\buso\s+(?:da\s+)?empresa\b/.test(texto) ||
    /\bgasto\s+(?:da\s+)?empresa\b/.test(texto) ||
    /\bpj\b/.test(texto) ||
    /\bempresarial(?:mente)?\b/.test(texto);

  // Ambos: frases longas de uso pessoal vs "Mercado Pago empresa" — preferir o mais específico.
  if (pf && !pj) return "pf";
  if (pj && !pf) return "pj";
  if (pf && pj) {
    if (/\b(?:para\s+)?uso\s+pessoal\b|\bgastos?\s+(?:pessoais|pessoal)\b/.test(texto)) return "pf";
    if (/\b(?:para\s+)?(?:a\s+)?empresa\b|\bpj\b/.test(texto)) return "pj";
  }
  return null;
}

type CampoFaltante = "valor" | "conta" | "perfil";

function dados_de_parcial(parciais: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!parciais || typeof parciais !== "object") return {};
  return { ...parciais };
}

function parciais_da_pendente(pendente: IntencaoPendenteSlot | null | undefined): Record<string, unknown> {
  if (!pendente || pendente.intencao_pendente !== "REGISTRAR_MOVIMENTO") return {};
  return dados_de_parcial(pendente.dados_parciais);
}

/** Valor na mensagem de slot — ignora "dia N" para não confundir com quantia. */
function extrair_valor_mensagem(mensagem: string): number | null {
  const texto = mensagem
    .trim()
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
  if (!texto.trim()) return null;

  const comCentavos =
    /R\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(texto) ??
    /\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/.exec(texto) ??
    /\b(\d+,\d{2})\b/.exec(texto);
  if (comCentavos?.[1]) {
    const numero = Number(comCentavos[1].replace(/\./g, "").replace(",", "."));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  const comReais = /\b(\d{1,3}(?:\.\d{3})*|\d{1,6})\s*reais?\b/i.exec(texto);
  if (comReais?.[1]) {
    const numero = Number(comReais[1].replace(/\./g, ""));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  // Resposta curta só com número ("50", "120").
  const soNumero = /^\s*(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*$/i.exec(texto);
  if (soNumero?.[1]) {
    const bruto = soNumero[1];
    const numero = bruto.includes(",")
      ? Number(bruto.replace(/\./g, "").replace(",", "."))
      : Number(bruto.replace(",", "."));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  const aposVerbo =
    /\b(?:gastei|paguei|comprei|recebi|ganhei|debitei)\s+(?:r\$\s*)?(\d{1,6})(?:\s|$|,)/i.exec(
      texto,
    );
  if (aposVerbo?.[1]) {
    const numero = Number(aposVerbo[1]);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  return null;
}

function tipo_de_parcial(parciais: Record<string, unknown>): TipoMovimento {
  return parciais.tipo_movimento === "receita" ? "receita" : "despesa";
}

function descricao_util(atual: string | undefined, pendente: string): string {
  const descAtual = atual?.trim() ?? "";
  const enxuta = descAtual ? enxugar_descricao_lancamento(descAtual) : "";
  // Placeholder ou eco da resposta de slot ("50", "pessoal") não substitui o que já tínhamos.
  if (
    !enxuta ||
    enxuta === "Lançamento" ||
    /^\d+([.,]\d+)?$/.test(enxuta) ||
    /^(pessoal|empresa|pf|pj)$/i.test(enxuta)
  ) {
    return pendente || enxuta || "Lançamento";
  }
  return enxuta;
}

function mesclar_registrar_movimento(
  atual: Partial<IntencaoRegistrarMovimento>,
  pendentes: Record<string, unknown>,
  mensagem: string,
  contexto: ContextoInterpretacao,
): IntencaoRegistrarMovimento {
  const valorMensagem = extrair_valor_mensagem(mensagem);
  const origemMensagem = inferir_origem_da_mensagem(mensagem, contexto);
  const perfilMensagem = inferir_perfil_da_mensagem(mensagem);

  const descPendente = typeof pendentes.descricao === "string" ? pendentes.descricao.trim() : "";

  const cartao =
    atual.cartao_nome ??
    origemMensagem.cartao_nome ??
    (typeof pendentes.cartao_nome === "string" ? pendentes.cartao_nome : null);
  const conta =
    atual.conta_nome ??
    origemMensagem.conta_nome ??
    (typeof pendentes.conta_nome === "string" ? pendentes.conta_nome : null);

  return {
    intencao: "REGISTRAR_MOVIMENTO",
    tipo_movimento: atual.tipo_movimento ?? tipo_de_parcial(pendentes),
    descricao: descricao_util(atual.descricao, descPendente),
    valor:
      atual.valor ??
      (typeof pendentes.valor === "number" ? pendentes.valor : null) ??
      valorMensagem,
    data_movimento:
      atual.data_movimento ??
      (typeof pendentes.data_movimento === "string" ? pendentes.data_movimento : null),
    perfil:
      perfilMensagem ??
      atual.perfil ??
      (pendentes.perfil === "pf" || pendentes.perfil === "pj" ? pendentes.perfil : null),
    conta_nome: cartao ? null : conta,
    cartao_nome: cartao,
    categoria_nome:
      atual.categoria_nome ??
      (typeof pendentes.categoria_nome === "string" ? pendentes.categoria_nome : null),
    pessoa_nome:
      atual.pessoa_nome ??
      (typeof pendentes.pessoa_nome === "string" ? pendentes.pessoa_nome : null),
    parcelas:
      atual.parcelas ??
      (typeof pendentes.parcelas === "number" ? pendentes.parcelas : null),
    forma_pagamento:
      atual.forma_pagamento ??
      (typeof pendentes.forma_pagamento === "string"
        ? (pendentes.forma_pagamento as FormaPagamento)
        : null),
    confirmado: atual.confirmado ?? null,
  };
}

function montar_pergunta_faltantes(
  faltantes: CampoFaltante[],
  nomeUsuario?: string | null,
): string {
  const perguntas: Record<CampoFaltante, string> = {
    valor: "Qual é o valor?",
    conta: "Em qual conta ou cartão?",
    perfil: "Foi pessoal ou da empresa?",
  };
  const primeiro = faltantes[0];
  if (!primeiro) return perguntar_campo("Pode me dar mais detalhes?", nomeUsuario);
  return perguntar_campo(perguntas[primeiro], nomeUsuario);
}

function inferir_conta_ou_cartao(contexto: ContextoInterpretacao): {
  conta_nome?: string;
  cartao_nome?: string;
} {
  const habitoCartao = contexto.habitos.find((habito) => habito.chave === "cartao_principal");
  if (habitoCartao && contexto.cartoes.some((cartao) => cartao.nome === habitoCartao.valor)) {
    return { cartao_nome: habitoCartao.valor };
  }

  const habitoConta = contexto.habitos.find((habito) => habito.chave === "conta_principal");
  if (habitoConta && contexto.contas.some((conta) => conta.nome === habitoConta.valor)) {
    return { conta_nome: habitoConta.valor };
  }

  if (contexto.contas.length === 1 && contexto.cartoes.length === 0) {
    return { conta_nome: contexto.contas[0]!.nome };
  }

  if (contexto.cartoes.length === 1 && contexto.contas.length === 0) {
    return { cartao_nome: contexto.cartoes[0]!.nome };
  }

  return {};
}

function dados_parciais_de(intencao: IntencaoRegistrarMovimento): Record<string, unknown> {
  const dados: Record<string, unknown> = {
    tipo_movimento: intencao.tipo_movimento,
    descricao: intencao.descricao,
  };
  if (intencao.valor != null) dados.valor = intencao.valor;
  if (intencao.data_movimento) dados.data_movimento = intencao.data_movimento;
  if (intencao.perfil) dados.perfil = intencao.perfil;
  if (intencao.conta_nome) dados.conta_nome = intencao.conta_nome;
  if (intencao.cartao_nome) dados.cartao_nome = intencao.cartao_nome;
  if (intencao.categoria_nome) dados.categoria_nome = intencao.categoria_nome;
  if (intencao.pessoa_nome) dados.pessoa_nome = intencao.pessoa_nome;
  if (intencao.parcelas != null) dados.parcelas = intencao.parcelas;
  if (intencao.forma_pagamento) dados.forma_pagamento = intencao.forma_pagamento;
  return dados;
}

function resolver_forma_pagamento(
  intencao: IntencaoRegistrarMovimento,
  mensagem: string,
): FormaPagamento | null | undefined {
  if (intencao.forma_pagamento) return intencao.forma_pagamento;

  const inferida = inferir_forma_pagamento_da_mensagem(mensagem);
  if (inferida) return inferida;

  if (intencao.cartao_nome) return "credito";
  if (intencao.conta_nome) return "pix";

  return null;
}

function inferir_perfil_da_origem(
  contexto: ContextoInterpretacao,
  contaNome: string | null | undefined,
  cartaoNome: string | null | undefined,
): Perfil | null {
  if (cartaoNome) {
    const cartao = contexto.cartoes.find((item) => nome_corresponde_cadastro(item.nome, cartaoNome));
    if (cartao?.perfil === "pf" || cartao?.perfil === "pj") return cartao.perfil;
  }
  if (contaNome) {
    const conta = contexto.contas.find((item) => nome_corresponde_cadastro(item.nome, contaNome));
    if (conta?.perfil === "pf" || conta?.perfil === "pj") return conta.perfil;
  }
  return null;
}

function somar_dias_iso(dataISO: string, dias: number): string {
  const data = new Date(`${dataISO}T12:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

/** Extrai data explícita DD/MM[/AAAA] ou "dia N" (mês/ano de dataAtual). */
function extrair_data_explicita(mensagem: string, dataAtual: string): string | null {
  const comAno = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(mensagem);
  if (comAno) {
    const dia = Number(comAno[1]);
    const mes = Number(comAno[2]);
    const ano = Number(comAno[3]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
  }

  const semAno = /\b(\d{1,2})\/(\d{1,2})\b/.exec(mensagem);
  if (semAno) {
    const dia = Number(semAno[1]);
    const mes = Number(semAno[2]);
    const ano = Number(dataAtual.slice(0, 4));
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && Number.isFinite(ano)) {
      return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
  }

  const soDia = /\bdia\s+(\d{1,2})\b/i.exec(mensagem);
  if (soDia) {
    const dia = Number(soDia[1]);
    const ano = Number(dataAtual.slice(0, 4));
    const mes = Number(dataAtual.slice(5, 7));
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && Number.isFinite(ano)) {
      return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
  }

  return null;
}

/** Corrige "ontem"/"hoje"/data explícita/"dia N" se a IA errou ou omitiu a data. */
function resolver_data_movimento(
  dataAtual: string,
  dataDaIa: string | null | undefined,
  mensagem: string,
): string {
  const texto = mensagem.toLocaleLowerCase("pt-BR");
  if (/\banteontem\b/.test(texto)) return somar_dias_iso(dataAtual, -2);
  if (/\bontem\b/.test(texto)) return somar_dias_iso(dataAtual, -1);
  if (/\bhoje\b/.test(texto)) return dataAtual;

  const explicita = extrair_data_explicita(mensagem, dataAtual);
  if (explicita) return explicita;

  return dataDaIa ?? dataAtual;
}

function resolver_origem(
  intencao: IntencaoRegistrarMovimento,
  contexto: ContextoInterpretacao,
  mensagem: string,
): { conta_nome: string | null; cartao_nome: string | null } {
  const daMensagem = inferir_origem_da_mensagem(mensagem, contexto);
  const doHabito = inferir_conta_ou_cartao(contexto);

  const cartaoCitado = intencao.cartao_nome ?? daMensagem.cartao_nome ?? null;
  const contaCitada = intencao.conta_nome ?? daMensagem.conta_nome ?? null;

  if (cartaoCitado) {
    return {
      cartao_nome: resolver_nome_canonico(cartaoCitado, contexto.cartoes),
      conta_nome: null,
    };
  }

  if (contaCitada) {
    return {
      conta_nome: resolver_nome_canonico(contaCitada, contexto.contas),
      cartao_nome: null,
    };
  }

  return {
    cartao_nome: doHabito.cartao_nome ?? null,
    conta_nome: doHabito.conta_nome ?? null,
  };
}

function completar_e_validar(
  mesclada: IntencaoRegistrarMovimento,
  contexto: ContextoInterpretacao,
  mensagem: string,
): IntencaoDetectada {
  const perfilPadrao = inferir_perfil_padrao(contexto.contas, contexto.cartoes);
  const origem = resolver_origem(mesclada, contexto, mensagem);

  const completa: IntencaoRegistrarMovimento = {
    ...mesclada,
    descricao: enxugar_descricao_lancamento(mesclada.descricao),
    data_movimento: resolver_data_movimento(
      contexto.dataAtual,
      mesclada.data_movimento,
      mensagem,
    ),
    conta_nome: origem.conta_nome,
    cartao_nome: origem.cartao_nome,
  };

  const perfilMensagem = inferir_perfil_da_mensagem(mensagem);
  const perfilOrigem = inferir_perfil_da_origem(contexto, completa.conta_nome, completa.cartao_nome);
  // Mensagem ("uso pessoal") > já mesclado > conta/cartão > padrão do usuário.
  completa.perfil = (perfilMensagem ?? completa.perfil ?? perfilOrigem ?? perfilPadrao) as
    | Perfil
    | null
    | undefined;
  completa.forma_pagamento = resolver_forma_pagamento(completa, mensagem);

  const faltantes: CampoFaltante[] = [];
  if (completa.valor == null) faltantes.push("valor");
  if (!completa.conta_nome && !completa.cartao_nome) faltantes.push("conta");
  if (!completa.perfil && (completa.conta_nome || completa.cartao_nome)) {
    faltantes.push("perfil");
  }

  if (faltantes.length > 0) {
    return solicitar(completa, faltantes, contexto.nomeUsuario);
  }

  return {
    ...completa,
    valor: completa.valor!,
    data_movimento: completa.data_movimento!,
    perfil: completa.perfil!,
  };
}

function solicitar(
  completa: IntencaoRegistrarMovimento,
  faltantes: CampoFaltante[],
  nomeUsuario?: string | null,
): IntencaoSolicitarInformacao {
  return {
    intencao: "SOLICITAR_INFORMACAO",
    intencao_pendente: "REGISTRAR_MOVIMENTO",
    pergunta: montar_pergunta_faltantes(faltantes, nomeUsuario),
    dados_parciais: dados_parciais_de(completa),
  };
}

/**
 * Completa defaults seguros e mescla `dados_parciais` da intenção pendente
 * (slot-filling entre turnos). Cadastro e recorrência já faziam isso; movimento
 * também — senão a resposta "50" apagava descrição/conta do turno anterior.
 */
export function normalizar_intencao_movimento(
  intencao: IntencaoDetectada,
  contexto: ContextoInterpretacao,
  mensagem = "",
): IntencaoDetectada {
  const pendentes = parciais_da_pendente(contexto.intencaoPendente);
  const nome = contexto.nomeUsuario;

  if (intencao.intencao === "SOLICITAR_INFORMACAO") {
    if (intencao.intencao_pendente !== "REGISTRAR_MOVIMENTO") return intencao;

    const mesclada = mesclar_registrar_movimento(
      dados_de_parcial(intencao.dados_parciais) as Partial<IntencaoRegistrarMovimento>,
      pendentes,
      mensagem,
      contexto,
    );
    const resultado = completar_e_validar(mesclada, contexto, mensagem);
    if (resultado.intencao === "SOLICITAR_INFORMACAO") {
      return {
        ...resultado,
        pergunta: intencao.pergunta
          ? personalizar_pergunta(intencao.pergunta, nome)
          : resultado.pergunta,
      };
    }
    return resultado;
  }

  if (intencao.intencao !== "REGISTRAR_MOVIMENTO") return intencao;

  const mesclada = mesclar_registrar_movimento(intencao, pendentes, mensagem, contexto);
  return completar_e_validar(mesclada, contexto, mensagem);
}
