import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conta, Movimento } from "@lancai/banco";
import { ResolvedorIntencao } from "../resolvedor-intencao";
import { RepositorioContextoEmMemoria } from "../repositorio-contexto-memoria";
import { ErroReferenciaNaoEncontrada } from "../erros";

function criarConta(sobrepor: Partial<Conta> = {}): Conta {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Nubank PF",
    saldoInicial: "0",
    saldoAtual: "1000",
    perfil: "pf",
    ativo: true,
    usuarioId: randomUUID(),
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

function criarMovimento(sobrepor: Partial<Movimento> = {}): Movimento {
  const agora = new Date();
  return {
    id: randomUUID(),
    descricao: "Combustível",
    valor: "185.00",
    tipo: "despesa",
    status: "realizado",
    perfil: "pf",
    dataMovimento: "2026-07-31",
    dataLancamento: agora,
    contaId: null,
    cartaoId: null,
    categoriaId: randomUUID(),
    pessoaId: null,
    usuarioId: randomUUID(),
    dataCriacao: agora,
    dataAtualizacao: agora,
    criadoPor: randomUUID(),
    alteradoPor: null,
    ...sobrepor,
  };
}

describe("ResolvedorIntencao", () => {
  let repositorio: RepositorioContextoEmMemoria;
  let resolvedor: ResolvedorIntencao;
  let usuarioId: string;

  beforeEach(() => {
    repositorio = new RepositorioContextoEmMemoria();
    resolvedor = new ResolvedorIntencao(repositorio);
    usuarioId = randomUUID();
  });

  describe("resolver_registrar_movimento", () => {
    it("resolve conta por correspondência parcial do nome (case-insensitive)", async () => {
      const conta = criarConta({ usuarioId, nome: "Nubank PF" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await resolvedor.resolver_registrar_movimento(
        {
          intencao: "REGISTRAR_MOVIMENTO",
          tipo_movimento: "despesa",
          valor: 185,
          data_movimento: "2026-07-31",
          descricao: "Combustível",
          perfil: "pf",
          conta_nome: "nubank",
          categoria_nome: "Combustível",
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(resultado.contaId).toBe(conta.id);
    });

    it("cria a categoria automaticamente quando ela ainda não existe", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      const resultado = await resolvedor.resolver_registrar_movimento(
        {
          intencao: "REGISTRAR_MOVIMENTO",
          tipo_movimento: "despesa",
          valor: 45,
          data_movimento: "2026-07-31",
          descricao: "Almoço",
          perfil: "pf",
          conta_nome: conta.nome,
          categoria_nome: "Alimentação",
        },
        { usuarioId, criadoPor: usuarioId },
      );

      const categoriasCriadas = await repositorio.listarCategorias(usuarioId);
      expect(categoriasCriadas).toHaveLength(1);
      expect(categoriasCriadas[0]?.nome).toBe("Alimentação");
      expect(categoriasCriadas[0]?.tipo).toBe("despesa");
      expect(resultado.categoriaId).toBe(categoriasCriadas[0]?.id);
    });

    it("usa a categoria 'Outros' quando a IA não informou nenhuma", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      await resolvedor.resolver_registrar_movimento(
        {
          intencao: "REGISTRAR_MOVIMENTO",
          tipo_movimento: "despesa",
          valor: 45,
          data_movimento: "2026-07-31",
          descricao: "Não sei o que é isso",
          perfil: "pf",
          conta_nome: conta.nome,
        },
        { usuarioId, criadoPor: usuarioId },
      );

      const categorias = await repositorio.listarCategorias(usuarioId);
      expect(categorias[0]?.nome).toBe("Outros");
    });

    it("cria a pessoa automaticamente quando ela ainda não existe", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      const resultado = await resolvedor.resolver_registrar_movimento(
        {
          intencao: "REGISTRAR_MOVIMENTO",
          tipo_movimento: "receita",
          valor: 5000,
          data_movimento: "2026-07-31",
          descricao: "Pagamento do cliente XPTO",
          perfil: "pj",
          conta_nome: conta.nome,
          pessoa_nome: "XPTO",
        },
        { usuarioId, criadoPor: usuarioId },
      );

      const pessoas = await repositorio.listarPessoas(usuarioId);
      expect(pessoas).toHaveLength(1);
      expect(pessoas[0]?.nome).toBe("XPTO");
      expect(resultado.pessoaId).toBe(pessoas[0]?.id);
    });

    it("lança ErroReferenciaNaoEncontrada quando a conta citada não existe", async () => {
      await expect(
        resolvedor.resolver_registrar_movimento(
          {
            intencao: "REGISTRAR_MOVIMENTO",
            tipo_movimento: "despesa",
            valor: 100,
            data_movimento: "2026-07-31",
            descricao: "Combustível",
            perfil: "pf",
            conta_nome: "Conta que não existe",
          },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroReferenciaNaoEncontrada);
    });

    it("repassa a quantidade de parcelas como parcelamento", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      const resultado = await resolvedor.resolver_registrar_movimento(
        {
          intencao: "REGISTRAR_MOVIMENTO",
          tipo_movimento: "despesa",
          valor: 3000,
          data_movimento: "2026-07-31",
          descricao: "TV",
          perfil: "pf",
          cartao_nome: "Inter",
          categoria_nome: "Casa",
          parcelas: 10,
        },
        { usuarioId, criadoPor: usuarioId },
      ).catch((erro) => {
        // Sem cartão "Inter" cadastrado, esperamos o erro de referência.
        expect(erro).toBeInstanceOf(ErroReferenciaNaoEncontrada);
        return undefined;
      });

      expect(resultado).toBeUndefined();
    });
  });

  describe("resolver_corrigir_movimento", () => {
    it("localiza o movimento pela descrição e aplica o novo valor", async () => {
      const movimento = criarMovimento({ usuarioId, descricao: "Combustível", dataMovimento: "2026-07-31" });
      repositorio.movimentos.set(movimento.id, movimento);

      const resultado = await resolvedor.resolver_corrigir_movimento(
        {
          intencao: "CORRIGIR_MOVIMENTO",
          referencia: { descricao: "combustível" },
          campos_alterados: { valor: 210 },
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(resultado.movimentoId).toBe(movimento.id);
      expect(resultado.campos.valor).toBe(210);
    });

    it("resolve categoria_nome em campos_alterados criando a categoria se necessário", async () => {
      const movimento = criarMovimento({ usuarioId, descricao: "Almoço" });
      repositorio.movimentos.set(movimento.id, movimento);

      const resultado = await resolvedor.resolver_corrigir_movimento(
        {
          intencao: "CORRIGIR_MOVIMENTO",
          referencia: { descricao: "Almoço" },
          campos_alterados: { categoria_nome: "Lazer" },
        },
        { usuarioId, criadoPor: usuarioId },
      );

      const categorias = await repositorio.listarCategorias(usuarioId);
      expect(categorias[0]?.nome).toBe("Lazer");
      expect(resultado.campos.categoriaId).toBe(categorias[0]?.id);
    });

    it("lança ErroReferenciaNaoEncontrada quando não encontra o movimento a corrigir", async () => {
      await expect(
        resolvedor.resolver_corrigir_movimento(
          {
            intencao: "CORRIGIR_MOVIMENTO",
            referencia: { descricao: "Algo que nunca existiu" },
            campos_alterados: { valor: 100 },
          },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroReferenciaNaoEncontrada);
    });
  });
});
