import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Movimento, NovaRegra, Regra } from "@lancai/banco";
import { separar_correcao_por_grupo } from "@lancai/tipos";
import { especificidade_regra } from "../avaliar-regra";
import { regra_casa, ServicoConhecimento } from "../servico-conhecimento";
import { propor_trecho_regra } from "../trecho-regra";
import { ErroConhecimentoInvalido, ErroMovimentoNaoEncontrado } from "../erros";
import type {
  CamposAtualizarRegra,
  OperacaoConhecimento,
  RepositorioConhecimento,
} from "../repositorio";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";

function entrada_regra_contem(workspaceId: string, trecho: string, categoriaId: string) {
  return {
    workspaceId,
    nome: `"${trecho}" → categoria`,
    logicaCondicoes: "ou" as const,
    condicoes: [{ campo: "descricao" as const, operador: "contem" as const, valor: trecho }],
    acoes: [{ tipo: "definir_categoria" as const, categoriaId }],
  };
}

class RepositorioEmMemoria implements RepositorioConhecimento {
  movimentos = new Map<string, Movimento>();
  /** id → { nome, workspaceId } */
  categorias = new Map<string, { nome: string; workspaceId: string }>();
  pessoas = new Map<string, { nome: string; workspaceId: string }>();
  workspacesPorUsuario = new Map<string, string[]>();
  regras: Regra[] = [];
  auditorias: OperacaoConhecimento["auditoria"][] = [];

  async obterMovimento(id: string) {
    return this.movimentos.get(id);
  }

  async obterCategoria(id: string) {
    const cat = this.categorias.get(id);
    return cat ? { id, nome: cat.nome } : undefined;
  }

  async obterPessoa(id: string) {
    const pessoa = this.pessoas.get(id);
    return pessoa ? { id, nome: pessoa.nome } : undefined;
  }

  async buscarCategoriaPorNome(workspaceId: string, nome: string) {
    const alvo = nome.toLocaleLowerCase("pt-BR");
    for (const [id, cat] of this.categorias) {
      if (
        cat.workspaceId === workspaceId &&
        cat.nome.toLocaleLowerCase("pt-BR") === alvo
      ) {
        return { id, nome: cat.nome };
      }
    }
    return undefined;
  }

  async buscarPessoaPorNome(workspaceId: string, nome: string) {
    const alvo = nome.toLocaleLowerCase("pt-BR");
    for (const [id, pessoa] of this.pessoas) {
      if (
        pessoa.workspaceId === workspaceId &&
        pessoa.nome.toLocaleLowerCase("pt-BR") === alvo
      ) {
        return { id, nome: pessoa.nome };
      }
    }
    return undefined;
  }

  async atualizarConhecimento(operacao: OperacaoConhecimento) {
    const atual = this.movimentos.get(operacao.movimentoId);
    if (!atual) throw new Error("movimento inexistente no teste");
    const atualizado = { ...atual, ...operacao.campos } as Movimento;
    this.movimentos.set(operacao.movimentoId, atualizado);
    this.auditorias.push(operacao.auditoria);
    return atualizado;
  }

  async listarRegrasAtivas(workspaceIds: string[]) {
    const ids = new Set(workspaceIds);
    return this.regras
      .filter((r) => ids.has(r.workspaceId) && r.ativa)
      .sort(
        (a, b) =>
          especificidade_regra(b) - especificidade_regra(a) ||
          a.dataCriacao.getTime() - b.dataCriacao.getTime(),
      );
  }

  async listarRegras(workspaceIds: string[]) {
    const ids = new Set(workspaceIds);
    return this.regras
      .filter((r) => ids.has(r.workspaceId))
      .sort(
        (a, b) =>
          Number(b.ativa) - Number(a.ativa) ||
          especificidade_regra(b) - especificidade_regra(a) ||
          a.dataCriacao.getTime() - b.dataCriacao.getTime(),
      );
  }

