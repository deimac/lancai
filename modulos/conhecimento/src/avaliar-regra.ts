import type { Movimento, Regra } from "@lancai/banco";
import type {
  AcaoRegra,
  CampoCondicaoRegra,
  CondicaoRegra,
  LogicaCondicoesRegra,
  OperadorCondicaoRegra,
} from "@lancai/tipos";
import { schemaAcaoRegra, schemaCondicaoRegra } from "@lancai/tipos";

export function condicoes_da_regra(regra: Regra): CondicaoRegra[] {
  const bruto = regra.condicoes ?? [];
  return bruto
    .map((item) => {
      const parsed = schemaCondicaoRegra.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is CondicaoRegra => item !== null);
}

export function acoes_da_regra(regra: Regra): AcaoRegra[] {
  const bruto = regra.acoes ?? [];
  return bruto
    .map((item) => {
      const parsed = schemaAcaoRegra.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is AcaoRegra => item !== null);
}

export function categoria_id_da_regra(regra: Regra): string | null {
  const acao = acoes_da_regra(regra).find((item) => item.tipo === "definir_categoria");
  return acao?.tipo === "definir_categoria" ? acao.categoriaId : (regra.categoriaId ?? null);
}

/** Quanto maior, mais específica — usada na ordenação entre regras. */
export function especificidade_regra(regra: Regra): number {
  const condicoes = condicoes_da_regra(regra);
  if (condicoes.length === 0 && regra.condicaoValor) {
    return regra.condicaoValor.length;
  }
  return condicoes.reduce((acc, c) => acc + c.valor.trim().length, 0) + condicoes.length * 10;
}

function textos_descricao(
  movimento: Pick<Movimento, "descricao" | "descricaoFonte" | "favorecidoFonte">,
): string[] {
  return [movimento.descricao, movimento.descricaoFonte, movimento.favorecidoFonte ?? ""];
}

function aplica_operador_texto(
  campo: string,
  operador: OperadorCondicaoRegra,
  esperado: string,
): boolean {
  const alvo = campo.toLocaleLowerCase("pt-BR");
  const trecho = esperado.toLocaleLowerCase("pt-BR");

  switch (operador) {
    case "comeca_com":
      return alvo.startsWith(trecho);
    case "contem":
      return alvo.includes(trecho);
    case "nao_contem":
      return !alvo.includes(trecho);
    case "igual":
      return alvo === trecho;
    case "diferente":
      return alvo !== trecho;
    case "termina_com":
      return alvo.endsWith(trecho);
    case "regex":
      try {
        return new RegExp(esperado, "i").test(campo);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function condicao_casa(
  condicao: CondicaoRegra,
  movimento: Pick<
    Movimento,
    | "descricao"
    | "descricaoFonte"
    | "favorecidoFonte"
    | "valor"
    | "dataMovimento"
    | "tipo"
    | "contaId"
    | "cartaoId"
  >,
): boolean {
  const campo = condicao.campo as CampoCondicaoRegra;
  const operador = condicao.operador as OperadorCondicaoRegra;
  const esperado = condicao.valor.trim();

  switch (campo) {
    case "descricao":
      return textos_descricao(movimento).some((texto) =>
        aplica_operador_texto(texto, operador, esperado),
      );
    case "valor": {
      const nMov = Number(movimento.valor);
      const nEsp = Number(esperado.replace(",", "."));
      if (!Number.isFinite(nMov) || !Number.isFinite(nEsp)) return false;
      if (operador === "igual") return Math.abs(nMov - nEsp) < 0.001;
      if (operador === "diferente") return Math.abs(nMov - nEsp) >= 0.001;
      return false;
    }
    case "data": {
      const data = movimento.dataMovimento;
      if (operador === "igual") return data === esperado;
      if (operador === "diferente") return data !== esperado;
      if (operador === "comeca_com") return data.startsWith(esperado);
      return false;
    }
    case "tipo": {
      const tipo = movimento.tipo;
      if (operador === "igual") return tipo === esperado;
      if (operador === "diferente") return tipo !== esperado;
      return false;
    }
    case "conta": {
      const id = movimento.contaId ?? "";
      if (operador === "igual") return id === esperado;
      if (operador === "diferente") return id !== esperado;
      return false;
    }
    case "cartao": {
      const id = movimento.cartaoId ?? "";
      if (operador === "igual") return id === esperado;
      if (operador === "diferente") return id !== esperado;
      return false;
    }
    default:
      return false;
  }
}

/**
 * Avalia a regra no formato builder. Compatível com legado: se não houver
 * `condicoes` parseáveis mas existir `condicao_valor` + `descricao_contem`,
 * cai no contains clássico.
 */
export function regra_casa(
  regra: Pick<
    Regra,
    "condicoes" | "logicaCondicoes" | "condicaoTipo" | "condicaoValor" | "acoes"
  >,
  movimento: Pick<
    Movimento,
    | "descricao"
    | "descricaoFonte"
    | "favorecidoFonte"
    | "valor"
    | "dataMovimento"
    | "tipo"
    | "contaId"
    | "cartaoId"
  >,
): boolean {
  const condicoes = condicoes_da_regra(regra as Regra);

  if (condicoes.length === 0) {
    if (regra.condicaoTipo === "descricao_contem" && regra.condicaoValor) {
      const trecho = regra.condicaoValor.trim().toLocaleLowerCase("pt-BR");
      if (!trecho) return false;
      return textos_descricao(movimento).some((campo) =>
        campo.toLocaleLowerCase("pt-BR").includes(trecho),
      );
    }
    return false;
  }

  const logica = (regra.logicaCondicoes ?? "ou") as LogicaCondicoesRegra;
  if (logica === "e") {
    return condicoes.every((c) => condicao_casa(c, movimento));
  }
  return condicoes.some((c) => condicao_casa(c, movimento));
}
