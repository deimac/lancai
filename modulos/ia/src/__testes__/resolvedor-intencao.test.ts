import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conta, Movimento } from "@lancai/banco";
import { ResolvedorIntencao } from "../resolvedor-intencao";
import { RepositorioContextoEmMemoria } from "../repositorio-contexto-memoria";
import {
  ErroDadosIncompletos,
  ErroEntidadeJaExiste,
  ErroReferenciaAmbiguo,
  ErroReferenciaNaoEncontrada,
} from "../erros";

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
    formaPagamento: null,
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

    it("lança ErroReferenciaAmbiguo quando há vários semelhantes sem código", async () => {
      const a = criarMovimento({
        usuarioId,
        descricao: "compra de um tênis para uso pessoal",
        dataMovimento: "2026-08-05",
      });
      const b = criarMovimento({
        usuarioId,
        descricao: "compra de um tênis para uso pessoal, um gasto pessoal",
        dataMovimento: "2026-08-05",
      });
      repositorio.movimentos.set(a.id, a);
      repositorio.movimentos.set(b.id, b);

      await expect(
        resolvedor.resolver_corrigir_movimento(
          {
            intencao: "CORRIGIR_MOVIMENTO",
            referencia: { descricao: "Tênis" },
            campos_alterados: { valor: 300 },
          },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroReferenciaAmbiguo);
    });
  });

  describe("resolver_consultar_visao", () => {
    it("passa perfil e período direto, sem exigir nenhum filtro nomeado", async () => {
      const filtros = await resolvedor.resolver_consultar_visao(
        { intencao: "CONSULTAR_VISAO", tipo_visao: "saldos", filtros: { perfil: "pj" } },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(filtros).toEqual({ usuarioId, perfil: "pj", contaId: undefined, cartaoId: undefined, categoriaId: undefined, pessoaId: undefined, periodo: undefined });
    });

    it("resolve conta_nome, cartao_nome, categoria_nome e pessoa_nome para IDs", async () => {
      const conta = criarConta({ usuarioId, nome: "Nubank" });
      repositorio.contas.set(conta.id, conta);
      const categoriaCriada = await repositorio.criarCategoria(usuarioId, "Alimentação", "despesa");
      const pessoaCriada = await repositorio.criarPessoa(usuarioId, "João", "cliente");

      const filtros = await resolvedor.resolver_consultar_visao(
        {
          intencao: "CONSULTAR_VISAO",
          tipo_visao: "categoria",
          filtros: {
            conta_nome: "nubank",
            categoria_nome: "alimentação",
            pessoa_nome: "joão",
            periodo: { de: "2026-08-01", ate: "2026-08-31" },
          },
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(filtros.contaId).toBe(conta.id);
      expect(filtros.categoriaId).toBe(categoriaCriada.id);
      expect(filtros.pessoaId).toBe(pessoaCriada.id);
      expect(filtros.periodo).toEqual({ de: "2026-08-01", ate: "2026-08-31" });
    });

    it("lança ErroReferenciaNaoEncontrada quando a categoria citada no filtro não existe (não cria automaticamente)", async () => {
      await expect(
        resolvedor.resolver_consultar_visao(
          { intencao: "CONSULTAR_VISAO", tipo_visao: "categoria", filtros: { categoria_nome: "Categoria Inexistente" } },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroReferenciaNaoEncontrada);
    });

    it("lança ErroReferenciaNaoEncontrada quando o cartao_nome citado no filtro não existe", async () => {
      await expect(
        resolvedor.resolver_consultar_visao(
          { intencao: "CONSULTAR_VISAO", tipo_visao: "cartoes", filtros: { cartao_nome: "Cartão que não existe" } },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroReferenciaNaoEncontrada);
    });
  });

  describe("resolver_criar_conta", () => {
    it("cria a conta com os dados informados", async () => {
      const conta = await resolvedor.resolver_criar_conta(
        { intencao: "CRIAR_CONTA", nome: "Nubank", saldo_inicial: 1000, perfil: "pf" },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(conta.nome).toBe("Nubank");
      expect(conta.saldoAtual).toBe("1000");
      expect(conta.perfil).toBe("pf");
      expect(conta.usuarioId).toBe(usuarioId);

      const contasCriadas = await repositorio.listarContas(usuarioId);
      expect(contasCriadas).toHaveLength(1);
    });

    it("lança ErroDadosIncompletos quando falta o nome", async () => {
      await expect(
        resolvedor.resolver_criar_conta(
          { intencao: "CRIAR_CONTA", saldo_inicial: 1000, perfil: "pf" },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroDadosIncompletos);
    });

    it("lança ErroDadosIncompletos quando falta o saldo inicial", async () => {
      await expect(
        resolvedor.resolver_criar_conta(
          { intencao: "CRIAR_CONTA", nome: "Nubank", perfil: "pf" },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroDadosIncompletos);
    });

    it("lança ErroDadosIncompletos quando falta o perfil", async () => {
      await expect(
        resolvedor.resolver_criar_conta(
          { intencao: "CRIAR_CONTA", nome: "Nubank", saldo_inicial: 1000 },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroDadosIncompletos);
    });

    it("lança ErroEntidadeJaExiste quando já existe conta com o mesmo nome (evita duplicação)", async () => {
      const existente = criarConta({ usuarioId, nome: "C6 Bank", saldoAtual: "4.01" });
      repositorio.contas.set(existente.id, existente);

      await expect(
        resolvedor.resolver_criar_conta(
          { intencao: "CRIAR_CONTA", nome: "C6 Bank", saldo_inicial: 4.03, perfil: "pf" },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroEntidadeJaExiste);

      const contas = await repositorio.listarContas(usuarioId);
      expect(contas).toHaveLength(1);
      expect(contas[0]?.saldoAtual).toBe("4.01");
    });
  });

  describe("resolver_corrigir_conta", () => {
    it("atualiza o saldo de uma conta existente sem criar outra", async () => {
      const existente = criarConta({ usuarioId, nome: "C6 Bank", saldoAtual: "4.01" });
      repositorio.contas.set(existente.id, existente);

      const atualizada = await resolvedor.resolver_corrigir_conta(
        {
          intencao: "CORRIGIR_CONTA",
          conta_nome: "c6",
          campos_alterados: { saldo_atual: 4.03 },
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(atualizada.id).toBe(existente.id);
      expect(atualizada.saldoAtual).toBe("4.03");
      expect(await repositorio.listarContas(usuarioId)).toHaveLength(1);
    });

    it("lança ErroReferenciaNaoEncontrada quando a conta citada não existe", async () => {
      await expect(
        resolvedor.resolver_corrigir_conta(
          {
            intencao: "CORRIGIR_CONTA",
            conta_nome: "Conta que não existe",
            campos_alterados: { saldo_atual: 100 },
          },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroReferenciaNaoEncontrada);
    });

    it("exclui logicamente a conta (ativo = false) sem apagar o registro", async () => {
      const existente = criarConta({ usuarioId, nome: "Inter" });
      repositorio.contas.set(existente.id, existente);

      const removida = await resolvedor.resolver_corrigir_conta(
        {
          intencao: "CORRIGIR_CONTA",
          conta_nome: "Inter",
          campos_alterados: { ativo: false },
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(removida.ativo).toBe(false);
      expect(await repositorio.listarContas(usuarioId)).toHaveLength(0);
      expect(repositorio.contas.get(existente.id)?.ativo).toBe(false);
    });
  });

  describe("resolver_corrigir_cartao", () => {
    it("exclui logicamente o cartão (ativo = false)", async () => {
      const conta = criarConta({ usuarioId, nome: "Mercado Pago" });
      repositorio.contas.set(conta.id, conta);
      const cartao = await repositorio.criarCartao({
        nome: "Nubank",
        limite: 10000,
        fechamento: 20,
        vencimento: 27,
        perfil: "pj",
        contaId: conta.id,
        usuarioId,
      });

      const removido = await resolvedor.resolver_corrigir_cartao(
        {
          intencao: "CORRIGIR_CARTAO",
          cartao_nome: "Nubank",
          campos_alterados: { ativo: false },
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(removido.id).toBe(cartao.id);
      expect(removido.ativo).toBe(false);
      expect(await repositorio.listarCartoes(usuarioId)).toHaveLength(0);
    });
  });

  describe("resolver_criar_cartao", () => {
    it("cria o cartão resolvendo conta_nome para contaId", async () => {
      const conta = criarConta({ usuarioId, nome: "Inter" });
      repositorio.contas.set(conta.id, conta);

      const cartao = await resolvedor.resolver_criar_cartao(
        {
          intencao: "CRIAR_CARTAO",
          nome: "Nubank",
          limite: 5000,
          fechamento: 20,
          vencimento: 27,
          perfil: "pf",
          conta_nome: "inter",
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(cartao.nome).toBe("Nubank");
      expect(cartao.limite).toBe("5000");
      expect(cartao.fechamento).toBe(20);
      expect(cartao.vencimento).toBe(27);
      expect(cartao.contaId).toBe(conta.id);
      expect(cartao.modalidade).toBe("multiplo");
      expect(cartao.melhorDiaCompra).toBe(21);
    });

    it("lança ErroReferenciaNaoEncontrada quando a conta_nome citada não existe", async () => {
      await expect(
        resolvedor.resolver_criar_cartao(
          {
            intencao: "CRIAR_CARTAO",
            nome: "Nubank",
            limite: 5000,
            fechamento: 20,
            vencimento: 27,
            perfil: "pf",
            conta_nome: "Conta que não existe",
          },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroReferenciaNaoEncontrada);
    });

    it("cria o cartão sem conta vinculada quando conta_nome não é informado", async () => {
      const cartao = await resolvedor.resolver_criar_cartao(
        {
          intencao: "CRIAR_CARTAO",
          nome: "Azul Itaú",
          limite: 8000,
          fechamento: 10,
          vencimento: 17,
          perfil: "pf",
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(cartao.nome).toBe("Azul Itaú");
      expect(cartao.contaId).toBeNull();
      expect(cartao.modalidade).toBe("credito");
    });

    it("cria cartão de débito exigindo conta vinculada", async () => {
      const conta = criarConta({ usuarioId, nome: "C6 Bank" });
      repositorio.contas.set(conta.id, conta);

      const cartao = await resolvedor.resolver_criar_cartao(
        {
          intencao: "CRIAR_CARTAO",
          nome: "Visa Débito",
          perfil: "pf",
          modalidade: "debito",
          conta_nome: "C6 Bank",
        },
        { usuarioId, criadoPor: usuarioId },
      );

      expect(cartao.modalidade).toBe("debito");
      expect(cartao.contaId).toBe(conta.id);
      expect(cartao.limite).toBe("0");
    });

    it("lança ErroDadosIncompletos quando cartão de débito vem sem conta", async () => {
      await expect(
        resolvedor.resolver_criar_cartao(
          {
            intencao: "CRIAR_CARTAO",
            nome: "Visa Débito",
            perfil: "pf",
            modalidade: "debito",
          },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroDadosIncompletos);
    });

    it("lança ErroDadosIncompletos quando falta o limite", async () => {
      await expect(
        resolvedor.resolver_criar_cartao(
          {
            intencao: "CRIAR_CARTAO",
            nome: "Nubank",
            fechamento: 20,
            vencimento: 27,
            perfil: "pf",
          },
          { usuarioId, criadoPor: usuarioId },
        ),
      ).rejects.toThrow(ErroDadosIncompletos);
    });
  });
});