  async criarRegra(regra: NovaRegra) {
    const agora = new Date();
    const criada: Regra = {
      id: randomUUID(),
      workspaceId: regra.workspaceId,
      origem: regra.origem ?? "manual",
      ativa: regra.ativa ?? true,
      nome: regra.nome,
      logicaCondicoes: regra.logicaCondicoes ?? "ou",
      condicoes: regra.condicoes ?? [],
      acoes: regra.acoes ?? [],
      condicaoTipo: regra.condicaoTipo ?? null,
      condicaoValor: regra.condicaoValor ?? null,
      categoriaId: regra.categoriaId ?? null,
      perfil: regra.perfil ?? null,
      dataCriacao: agora,
      dataAtualizacao: agora,
    };
    this.regras.push(criada);
    return criada;
  }

  async obterRegra(id: string) {
    return this.regras.find((r) => r.id === id);
  }

  async atualizarRegra(id: string, campos: CamposAtualizarRegra) {
    const atual = this.regras.find((r) => r.id === id);
    if (!atual) return undefined;
    Object.assign(atual, campos, { dataAtualizacao: new Date() });
    return atual;
  }

  async excluirRegra(id: string) {
    this.regras = this.regras.filter((r) => r.id !== id);
  }

  async listarMovimentoIdsParaRegras(workspaceIds: string[]) {
    const ids = new Set(workspaceIds);
    return [...this.movimentos.values()]
      .filter((m) => ids.has(m.workspaceId) && m.classificadoPor !== "usuario")
      .map((m) => m.id);
  }

  async listarWorkspaceIdsDoUsuario(usuarioId: string) {
    return this.workspacesPorUsuario.get(usuarioId) ?? [WORKSPACE];
  }

  async listarCategoriasAtivas(workspaceId: string) {
    return [...this.categorias.entries()]
      .filter(([, cat]) => cat.workspaceId === workspaceId)
      .map(([id, cat]) => ({
        id,
        nome: cat.nome,
        tipo: "ambos",
      }));
  }

  cadastrarCategoria(id: string, nome: string, workspaceId = WORKSPACE) {
    this.categorias.set(id, { nome, workspaceId });
  }
}

function criarMovimento(sobrepor: Partial<Movimento> = {}): Movimento {
  const agora = new Date();
  return {
    id: randomUUID(),
    workspaceId: WORKSPACE,
    fonte: "open_finance",
    provedor: "provedor_teste",
    idExterno: "tx-1",
    descricaoFonte: "PAG*POSTO IPIRANGA 4471",
    favorecidoFonte: null,
    statusFonte: "confirmado",
    parcelaNumero: null,
    parcelaTotal: null,
    parcelaCompraEm: null,
    parcelaCompraValor: null,
    descricao: "PAG*POSTO IPIRANGA 4471",
    valor: "185.00",
    tipo: "despesa",
    status: "realizado",
    perfil: "pf",
    formaPagamento: null,
    dataMovimento: "2026-08-01",
    dataLancamento: agora,
    contaId: null,
    cartaoId: null,
    categoriaId: randomUUID(),
    pessoaId: null,
    tags: [],
    observacoes: null,
    classificadoPor: "usuario",
    regraId: null,
    classificadoEm: null,
    confiancaIa: null,
    ignoradoEmRelatorio: false,
    usuarioId: randomUUID(),
    dataCriacao: agora,
    dataAtualizacao: agora,
    criadoPor: randomUUID(),
    alteradoPor: null,
    ...sobrepor,
  };
}

