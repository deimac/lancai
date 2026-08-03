import type {
  IntencaoCriarCartao,
  IntencaoCriarConta,
  IntencaoDetectada,
  IntencaoSolicitarInformacao,
  ModalidadeCartao,
  Perfil,
} from "@lancai/tipos";
import { mensagem_pede_cartao_debito } from "./inferir-forma-pagamento";
import { inferir_perfil_padrao } from "./inferir-perfil-padrao";
import type { ContextoInterpretacao, IntencaoPendenteSlot } from "./prompt";

type CampoFaltanteConta = "nome" | "saldo_inicial" | "perfil";
type CampoFaltanteCartao = "nome" | "limite" | "fechamento" | "vencimento" | "perfil" | "conta";

function como_numero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim()) {
    const texto = valor.trim();
    // Formato BR: "12.889,00" → 12889; "12889,00" → 12889; "12889.00" → 12889
    const semMilhar = texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto;
    const n = Number(semMilhar);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function como_texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto.length > 0 ? texto : null;
}

function como_perfil(valor: unknown): Perfil | null {
  return valor === "pf" || valor === "pj" ? valor : null;
}

function como_dia(valor: unknown): number | null {
  const n = como_numero(valor);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

function dados_de_parcial(parcial: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return parcial && typeof parcial === "object" ? { ...parcial } : {};
}

function mesclar_criar_conta(
  atual: Partial<IntencaoCriarConta>,
  parciais: Record<string, unknown>,
  perfilPadrao: Perfil | null,
): IntencaoCriarConta {
  return {
    intencao: "CRIAR_CONTA",
    nome: como_texto(atual.nome) ?? como_texto(parciais.nome),
    saldo_inicial: atual.saldo_inicial ?? como_numero(parciais.saldo_inicial),
    perfil: como_perfil(atual.perfil) ?? como_perfil(parciais.perfil) ?? perfilPadrao,
  };
}

function como_modalidade(valor: unknown): ModalidadeCartao | null {
  return valor === "credito" || valor === "debito" || valor === "multiplo" ? valor : null;
}

function inferir_modalidade_cartao(
  atual: Partial<IntencaoCriarCartao>,
  parciais: Record<string, unknown>,
  mensagem: string,
): ModalidadeCartao {
  const explicita = como_modalidade(atual.modalidade) ?? como_modalidade(parciais.modalidade);
  if (explicita) return explicita;
  if (mensagem_pede_cartao_debito(mensagem)) return "debito";
  const contaNome = como_texto(atual.conta_nome) ?? como_texto(parciais.conta_nome);
  if (contaNome) return "multiplo";
  return "credito";
}

function mesclar_criar_cartao(
  atual: Partial<IntencaoCriarCartao>,
  parciais: Record<string, unknown>,
  perfilPadrao: Perfil | null,
  mensagem: string,
): IntencaoCriarCartao {
  const modalidade = inferir_modalidade_cartao(atual, parciais, mensagem);
  const mesclado: IntencaoCriarCartao = {
    intencao: "CRIAR_CARTAO",
    nome: como_texto(atual.nome) ?? como_texto(parciais.nome),
    limite: atual.limite ?? como_numero(parciais.limite),
    fechamento: atual.fechamento ?? como_dia(parciais.fechamento),
    vencimento: atual.vencimento ?? como_dia(parciais.vencimento),
    perfil: como_perfil(atual.perfil) ?? como_perfil(parciais.perfil) ?? perfilPadrao,
    modalidade,
    conta_nome: como_texto(atual.conta_nome) ?? como_texto(parciais.conta_nome),
    numero: como_texto(atual.numero) ?? como_texto(parciais.numero),
    validade: como_texto(atual.validade) ?? como_texto(parciais.validade),
    cvv: como_texto(atual.cvv) ?? como_texto(parciais.cvv),
  };

  // Cartão só de débito: não exige ciclo de fatura/limite — defaults neutros.
  if (mesclado.modalidade === "debito") {
    if (mesclado.limite == null) mesclado.limite = 0;
    if (mesclado.fechamento == null) mesclado.fechamento = 1;
    if (mesclado.vencimento == null) mesclado.vencimento = 1;
  }

  return mesclado;
}

function dados_parciais_conta(completa: IntencaoCriarConta): Record<string, unknown> {
  const dados: Record<string, unknown> = {};
  if (completa.nome) dados.nome = completa.nome;
  if (completa.saldo_inicial != null) dados.saldo_inicial = completa.saldo_inicial;
  if (completa.perfil) dados.perfil = completa.perfil;
  return dados;
}

function dados_parciais_cartao(completa: IntencaoCriarCartao): Record<string, unknown> {
  const dados: Record<string, unknown> = {};
  if (completa.nome) dados.nome = completa.nome;
  if (completa.limite != null) dados.limite = completa.limite;
  if (completa.fechamento != null) dados.fechamento = completa.fechamento;
  if (completa.vencimento != null) dados.vencimento = completa.vencimento;
  if (completa.perfil) dados.perfil = completa.perfil;
  if (completa.modalidade) dados.modalidade = completa.modalidade;
  if (completa.conta_nome) dados.conta_nome = completa.conta_nome;
  if (completa.numero) dados.numero = completa.numero;
  if (completa.validade) dados.validade = completa.validade;
  if (completa.cvv) dados.cvv = completa.cvv;
  return dados;
}

function montar_pergunta_conta(faltantes: CampoFaltanteConta[]): string {
  const rotulos: Record<CampoFaltanteConta, string> = {
    nome: "o nome da conta",
    saldo_inicial: "o saldo atual da conta",
    perfil: "se a conta é pessoal ou da empresa",
  };
  const partes = faltantes.map((campo) => rotulos[campo]);
  if (partes.length === 1) return `Para cadastrar a conta, preciso saber ${partes[0]}.`;
  if (partes.length === 2) return `Para cadastrar a conta, preciso saber ${partes[0]} e ${partes[1]}.`;
  return `Para cadastrar a conta, preciso saber ${partes[0]}, ${partes[1]} e ${partes[2]}.`;
}

function montar_pergunta_cartao(faltantes: CampoFaltanteCartao[]): string {
  const rotulos: Record<CampoFaltanteCartao, string> = {
    nome: "o nome do cartão",
    limite: "o limite do cartão",
    fechamento: "o dia de fechamento da fatura",
    vencimento: "o dia de vencimento da fatura",
    perfil: "se o cartão é pessoal ou da empresa",
    conta: "a conta vinculada (obrigatória para cartão de débito)",
  };
  const partes = faltantes.map((campo) => rotulos[campo]);
  if (partes.length === 1) return `Para cadastrar o cartão, preciso saber ${partes[0]}.`;
  if (partes.length === 2) return `Para cadastrar o cartão, preciso saber ${partes[0]} e ${partes[1]}.`;
  const ultima = partes.pop()!;
  return `Para cadastrar o cartão, preciso saber ${partes.join(", ")} e ${ultima}.`;
}

function solicitar_conta(completa: IntencaoCriarConta, faltantes: CampoFaltanteConta[]): IntencaoSolicitarInformacao {
  return {
    intencao: "SOLICITAR_INFORMACAO",
    intencao_pendente: "CRIAR_CONTA",
    pergunta: montar_pergunta_conta(faltantes),
    dados_parciais: dados_parciais_conta(completa),
  };
}

function solicitar_cartao(completa: IntencaoCriarCartao, faltantes: CampoFaltanteCartao[]): IntencaoSolicitarInformacao {
  return {
    intencao: "SOLICITAR_INFORMACAO",
    intencao_pendente: "CRIAR_CARTAO",
    pergunta: montar_pergunta_cartao(faltantes),
    dados_parciais: dados_parciais_cartao(completa),
  };
}

function faltantes_conta(completa: IntencaoCriarConta): CampoFaltanteConta[] {
  const faltantes: CampoFaltanteConta[] = [];
  if (!completa.nome) faltantes.push("nome");
  if (completa.saldo_inicial == null) faltantes.push("saldo_inicial");
  if (!completa.perfil) faltantes.push("perfil");
  return faltantes;
}

function faltantes_cartao(completa: IntencaoCriarCartao): CampoFaltanteCartao[] {
  const faltantes: CampoFaltanteCartao[] = [];
  if (!completa.nome) faltantes.push("nome");
  if (!completa.perfil) faltantes.push("perfil");
  if (completa.modalidade === "debito") {
    if (!completa.conta_nome) faltantes.push("conta");
    return faltantes;
  }
  if (completa.limite == null) faltantes.push("limite");
  if (completa.fechamento == null) faltantes.push("fechamento");
  if (completa.vencimento == null) faltantes.push("vencimento");
  return faltantes;
}

function parciais_da_pendente(pendente: IntencaoPendenteSlot | null | undefined): {
  alvo: IntencaoPendenteSlot["intencao_pendente"] | null;
  dados: Record<string, unknown>;
} {
  if (!pendente) return { alvo: null, dados: {} };
  return { alvo: pendente.intencao_pendente, dados: dados_de_parcial(pendente.dados_parciais) };
}

/**
 * Completa CRIAR_CONTA / CRIAR_CARTAO com dados_parciais da intenção pendente
 * (slot-filling entre turnos) e, se ainda faltar obrigatório, converte para
 * SOLICITAR_INFORMACAO em vez de deixar o resolvedor falhar pedindo um campo
 * que o usuário já informou no turno anterior.
 */
export function normalizar_intencao_cadastro(
  intencao: IntencaoDetectada,
  contexto: ContextoInterpretacao,
  mensagem = "",
): IntencaoDetectada {
  const perfilPadrao = inferir_perfil_padrao(contexto.contas, contexto.cartoes);
  const { alvo, dados: parciaisPendentes } = parciais_da_pendente(contexto.intencaoPendente);

  if (intencao.intencao === "SOLICITAR_INFORMACAO") {
    if (intencao.intencao_pendente === "CRIAR_CONTA") {
      const completa = mesclar_criar_conta(
        dados_de_parcial(intencao.dados_parciais) as Partial<IntencaoCriarConta>,
        alvo === "CRIAR_CONTA" ? parciaisPendentes : {},
        perfilPadrao,
      );
      const faltantes = faltantes_conta(completa);
      if (faltantes.length === 0) return completa;
      return {
        ...solicitar_conta(completa, faltantes),
        pergunta: intencao.pergunta || montar_pergunta_conta(faltantes),
      };
    }

    if (intencao.intencao_pendente === "CRIAR_CARTAO") {
      const completa = mesclar_criar_cartao(
        dados_de_parcial(intencao.dados_parciais) as Partial<IntencaoCriarCartao>,
        alvo === "CRIAR_CARTAO" ? parciaisPendentes : {},
        perfilPadrao,
        mensagem,
      );
      const faltantes = faltantes_cartao(completa);
      if (faltantes.length === 0) return completa;
      return {
        ...solicitar_cartao(completa, faltantes),
        pergunta: intencao.pergunta || montar_pergunta_cartao(faltantes),
      };
    }

    return intencao;
  }

  if (intencao.intencao === "CRIAR_CONTA") {
    const completa = mesclar_criar_conta(
      intencao,
      alvo === "CRIAR_CONTA" ? parciaisPendentes : {},
      perfilPadrao,
    );
    const faltantes = faltantes_conta(completa);
    if (faltantes.length > 0) return solicitar_conta(completa, faltantes);
    return completa;
  }

  if (intencao.intencao === "CRIAR_CARTAO") {
    const completa = mesclar_criar_cartao(
      intencao,
      alvo === "CRIAR_CARTAO" ? parciaisPendentes : {},
      perfilPadrao,
      mensagem,
    );
    const faltantes = faltantes_cartao(completa);
    if (faltantes.length > 0) return solicitar_cartao(completa, faltantes);
    return completa;
  }

  return intencao;
}
