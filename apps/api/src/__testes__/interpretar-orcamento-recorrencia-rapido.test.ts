import { describe, expect, it } from "vitest";
import {
  interpretar_orcamento_rapido,
  interpretar_recorrencia_rapida,
} from "../servicos/interpretar-orcamento-recorrencia-rapido";

describe("interpretar_orcamento_rapido", () => {
  it("define orçamento por categoria", () => {
    const r = interpretar_orcamento_rapido("orçamento de alimentação 800");
    expect(r).toMatchObject({
      intencao: "DEFINIR_ORCAMENTO",
      valor_limite: 800,
      categoria_nome: "alimentação",
    });
  });

  it("consulta orçamento", () => {
    expect(interpretar_orcamento_rapido("como está meu orçamento?")).toMatchObject({
      intencao: "CONSULTAR_ORCAMENTO",
    });
  });
});

describe("interpretar_recorrencia_rapida", () => {
  it("cria recorrência todo mês", () => {
    const r = interpretar_recorrencia_rapida("todo mês dia 10 Netflix 55");
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      dia_do_mes: 10,
      valor: 55,
    });
    expect(r && "descricao" in r ? r.descricao.toLowerCase() : "").toContain("netflix");
  });

  it("lista recorrências", () => {
    expect(interpretar_recorrencia_rapida("listar recorrências")).toMatchObject({
      intencao: "LISTAR_RECORRENCIAS",
    });
  });
});