describe("ServicoConhecimento", () => {
  let repositorio: RepositorioEmMemoria;
  let servico: ServicoConhecimento;
  let usuarioId: string;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    servico = new ServicoConhecimento(repositorio);
    usuarioId = randomUUID();
    repositorio.workspacesPorUsuario.set(usuarioId, [WORKSPACE]);
  });

  it("edita o Conhecimento de uma movimentação vinda do banco", async () => {
    const movimento = criarMovimento();
    const categoriaNova = randomUUID();
    repositorio.movimentos.set(movimento.id, movimento);
    repositorio.cadastrarCategoria(categoriaNova, "Transporte");

    const atualizado = await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: {
        descricao: "Gasolina do carro",
        categoriaId: categoriaNova,
        tags: ["viagem"],
      },
    });

    expect(atualizado.descricao).toBe("Gasolina do carro");
    expect(atualizado.categoriaId).toBe(categoriaNova);
    expect(atualizado.tags).toEqual(["viagem"]);
  });

  it("preserva a descrição da instituição ao renomear a descrição do LançAI", async () => {
    const movimento = criarMovimento();
    repositorio.movimentos.set(movimento.id, movimento);

    const atualizado = await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: { descricao: "Gasolina do carro" },
    });

    expect(atualizado.descricaoFonte).toBe("PAG*POSTO IPIRANGA 4471");
  });

  it("não toca em nenhum campo do Fato Financeiro", async () => {
    const movimento = criarMovimento();
    repositorio.movimentos.set(movimento.id, movimento);

    await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: { descricao: "Gasolina do carro", ignoradoEmRelatorio: true },
    });

    const depois = repositorio.movimentos.get(movimento.id)!;
    expect(depois.valor).toBe(movimento.valor);
    expect(depois.dataMovimento).toBe(movimento.dataMovimento);
    expect(depois.contaId).toBe(movimento.contaId);
    expect(depois.fonte).toBe("open_finance");
    expect(depois.idExterno).toBe("tx-1");
  });

  it("esconde do relatório sem apagar o Fato", async () => {
    const movimento = criarMovimento();
    repositorio.movimentos.set(movimento.id, movimento);

    const atualizado = await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: { ignoradoEmRelatorio: true },
    });

    expect(atualizado.ignoradoEmRelatorio).toBe(true);
    expect(repositorio.movimentos.has(movimento.id)).toBe(true);
  });

  it("marca como classificação do usuário quando a categoria muda sem origem", async () => {
    const categoriaNova = randomUUID();
    repositorio.cadastrarCategoria(categoriaNova, "Transporte");
    const movimento = criarMovimento({ classificadoPor: "ia" });
    repositorio.movimentos.set(movimento.id, movimento);

    const atualizado = await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: { categoriaId: categoriaNova },
    });

    expect(atualizado.classificadoPor).toBe("usuario");
    expect(atualizado.regraId).toBeNull();
  });

  it("preserva origem da classificação ao só esconder do relatório", async () => {
    const regraId = randomUUID();
    const movimento = criarMovimento({
      classificadoPor: "regra",
      regraId,
      classificadoEm: new Date("2026-08-01T12:00:00Z"),
    });
    repositorio.movimentos.set(movimento.id, movimento);

    const atualizado = await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: { ignoradoEmRelatorio: true },
    });

    expect(atualizado.classificadoPor).toBe("regra");
    expect(atualizado.regraId).toBe(regraId);
    expect(atualizado.ignoradoEmRelatorio).toBe(true);
  });

  it("registra a autoria de regra e de IA quando declarada", async () => {
    const movimento = criarMovimento();
    repositorio.movimentos.set(movimento.id, movimento);

    const atualizado = await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: { descricao: "Gasolina", classificadoPor: "ia", confiancaIa: 0.42 },
    });

    expect(atualizado.classificadoPor).toBe("ia");
    expect(atualizado.confiancaIa).toBe("0.420");
  });

  it("grava auditoria com estado anterior e posterior", async () => {
    const movimento = criarMovimento();
    repositorio.movimentos.set(movimento.id, movimento);

    await servico.atualizar({
      movimentoId: movimento.id,
      alteradoPor: usuarioId,
      conhecimento: { descricao: "Gasolina" },
    });

    expect(repositorio.auditorias).toHaveLength(1);
    const auditoria = repositorio.auditorias[0]!;
    expect(auditoria.tabela).toBe("movimento");
    expect(auditoria.acao).toBe("ALTERACAO");
    expect((auditoria.estadoAnterior as Movimento).descricao).toBe("PAG*POSTO IPIRANGA 4471");
    expect((auditoria.estadoAtual as Movimento).descricao).toBe("Gasolina");
  });

  it("recusa categoria inexistente", async () => {
    const movimento = criarMovimento();
    repositorio.movimentos.set(movimento.id, movimento);

    await expect(
      servico.atualizar({
        movimentoId: movimento.id,
        alteradoPor: usuarioId,
        conhecimento: { categoriaId: randomUUID() },
      }),
    ).rejects.toThrow(ErroConhecimentoInvalido);
  });

  it("recusa pessoa inexistente", async () => {
    const movimento = criarMovimento();
    repositorio.movimentos.set(movimento.id, movimento);

    await expect(
      servico.atualizar({
        movimentoId: movimento.id,
        alteradoPor: usuarioId,
        conhecimento: { pessoaId: randomUUID() },
      }),
    ).rejects.toThrow(ErroConhecimentoInvalido);
  });

  it("recusa movimentação inexistente", async () => {
    await expect(
      servico.atualizar({
        movimentoId: randomUUID(),
        alteradoPor: usuarioId,
        conhecimento: { descricao: "Gasolina" },
      }),
    ).rejects.toThrow(ErroMovimentoNaoEncontrado);
  });

  describe("aplicar_regras", () => {
    const categoriaNaoClassificado = randomUUID();
    const categoriaRestaurante = randomUUID();

    beforeEach(() => {
      repositorio.cadastrarCategoria(categoriaNaoClassificado, "Não classificado");
      repositorio.cadastrarCategoria(categoriaRestaurante, "Restaurantes");
    });

    /** Critério de pronto da F3: iFood classifica sem chamar modelo. */
    it("classifica IFOOD pela regra, sem IA", async () => {
      const movimento = criarMovimento({
        descricaoFonte: "IFOOD *LOOP RESTAURANTE",
        descricao: "IFOOD *LOOP RESTAURANTE",
        categoriaId: categoriaNaoClassificado,
        classificadoPor: "regra",
      });
      repositorio.movimentos.set(movimento.id, movimento);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaRestaurante));

      const resultado = await servico.aplicar_regras(movimento.id);

      expect(resultado.aplicada).toBe(true);
      if (!resultado.aplicada) return;
      expect(resultado.movimento.categoriaId).toBe(categoriaRestaurante);
      expect(resultado.movimento.classificadoPor).toBe("regra");
      expect(resultado.movimento.regraId).toBe(resultado.regraId);
      expect(resultado.movimento.classificadoEm).toBeInstanceOf(Date);
    });

    it("aplica regra de outro workspace remapeando a categoria pelo nome", async () => {
      const workspaceB = "00000000-0000-4000-8000-000000000099";
      const catNaoB = randomUUID();
      const catRestB = randomUUID();
      repositorio.cadastrarCategoria(catNaoB, "Não classificado", workspaceB);
      repositorio.cadastrarCategoria(catRestB, "Restaurantes", workspaceB);
      repositorio.workspacesPorUsuario.set(usuarioId, [WORKSPACE, workspaceB]);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaRestaurante));

      const movimentoB = criarMovimento({
        usuarioId,
        workspaceId: workspaceB,
        descricaoFonte: "IFOOD *LOOP",
        descricao: "IFOOD *LOOP",
        categoriaId: catNaoB,
        classificadoPor: "ia",
      });
      repositorio.movimentos.set(movimentoB.id, movimentoB);

      const resultado = await servico.aplicar_regras(movimentoB.id);

      expect(resultado.aplicada).toBe(true);
      if (!resultado.aplicada) return;
      expect(resultado.movimento.categoriaId).toBe(catRestB);
      expect(resultado.movimento.classificadoPor).toBe("regra");
    });

    it("reaplica existentes em todos os workspaces do usuário", async () => {
      const workspaceB = "00000000-0000-4000-8000-000000000098";
      const catNaoB = randomUUID();
      const catRestB = randomUUID();
      repositorio.cadastrarCategoria(catNaoB, "Não classificado", workspaceB);
      repositorio.cadastrarCategoria(catRestB, "Restaurantes", workspaceB);
      repositorio.workspacesPorUsuario.set(usuarioId, [WORKSPACE, workspaceB]);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "UBER", categoriaRestaurante));

      const movA = criarMovimento({
        usuarioId,
        descricaoFonte: "UBER TRIP",
        categoriaId: categoriaNaoClassificado,
        classificadoPor: "ia",
      });
      const movB = criarMovimento({
        usuarioId,
        workspaceId: workspaceB,
        descricaoFonte: "UBER TRIP",
        categoriaId: catNaoB,
        classificadoPor: "ia",
      });
      repositorio.movimentos.set(movA.id, movA);
      repositorio.movimentos.set(movB.id, movB);

      const { aplicadas } = await servico.aplicar_regras_existentes([WORKSPACE, workspaceB]);

      expect(aplicadas).toBe(2);
      expect(repositorio.movimentos.get(movA.id)?.categoriaId).toBe(categoriaRestaurante);
      expect(repositorio.movimentos.get(movB.id)?.categoriaId).toBe(catRestB);
    });

    it("não sobrescreve classificação feita à mão", async () => {
      const movimento = criarMovimento({
        descricaoFonte: "IFOOD *LOOP",
        categoriaId: categoriaNaoClassificado,
        classificadoPor: "usuario",
      });
      repositorio.movimentos.set(movimento.id, movimento);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaRestaurante));

      const resultado = await servico.aplicar_regras(movimento.id);

      expect(resultado).toEqual({ aplicada: false, motivo: "protegido_pelo_usuario" });
      expect(repositorio.movimentos.get(movimento.id)?.categoriaId).toBe(categoriaNaoClassificado);
      expect(repositorio.auditorias).toHaveLength(0);
    });

    it("pode sobrescrever sugestão da IA", async () => {
      const movimento = criarMovimento({
        descricaoFonte: "IFOOD *LOOP",
        categoriaId: categoriaNaoClassificado,
        classificadoPor: "ia",
        confiancaIa: "0.510",
      });
      repositorio.movimentos.set(movimento.id, movimento);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaRestaurante));

      const resultado = await servico.aplicar_regras(movimento.id);

      expect(resultado.aplicada).toBe(true);
      if (!resultado.aplicada) return;
      expect(resultado.movimento.classificadoPor).toBe("regra");
      expect(resultado.movimento.confiancaIa).toBeNull();
    });

    it("é idempotente: reaplicar não gera auditoria nova", async () => {
      const movimento = criarMovimento({
        descricaoFonte: "IFOOD *LOOP",
        categoriaId: categoriaNaoClassificado,
        classificadoPor: "regra",
      });
      repositorio.movimentos.set(movimento.id, movimento);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaRestaurante));

      await servico.aplicar_regras(movimento.id);
      const segunda = await servico.aplicar_regras(movimento.id);

      expect(segunda).toEqual({ aplicada: false, motivo: "ja_aplicada" });
      expect(repositorio.auditorias).toHaveLength(1);
    });

    it("prefere o trecho mais específico quando duas regras casam", async () => {
      const categoriaGenerica = randomUUID();
      const categoriaEspecifica = randomUUID();
      repositorio.cadastrarCategoria(categoriaGenerica, "Delivery");
      repositorio.cadastrarCategoria(categoriaEspecifica, "Loop");

      const movimento = criarMovimento({
        descricaoFonte: "IFOOD *LOOP RESTAURANTE",
        categoriaId: categoriaNaoClassificado,
        classificadoPor: "regra",
      });
      repositorio.movimentos.set(movimento.id, movimento);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaGenerica));
      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD *LOOP", categoriaEspecifica));

      const resultado = await servico.aplicar_regras(movimento.id);

      expect(resultado.aplicada).toBe(true);
      if (!resultado.aplicada) return;
      expect(resultado.movimento.categoriaId).toBe(categoriaEspecifica);
    });

    it("não faz nada quando nenhuma regra casa", async () => {
      const movimento = criarMovimento({
        descricaoFonte: "POSTO IPIRANGA",
        categoriaId: categoriaNaoClassificado,
        classificadoPor: "regra",
      });
      repositorio.movimentos.set(movimento.id, movimento);

      await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaRestaurante));

      const resultado = await servico.aplicar_regras(movimento.id);
      expect(resultado).toEqual({ aplicada: false, motivo: "nenhuma_casou" });
    });
  });
});

