import type { FormaPagamento, IntencaoDetectada, IntencaoRegistrarMovimento, Perfil } from "@lancai/tipos";
import { inferir_forma_pagamento_da_mensagem } from "./inferir-forma-pagamento";
import { inferir_perfil_padrao } from "./inferir-perfil-padrao";
import type { ContextoInterpretacao } from "./prompt";

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

  // Cartão sem pista de débito → crédito (não perguntar).
  if (intencao.cartao_nome) return "credito";

  // Conta (pagamento/recebimento) sem pista → Pix (nunca null).
  if (intencao.conta_nome) return "pix";

  return null;
}

function nome_corresponde(cadastro: string, citado: string): boolean {
  const a = cadastro.toLocaleLowerCase("pt-BR");
  const b = citado.toLocaleLowerCase("pt-BR");
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Perfil do lançamento = perfil da conta/cartão usado. Assim, mesmo com
 * mistura PF/PJ no cadastro, não perguntamos se a origem já está clara.
 */
function inferir_perfil_da_origem(
  contexto: ContextoInterpretacao,
  contaNome: string | null | undefined,
  cartaoNome: string | null | undefined,
): Perfil | null {
  if (cartaoNome) {
    const cartao = contexto.cartoes.find((item) => nome_corresponde(item.nome, cartaoNome));
    if (cartao?.perfil === "pf" || cartao?.perfil === "pj") return cartao.perfil;
  }
  if (contaNome) {
    const conta = contexto.contas.find((item) => nome_corresponde(item.nome, contaNome));
    if (conta?.perfil === "pf" || conta?.perfil === "pj") return conta.perfil;
  }
  return null;
}

/**
 * Completa defaults seguros (data = hoje, perfil da conta/cartão, forma_pagamento)
 * e, se ainda faltar dado obrigatório, converte para SOLICITAR_INFORMACAO.
 * Nunca pede forma de pagamento; com conta/cartão resolvido, nunca pede perfil.
 */
export function normalizar_intencao_movimento(
  intencao: IntencaoDetectada,
  contexto: ContextoInterpretacao,
  mensagem = "",
): IntencaoDetectada {
  if (intencao.intencao !== "REGISTRAR_MOVIMENTO") return intencao;

  const perfilPadrao = inferir_perfil_padrao(contexto.contas, contexto.cartoes);
  const origemPadrao = inferir_conta_ou_cartao(contexto);

  const completa: IntencaoRegistrarMovimento = {
    ...intencao,
    data_movimento: intencao.data_movimento ?? contexto.dataAtual,
    conta_nome: intencao.conta_nome ?? origemPadrao.conta_nome ?? null,
    cartao_nome: intencao.cartao_nome ?? origemPadrao.cartao_nome ?? null,
  };

  const perfilOrigem = inferir_perfil_da_origem(contexto, completa.conta_nome, completa.cartao_nome);
  completa.perfil = (intencao.perfil ?? perfilOrigem ?? perfilPadrao) as Perfil | null | undefined;
  completa.forma_pagamento = resolver_forma_pagamento(completa, mensagem);

  const faltantes: CampoFaltante[] = [];
  if (completa.valor == null) faltantes.push("valor");
  if (!completa.conta_nome && !completa.cartao_nome) faltantes.push("conta");
  // Perfil vem da conta/cartão — nunca perguntar junto com "qual conta".
  // Só pergunta perfil se a origem já existe e ainda assim não deu para resolver.
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
