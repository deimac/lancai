import type { FormaPagamento, IntencaoDetectada, IntencaoRegistrarMovimento, Perfil } from "@lancai/tipos";
import { inferir_forma_pagamento_da_mensagem } from "./inferir-forma-pagamento";
import {
  inferir_origem_da_mensagem,
  nome_corresponde_cadastro,
  resolver_nome_canonico,
} from "./inferir-origem-movimento";
import { inferir_perfil_padrao } from "./inferir-perfil-padrao";
import { enxugar_descricao_lancamento } from "./normalizar-descricao";
import type { ContextoInterpretacao } from "./prompt";

/** Perfil explícito na mensagem (tem prioridade sobre perfil da conta/cartão). */
export function inferir_perfil_da_mensagem(mensagem: string): Perfil | null {
  const texto = mensagem.toLocaleLowerCase("pt-BR");
  const pf =
    /\b(?:para\s+)?uso\s+pessoal\b/.test(texto) ||
    /\bgasto\s+pessoal\b/.test(texto) ||
    /\bganho\s+pessoal\b/.test(texto) ||
    /\bpf\b/.test(texto) ||
    /\bpessoal(?:mente)?\b/.test(texto);
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
    if (/\b(?:para\s+)?uso\s+pessoal\b|\bgasto\s+pessoal\b/.test(texto)) return "pf";
    if (/\b(?:para\s+)?(?:a\s+)?empresa\b|\bpj\b/.test(texto)) return "pj";
  }
  return null;
}

type CampoFaltante = "valor" | "conta" | "perfil";

function montar_pergunta_faltantes(faltantes: CampoFaltante[]): string {
  const partes: string[] = [];
  if (faltantes.includes("valor")) partes.push("qual o valor");
  if (faltantes.includes("conta")) partes.push("em qual conta ou cartão");
  if (faltantes.includes("perfil")) partes.push("se foi um gasto/ganho pessoal ou da empresa");

  if (partes.length === 0) return "Pode me dar mais detalhes desse lançamento?";
  if (partes.length === 1) return `Para registrar, preciso saber ${partes[0]}.`;
  if (partes.length === 2) return `Para registrar, preciso saber ${partes[0]} e ${partes[1]}.`;
  return `Para registrar, preciso saber ${partes[0]}, ${partes[1]} e ${partes[2]}.`;
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

/** Extrai data explícita DD/MM[/AAAA] da mensagem. */
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

  return null;
}

/** Corrige "ontem"/"hoje"/data explícita se a IA errou ou omitiu a data. */
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

/**
 * Completa defaults seguros (data, origem da mensagem, perfil, forma_pagamento)
 * e, se ainda faltar dado obrigatório, converte para SOLICITAR_INFORMACAO.
 */
export function normalizar_intencao_movimento(
  intencao: IntencaoDetectada,
  contexto: ContextoInterpretacao,
  mensagem = "",
): IntencaoDetectada {
  if (intencao.intencao !== "REGISTRAR_MOVIMENTO") return intencao;

  const perfilPadrao = inferir_perfil_padrao(contexto.contas, contexto.cartoes);
  const origem = resolver_origem(intencao, contexto, mensagem);

  const completa: IntencaoRegistrarMovimento = {
    ...intencao,
    descricao: enxugar_descricao_lancamento(intencao.descricao),
    data_movimento: resolver_data_movimento(contexto.dataAtual, intencao.data_movimento, mensagem),
    conta_nome: origem.conta_nome,
    cartao_nome: origem.cartao_nome,
  };

  const perfilMensagem = inferir_perfil_da_mensagem(mensagem);
  const perfilOrigem = inferir_perfil_da_origem(contexto, completa.conta_nome, completa.cartao_nome);
  // Mensagem ("uso pessoal") > IA > conta/cartão > padrão do usuário.
  completa.perfil = (perfilMensagem ?? intencao.perfil ?? perfilOrigem ?? perfilPadrao) as
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
    return {
      intencao: "SOLICITAR_INFORMACAO",
      intencao_pendente: "REGISTRAR_MOVIMENTO",
      pergunta: montar_pergunta_faltantes(faltantes),
      dados_parciais: dados_parciais_de(completa),
    };
  }

  return {
    ...completa,
    valor: completa.valor!,
    data_movimento: completa.data_movimento!,
    perfil: completa.perfil!,
  };
}
