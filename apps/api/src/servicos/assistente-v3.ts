import { and, desc, eq, inArray } from "drizzle-orm";
import { CATEGORIA_NAO_CLASSIFICADO, chat as chatTabela, garantir_workspace_do_usuario, obter_banco } from "@lancai/banco";
import { RepositorioConhecimentoDrizzle, ServicoConhecimento } from "@lancai/conhecimento";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import {
  AssistenteCoreV3,
  CommandExecutor,
  DialogueActExtractor,
  PolicyEngine,
  PostgresIdempotencyStore,
  ReferenceResolverDepsDrizzle,
  ReferenceResolverV3,
  ResponseGenerator,
  SessionManagerV3,
  SessionRepositoryDrizzle,
  ApplicationService,
  financeiroDoCore,
  NoopAuditoria,
  type TurnoUnderstanding,
} from "@lancai/assistente";
import { OrquestradorIA, RepositorioContextoDrizzle, garantir_categorias_padrao } from "@lancai/ia";
import { ModuloRelatorios, RepositorioRelatoriosDrizzle } from "@lancai/relatorios";
import { criar_recorrencia } from "./recorrencia-servico";
import { consultar_assistente_v2 } from "./consultar-assistente-v2";

const HISTORICO_MAX = 8;

let singleton: AssistenteCoreV3 | null = null;

async function carregarHistoricoUnderstanding(sessaoId: string): Promise<TurnoUnderstanding[]> {
  const banco = obter_banco();
  const mensagens = await banco
    .select({ papel: chatTabela.papel, conteudo: chatTabela.conteudo })
    .from(chatTabela)
    .where(and(eq(chatTabela.sessaoId, sessaoId), inArray(chatTabela.papel, ["usuario", "sistema"])))
    .orderBy(desc(chatTabela.dataCriacao))
    .limit(HISTORICO_MAX);

  return mensagens.reverse().map((m) => ({
    papel: m.papel === "sistema" ? "sistema" : "usuario",
    conteudo: m.conteudo,
  }));
}

function montarApplicationService(): ApplicationService {
  const repositorioFin = new RepositorioFinanceiroDrizzle();
  const motor = new MotorFinanceiro(repositorioFin);
  const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
  const contextoRepo = new RepositorioContextoDrizzle();
  const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());

  return new ApplicationService({
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
}

/**
 * Composition root do AssistenteCore V3. Lazy para não exigir DB quando a flag está off.
 */
export function criarAssistenteCoreV3(): AssistenteCoreV3 {
  const contextoRepo = new RepositorioContextoDrizzle();
  const application = montarApplicationService();
  const actExtractor = new DialogueActExtractor(new OrquestradorIA());

  return new AssistenteCoreV3(
    new SessionManagerV3(new SessionRepositoryDrizzle()),
    {
      extract: async (input) => ({ act: await actExtractor.extract(input) }),
    },
    new ReferenceResolverV3(new ReferenceResolverDepsDrizzle()),
    new PolicyEngine(),
    new CommandExecutor(application),
    new ResponseGenerator(),
    {
      buscarContaPorNome: async (usuarioId, nome) => {
        const conta = await contextoRepo.buscarContaPorNome(usuarioId, nome);
        return conta ? { id: conta.id, nome: conta.nome } : null;
      },
      buscarCartaoPorNome: async (usuarioId, nome) => {
        const cartao = await contextoRepo.buscarCartaoPorNome(usuarioId, nome);
        return cartao ? { id: cartao.id, nome: cartao.nome } : null;
      },
    },
    { carregarHistorico: carregarHistoricoUnderstanding },
  );
}

export function obterAssistenteCoreV3(): AssistenteCoreV3 {
  if (!singleton) singleton = criarAssistenteCoreV3();
  return singleton;
}
