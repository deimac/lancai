import type { IntencaoDetectada, IntencaoRegistrarMovimento, Perfil } from "@lancai/tipos";
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
  return dados;
}

/**
 * Completa defaults seguros (data = hoje, perfil único, conta única/hábito) e,
 * se ainda faltar dado obrigatório, converte para SOLICITAR_INFORMACAO em vez
 * de deixar o motor falhar ou a IA inventar valores.
 */
export function normalizar_intencao_movimento(
  intencao: IntencaoDetectada,
  contexto: ContextoInterpretacao,
): IntencaoDetectada {
  if (intencao.intencao !== "REGISTRAR_MOVIMENTO") return intencao;

  const perfilPadrao = inferir_perfil_padrao(contexto.contas, contexto.cartoes);
  const origemPadrao = inferir_conta_ou_cartao(contexto);

  const completa: IntencaoRegistrarMovimento = {
    ...intencao,
    data_movimento: intencao.data_movimento ?? contexto.dataAtual,
    perfil: (intencao.perfil ?? perfilPadrao) as Perfil | null | undefined,
    conta_nome: intencao.conta_nome ?? origemPadrao.conta_nome ?? null,
    cartao_nome: intencao.cartao_nome ?? origemPadrao.cartao_nome ?? null,
  };

  const faltantes: CampoFaltante[] = [];
  if (completa.valor == null) faltantes.push("valor");
  if (!completa.conta_nome && !completa.cartao_nome) faltantes.push("conta");
  if (!completa.perfil) faltantes.push("perfil");

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