describe("aplicar_ia e classificar", () => {
  let repositorio: RepositorioEmMemoria;
  let servico: ServicoConhecimento;
  const categoriaNaoClassificado = randomUUID();
  const categoriaCombustivel = randomUUID();

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    servico = new ServicoConhecimento(repositorio);
    repositorio.cadastrarCategoria(categoriaNaoClassificado, "Não classificado");
    repositorio.cadastrarCategoria(categoriaCombustivel, "Combustível");
  });

  it("classifica pela IA com confianca_ia quando o sugeridor devolve categoria", async () => {
    const movimento = criarMovimento({
      descricaoFonte: "POSTO IPIRANGA 4471",
      categoriaId: categoriaNaoClassificado,
      classificadoPor: "regra",
    });
    repositorio.movimentos.set(movimento.id, movimento);

    const resultado = await servico.aplicar_ia(movimento.id, {
      async sugerir() {
        return { categoriaId: categoriaCombustivel, confianca: 0.81 };
      },
    });

    expect(resultado.aplicada).toBe(true);
    if (!resultado.aplicada) return;
    expect(resultado.movimento.categoriaId).toBe(categoriaCombustivel);
    expect(resultado.movimento.classificadoPor).toBe("ia");
    expect(resultado.movimento.confiancaIa).toBe("0.810");
    expect(resultado.confianca).toBe(0.81);
  });

  it("não chama sugeridor quando o usuário já classificou", async () => {
    const movimento = criarMovimento({
      categoriaId: categoriaNaoClassificado,
      classificadoPor: "usuario",
    });
    repositorio.movimentos.set(movimento.id, movimento);
    let chamado = 0;

    const resultado = await servico.aplicar_ia(movimento.id, {
      async sugerir() {
        chamado += 1;
        return { categoriaId: categoriaCombustivel, confianca: 0.9 };
      },
    });

    expect(resultado).toEqual({ aplicada: false, motivo: "protegido_pelo_usuario" });
    expect(chamado).toBe(0);
  });

  it("não gasta IA quando já há categoria real", async () => {
    const movimento = criarMovimento({
      categoriaId: categoriaCombustivel,
      classificadoPor: "ia",
      confiancaIa: "0.700",
    });
    repositorio.movimentos.set(movimento.id, movimento);
    let chamado = 0;

    const resultado = await servico.aplicar_ia(movimento.id, {
      async sugerir() {
        chamado += 1;
        return { categoriaId: categoriaCombustivel, confianca: 0.9 };
      },
    });

    expect(resultado).toEqual({ aplicada: false, motivo: "ja_classificado" });
    expect(chamado).toBe(0);
  });

  it("classificar usa regra e não chama IA quando casa", async () => {
    const movimento = criarMovimento({
      descricaoFonte: "IFOOD *LOOP",
      categoriaId: categoriaNaoClassificado,
      classificadoPor: "regra",
    });
    repositorio.movimentos.set(movimento.id, movimento);
    const categoriaRestaurante = randomUUID();
    repositorio.cadastrarCategoria(categoriaRestaurante, "Restaurantes");
    await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaRestaurante));
    let chamado = 0;

    const resultado = await servico.classificar(movimento.id, {
      async sugerir() {
        chamado += 1;
        return { categoriaId: categoriaCombustivel, confianca: 0.5 };
      },
    });

    expect(resultado.etapa).toBe("regra");
    expect(resultado.resultado.aplicada).toBe(true);
    expect(chamado).toBe(0);
    expect(repositorio.movimentos.get(movimento.id)?.categoriaId).toBe(categoriaRestaurante);
  });

  it("classificar cai na IA quando nenhuma regra casa", async () => {
    const movimento = criarMovimento({
      descricaoFonte: "POSTO SHELL",
      categoriaId: categoriaNaoClassificado,
      classificadoPor: "regra",
    });
    repositorio.movimentos.set(movimento.id, movimento);

    const resultado = await servico.classificar(movimento.id, {
      async sugerir() {
        return { categoriaId: categoriaCombustivel, confianca: 0.66 };
      },
    });

    expect(resultado.etapa).toBe("ia");
    expect(resultado.resultado.aplicada).toBe(true);
    expect(repositorio.movimentos.get(movimento.id)?.classificadoPor).toBe("ia");
  });

  it("recusa categoria fora da lista elegível", async () => {
    const movimento = criarMovimento({
      categoriaId: categoriaNaoClassificado,
      classificadoPor: "regra",
    });
    repositorio.movimentos.set(movimento.id, movimento);

    const resultado = await servico.aplicar_ia(movimento.id, {
      async sugerir() {
        return { categoriaId: randomUUID(), confianca: 0.9 };
      },
    });

    expect(resultado).toEqual({ aplicada: false, motivo: "categoria_invalida" });
  });
});

