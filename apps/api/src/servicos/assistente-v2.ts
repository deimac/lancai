import { CATEGORIA_NAO_CLASSIFICADO, garantir_workspace_do_usuario, obter_banco } from "@lancai/banco";
import { RepositorioConhecimentoDrizzle, ServicoConhecimento } from "@lancai/conhecimento";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import {
  AssistenteCore,
  CommandExecutor,
  PolicyEngine,
  PostgresIdempotencyStore,
  ReferenceResolver,
  ReferenceResolverDepsDrizzle,
  ResponseGenerator,
  SemanticParserV2,
  SessionManager,
  SessionRepositoryDrizzle,
  StateUpdater,
  ApplicationService,
  financeiroDoCore,
  NoopAuditoria,
  mapearIntencaoParaUserRequest,
} from "@lancai/assistente";
import {
  InterpretadorIntencoes,
  OrquestradorIA,
  RepositorioContextoDrizzle,
  garantir_categorias_padrao,
  type ContextoInterpretacao,
} from "@lancai/ia";
import { ModuloRelatorios, RepositorioRelatoriosDrizzle } from "@lancai/relatorios";
import { hojeISO } from "@lancai/tipos";
import { criar_recorrencia } from "./recorrencia-servico";
import { consultar_assistente_v2 } from "./consultar-assistente-v2";
import { FEATURE_FLAGS } from "../config/feature-flags";
import { montar_resposta_menu } from "../montar-resposta-menu";

let singleton: AssistenteCore | null = null;

/**
 * Composition root do Assistente 2.0. Lazy para não exigir DB quando a flag está off.
 */
export function criarAssistenteCore(): AssistenteCore {
  const repositorioFin = new RepositorioFinanceiroDrizzle();
  const motor = new MotorFinanceiro(repositorioFin);
  const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
  const contextoRepo = new RepositorioContextoDrizzle();
  const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());
  const interpretador = new InterpretadorIntencoes(new OrquestradorIA());

  async function contextoDe(userId: string): Promise<ContextoInterpretacao> {
    const [contas, cartoes, categorias, pessoas] = await Promise.all([
      contextoRepo.listarContas(userId),
      contextoRepo.listarCartoes(userId),
      contextoRepo.listarCategorias(userId),
      contextoRepo.listarPessoas(userId),
    ]);
    return {
      dataAtual: hojeISO(),
      contas: contas.map((c) => ({ nome: c.nome, perfil: c.perfil })),
      cartoes: cartoes.map((c) => ({
        nome: c.nome,
        perfil: c.perfil,
        modalidade: c.modalidade,
        temConta: Boolean(c.contaId),
      })),
      categorias: categorias.map((c) => ({ nome: c.nome, tipo: c.tipo })),
      pessoas: pessoas.map((p) => ({ nome: p.nome, tipo: p.tipo })),
      habitos: [],
      historicoRecente: [],
    };
  }

  const application = new ApplicationService({
    financeiro: financeiroDoCore(motor, conhecimento, repositorioFin),
    catalogo: {
      workspaceId: async (usuarioId) => garantir_workspace_do_usuario(obter_banco(), usuarioId),
      categoriaNaoClassificado: async (usuarioId) => {
        await garantir_categorias_padrao(usuarioId, contextoRepo);
        const cat = await contextoRepo.buscarCategoriaPorNome(usuarioId, CATEGORIA_NAO_CLASSIFICADO);
        if (!cat) throw new Error("Categoria 'Não classificado' ausente");
        return cat.id;
      },
    },
    idempotency: new PostgresIdempotencyStore(),
    auditoria: new NoopAuditoria(),
    recorrencia: {
      criar: async (input) => {
        const r = await criar_recorrencia(input);
        return { id: r.id, descricao: r.descricao, diaDoMes: r.diaDoMes };
      },
    },
    regras: {
      criar: async (input) => {
        const r = await conhecimento.criar_regra({
          workspaceId: input.workspaceId,
          origem: "aprendizado_conversa",
          nome: `Regra ${input.merchant}`,
          condicoes: [{ campo: "descricao", operador: "contem", valor: input.merchant }],
          acoes: [{ tipo: "definir_categoria", categoriaId: input.categoriaId }],
        });
        return { id: r.id, nome: r.nome };
      },
    },
    consultas: {
      consultar: (spec, usuarioId, opcoes) => consultar_assistente_v2(relatorios, spec, usuarioId, opcoes),
    },
  });

  return new AssistenteCore(
    new SessionManager(new SessionRepositoryDrizzle()),
    new SemanticParserV2({
      contextoDe,
      llm: {
        parse: async (input) => {
          const intencao = await interpretador.interpretar_mensagem(input.mensagem, await contextoDe(input.userId));
          return mapearIntencaoParaUserRequest(intencao);
        },
      },
    }),
    new ReferenceResolver(new ReferenceResolverDepsDrizzle()),
    new PolicyEngine(),
    new CommandExecutor(application),
    new StateUpdater(),
    new ResponseGenerator(),
    FEATURE_FLAGS,
    () => undefined,
    async (usuarioId) => {
      const [contas, cartoes] = await Promise.all([
        contextoRepo.listarContas(usuarioId),
        contextoRepo.listarCartoes(usuarioId),
      ]);
      return montar_resposta_menu({ totalContas: contas.length, totalCartoes: cartoes.length });
    },
  );
}

export function obterAssistenteCore(): AssistenteCore {
  if (!singleton) singleton = criarAssistenteCore();
  return singleton;
}