describe("propor_trecho_regra", () => {
  it("prefere o favorecido da instituição", () => {
    expect(
      propor_trecho_regra({
        descricao: "Almoço",
        descricaoFonte: "PAG*IFOOD LOOP",
        favorecidoFonte: "IFOOD",
      }),
    ).toBe("IFOOD");
  });

  it("pula ruído e pega o estabelecimento na descrição da fonte", () => {
    expect(
      propor_trecho_regra({
        descricao: "Compra",
        descricaoFonte: "PAG*IFOOD *LOOP",
        favorecidoFonte: null,
      }),
    ).toBe("IFOOD");
  });

  it("devolve null quando só há ruído", () => {
    expect(
      propor_trecho_regra({
        descricao: "Pix",
        descricaoFonte: "PAG PIX TED",
        favorecidoFonte: null,
      }),
    ).toBeNull();
  });
});

describe("criar_regra_a_partir_de_correcao", () => {
  let repositorio: RepositorioEmMemoria;
  let servico: ServicoConhecimento;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    servico = new ServicoConhecimento(repositorio);
  });

  it("cria regra com origem aprendizado_conversa a partir do IFOOD classificado", async () => {
    const categoriaId = randomUUID();
    repositorio.cadastrarCategoria(categoriaId, "Restaurantes");
    const movimento = criarMovimento({
      descricaoFonte: "IFOOD *LOOP RESTAURANTE",
      descricao: "Almoço",
      categoriaId,
      classificadoPor: "usuario",
    });
    repositorio.movimentos.set(movimento.id, movimento);

    const resultado = await servico.criar_regra_a_partir_de_correcao(movimento.id);

    expect(resultado.criada).toBe(true);
    if (!resultado.criada) return;
    expect(resultado.regra.origem).toBe("aprendizado_conversa");
    expect(resultado.regra.condicoes[0]).toMatchObject({
      campo: "descricao",
      operador: "contem",
      valor: "IFOOD",
    });
    expect(resultado.regra.categoriaId).toBe(categoriaId);
    expect(resultado.proposta.categoriaNome).toBe("Restaurantes");
  });

  it("é idempotente quando a regra já existe", async () => {
    const categoriaId = randomUUID();
    repositorio.cadastrarCategoria(categoriaId, "Restaurantes");
    const movimento = criarMovimento({
      descricaoFonte: "IFOOD *LOOP",
      categoriaId,
      classificadoPor: "usuario",
    });
    repositorio.movimentos.set(movimento.id, movimento);

    await servico.criar_regra_a_partir_de_correcao(movimento.id);
    const segunda = await servico.criar_regra_a_partir_de_correcao(movimento.id);

    expect(segunda.criada).toBe(false);
    if (segunda.criada) return;
    expect(segunda.motivo).toBe("ja_existe");
    expect(repositorio.regras).toHaveLength(1);
  });

  it("não oferece proposta quando a regra já existe", async () => {
    const categoriaId = randomUUID();
    repositorio.cadastrarCategoria(categoriaId, "Restaurantes");
    const movimento = criarMovimento({
      descricaoFonte: "IFOOD *LOOP",
      categoriaId,
      classificadoPor: "usuario",
    });
    repositorio.movimentos.set(movimento.id, movimento);

    await servico.criar_regra(entrada_regra_contem(WORKSPACE, "IFOOD", categoriaId));

    expect(await servico.propor_regra_de_movimento(movimento.id)).toBeNull();
  });
});

describe("regra_casa", () => {
  const movimentoBase = {
    valor: "10",
    dataMovimento: "2026-08-01",
    tipo: "despesa" as const,
    contaId: null,
    cartaoId: null,
  };

  it("casa na descrição da instituição mesmo com descrição do usuário diferente", () => {
    expect(
      regra_casa(
        {
          condicoes: [{ campo: "descricao", operador: "contem", valor: "ifoOd" }],
          logicaCondicoes: "ou",
          condicaoTipo: null,
          condicaoValor: null,
          acoes: [],
        },
        {
          ...movimentoBase,
          descricao: "Almoço",
          descricaoFonte: "IFOOD *LOOP",
          favorecidoFonte: null,
        },
      ),
    ).toBe(true);
  });

  it("casa no favorecido quando a descrição não traz o estabelecimento", () => {
    expect(
      regra_casa(
        {
          condicoes: [{ campo: "descricao", operador: "contem", valor: "UBER" }],
          logicaCondicoes: "ou",
          condicaoTipo: null,
          condicaoValor: null,
          acoes: [],
        },
        {
          ...movimentoBase,
          descricao: "Corrida",
          descricaoFonte: "PAGAMENTO",
          favorecidoFonte: "UBER TRIP",
        },
      ),
    ).toBe(true);
  });
});

describe("separar_correcao_por_grupo", () => {
  const movimentoId = randomUUID();
  const alteradoPor = randomUUID();

  it("divide uma correção mista nos dois destinos", () => {
    const { fato, conhecimento } = separar_correcao_por_grupo({
      movimentoId,
      alteradoPor,
      campos: { valor: 210, descricao: "Combustível", tags: ["carro"] },
    });

    expect(fato?.campos).toEqual({ valor: 210 });
    expect(conhecimento?.conhecimento).toEqual({ descricao: "Combustível", tags: ["carro"] });
  });

  it("devolve só o grupo que recebeu campos", () => {
    const somenteConhecimento = separar_correcao_por_grupo({
      movimentoId,
      alteradoPor,
      campos: { categoriaId: randomUUID() },
    });
    expect(somenteConhecimento.fato).toBeUndefined();
    expect(somenteConhecimento.conhecimento).toBeDefined();

    const somenteFato = separar_correcao_por_grupo({
      movimentoId,
      alteradoPor,
      campos: { valor: 10 },
    });
    expect(somenteFato.conhecimento).toBeUndefined();
    expect(somenteFato.fato).toBeDefined();
  });
});
