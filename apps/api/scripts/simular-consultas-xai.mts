/**
 * Simula consultas do Xai V3 na base real: LLM + relatórios Drizzle,
 * sessão só em memória. Não grava chat nem cria/apaga movimento.
 *
 *   pnpm --filter @lancai/api exec tsx scripts/simular-consultas-xai.mts
 */
import "../src/ambiente.ts";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { CATEGORIA_NAO_CLASSIFICADO, obter_banco, usuario as usuarioTabela } from "@lancai/banco";
import { RepositorioConhecimentoDrizzle, ServicoConhecimento } from "@lancai/conhecimento";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import {
  ApplicationService,
  AssistenteCoreV3,
  CommandExecutor,
  DialogueActExtractor,
  MemoryIdempotencyStore,
  NoopAuditoria,
  PolicyEngine,
  ReferenceResolverDepsDrizzle,
  ReferenceResolverV3,
  ResponseGenerator,
  SessionManagerV3,
  SessionRepositoryMemory,
  financeiroDoCore,
  type ExtracaoTurnoV3,
} from "@lancai/assistente";
import {
  OrquestradorIA,
  RepositorioContextoDrizzle,
  garantir_categorias_padrao,
  resetar_circuitos_provedores,
} from "@lancai/ia";
import { ModuloRelatorios, RepositorioRelatoriosDrizzle } from "@lancai/relatorios";
import { hojeISO, type DialogueAct, type QueryState } from "@lancai/tipos";
import { consultar_assistente_v2 } from "../src/servicos/consultar-assistente-v2.ts";
import { primeiroNomeDoUsuario } from "../src/servicos/primeiro-nome-usuario.ts";
import { CORPUS_CONSULTAS_XAI } from "./corpus-consultas-xai.ts";

const ESCRITA = new Set(["write", "update", "delete"]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, "../../..");

export type Veredito = "ok" | "suspeita" | "falhou";

export type TurnoRelatorio = {
  n: number;
  mensagem: string;
  act: DialogueAct | null;
  query: Partial<QueryState> | null;
  resposta: string;
  diagnostico?: Record<string, unknown>;
  veredito: Veredito;
  motivos: string[];
  ms: number;
  tentouEscrever: boolean;
  erro?: string;
};

export type ConversaRelatorio = {
  id: string;
  categoria: string;
  titulo: string;
  sessaoId: string;
  turnos: TurnoRelatorio[];
};

export type RelatorioSimulacao = {
  geradoEm: string;
  dataAtual: string;
  usuario: { id: string; primeiroNome?: string };
  totais: { conversas: number; turnos: number; ok: number; suspeita: number; falhou: number };
  conversas: ConversaRelatorio[];
};

function recusarEscrita(): never {
  throw new Error("eval: escrita bloqueada");
}

function enxugarQuery(query: QueryState | null | undefined): Partial<QueryState> | null {
  if (!query) return null;
  const {
    contaId: _c,
    cartaoId: _k,
    categoriaId: _g,
    pessoaId: _p,
    ...visivel
  } = query;
  return visivel;
}

function mensagemCitaPeriodo(mensagem: string): boolean {
  return /\b(hoje|ontem|anteontem|s[aá]bado|domingo|segunda|ter[cç]a|quarta|quinta|sexta|m[eê]s|semana|ano|agosto|julho|junho|maio|abril|mar[cç]o|janeiro|fevereiro|setembro|outubro|novembro|dezembro|\d{1,2}\/\d{1,2})\b/i.test(
    mensagem,
  );
}

export function julgarTurno(entrada: {
  mensagem: string;
  resposta: string;
  act: DialogueAct | null;
  query: Partial<QueryState> | null;
  tentouEscrever: boolean;
  erro?: string;
}): { veredito: Veredito; motivos: string[] } {
  const motivos: string[] = [];
  const msg = entrada.mensagem.toLocaleLowerCase("pt-BR");
  const resp = entrada.resposta.toLocaleLowerCase("pt-BR");
  const query = entrada.query;
  const pedeEntrada = /\b(me enviou|recebi|entradas?|entrou|ganhei|maior entrada|menor entrada)\b/.test(msg);
  const pedeSaida = /\b(enviei|gastei|gastos?|sa[ií]das?|paguei|comprei)\b/.test(msg);

  if (entrada.erro) motivos.push(`erro: ${entrada.erro}`);
  if (entrada.tentouEscrever) motivos.push("LLM tentou write/update/delete");
  if (/problema interno/.test(resp)) motivos.push("LLM indisponível (timeout/circuito)");
  if (!entrada.act && /problema interno/.test(resp)) motivos.push("sem DialogueAct");
  if (/dados inv[aá]lidos/.test(resp)) motivos.push("resposta Dados inválidos");
  if (/r\$\s*0,00 de sa[ií]das/.test(resp) && /em \d+\s+lançamento/.test(resp)) {
    motivos.push("R$ 0,00 de saídas com lançamentos encontrados");
  }
  if (/\bme enviou\b/.test(msg) && /de sa[ií]das/.test(resp)) {
    motivos.push("perguntou quem enviou e a resposta falou saídas");
  }
  if (/\bme enviou\b/.test(msg) && query?.merchant && /^pix$/i.test(String(query.merchant))) {
    motivos.push("merchant=pix em pergunta de quem enviou");
  }
  if (pedeEntrada && !pedeSaida && query?.tipos?.length === 1 && query.tipos[0] === "despesa") {
    motivos.push("tipos=despesa em pergunta de entrada");
  }
  if (/\bme enviou\b/.test(msg) && !mensagemCitaPeriodo(msg) && /de 1 de agosto a /.test(resp)) {
    motivos.push("inventou o mês de agosto sem período na pergunta");
  }
  if (/\bmaior\b/.test(msg) && query?.grain === "summary") {
    motivos.push("grain=summary para pedido de extremo");
  }
  if (/\b[uú]ltimos?\b/.test(msg) && query?.grain === "top") {
    motivos.push("grain=top para últimos N");
  }
  if (/n[aã]o entendi/.test(resp)) motivos.push("não entendeu o pedido");

  const falhou = motivos.some(
    (m) =>
      m.startsWith("erro:") ||
      m.includes("tentou write") ||
      m.includes("Dados inválidos") ||
      m.includes("R$ 0,00") ||
      m.includes("saídas") ||
      m.includes("merchant=pix") ||
      m.includes("inventou o mês") ||
      m.includes("LLM indisponível") ||
      m.includes("sem DialogueAct"),
  );
  if (falhou) return { veredito: "falhou", motivos };
  if (motivos.length > 0) return { veredito: "suspeita", motivos };
  return { veredito: "ok", motivos: [] };
}

async function resolverUsuario(): Promise<{ id: string; nome: string }> {
  const forçado = process.env.LANCAI_EVAL_USER_ID?.trim();
  const banco = obter_banco();
  if (forçado) {
    const [linha] = await banco
      .select({ id: usuarioTabela.id, nome: usuarioTabela.nome })
      .from(usuarioTabela)
      .where(eq(usuarioTabela.id, forçado))
      .limit(1);
    if (!linha) throw new Error(`LANCAI_EVAL_USER_ID não encontrado`);
    return linha;
  }
  const linhas = await banco
    .select({ id: usuarioTabela.id, nome: usuarioTabela.nome })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.ativo, true));
  if (linhas.length === 0) throw new Error("Nenhum usuário ativo no banco");
  if (linhas.length === 1) return linhas[0]!;
  const deividy = linhas.find((u) => /deividy/i.test(u.nome));
  if (deividy) return deividy;
  throw new Error(
    `Há ${linhas.length} usuários. Defina LANCAI_EVAL_USER_ID. Nomes: ${linhas.map((u) => u.nome).join(", ")}`,
  );
}

function montarCoreEval(historicoPorSessao: Map<string, Array<{ papel: "usuario" | "sistema"; conteudo: string }>>) {
  const ultimoAct: { atual: DialogueAct | null } = { atual: null };
  const tentouEscrever: { atual: boolean } = { atual: false };

  const repoSessao = new SessionRepositoryMemory();
  const manager = new SessionManagerV3(repoSessao);
  const contextoRepo = new RepositorioContextoDrizzle();
  const repositorioFin = new RepositorioFinanceiroDrizzle();
  const motor = new MotorFinanceiro(repositorioFin);
  const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
  const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());
  const financeiroReal = financeiroDoCore(motor, conhecimento, repositorioFin);

  const application = new ApplicationService({
    financeiro: {
      criarMovimento: recusarEscrita,
      corrigirFato: recusarEscrita,
      atualizarConhecimento: recusarEscrita,
      obterMovimento: (id) => financeiroReal.obterMovimento(id),
      obterConta: (id) => financeiroReal.obterConta(id),
    },
    catalogo: {
      workspaceId: async () => {
        throw new Error("eval: workspace não deve ser pedido em consulta");
      },
      categoriaNaoClassificado: async (usuarioId) => {
        await garantir_categorias_padrao(usuarioId, contextoRepo);
        const cat = await contextoRepo.buscarCategoriaPorNome(usuarioId, CATEGORIA_NAO_CLASSIFICADO);
        if (!cat) throw new Error("Categoria 'Não classificado' ausente");
        return cat.id;
      },
    },
    idempotency: new MemoryIdempotencyStore(),
    auditoria: new NoopAuditoria(),
    recorrencia: { criar: recusarEscrita },
    regras: { criar: recusarEscrita },
    consultas: {
      consultar: (spec, usuarioId, opcoes) => consultar_assistente_v2(relatorios, spec, usuarioId, opcoes),
    },
  });

  const actExtractor = new DialogueActExtractor(new OrquestradorIA());

  const core = new AssistenteCoreV3(
    manager,
    {
      extract: async (input): Promise<ExtracaoTurnoV3> => {
        const act = await actExtractor.extract(input);
        ultimoAct.atual = act;
        if (ESCRITA.has(act.act)) {
          tentouEscrever.atual = true;
          return { act: { act: "diagnose", suspicion: "query" } };
        }
        tentouEscrever.atual = false;
        return { act };
      },
    },
    new ReferenceResolverV3(new ReferenceResolverDepsDrizzle()),
    new PolicyEngine(),
    new CommandExecutor(application),
    new ResponseGenerator(),
    {
      buscarContaPorNome: async (usuarioId, nome) => {
        const conta = await contextoRepo.buscarContaPorNome(usuarioId, nome);
        return conta ? { id: conta.id, nome: conta.nome, sincronizada: conta.sincronizada } : null;
      },
      buscarCartaoPorNome: async (usuarioId, nome) => {
        const cartao = await contextoRepo.buscarCartaoPorNome(usuarioId, nome);
        return cartao ? { id: cartao.id, nome: cartao.nome, sincronizada: cartao.sincronizada } : null;
      },
    },
    {
      carregarHistorico: async (sessaoId) => historicoPorSessao.get(sessaoId) ?? [],
    },
  );

  return { core, repoSessao, ultimoAct, tentouEscrever };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function llmFalhou(saida: { resposta: string; diagnostico?: Record<string, unknown> }): boolean {
  if (/problema interno/i.test(saida.resposta)) return true;
  const reason = String(saida.diagnostico?.reason ?? "");
  return /provedores de ia|circuito aberto|timeout|aborted/i.test(reason);
}

async function main() {
  process.env.LLM_FALLBACK_GEMINI = "true";
  resetar_circuitos_provedores();
  const usuario = await resolverUsuario();
  const primeiroNome = await primeiroNomeDoUsuario(usuario.id);
  const dataAtual = hojeISO();
  const historicoPorSessao = new Map<string, Array<{ papel: "usuario" | "sistema"; conteudo: string }>>();
  const { core, repoSessao, ultimoAct, tentouEscrever } = montarCoreEval(historicoPorSessao);

  const conversas: ConversaRelatorio[] = [];
  console.log(`Simulação Xai · ${dataAtual} · usuário ${primeiroNome ?? usuario.nome} · ${CORPUS_CONSULTAS_XAI.length} conversas`);

  for (const caso of CORPUS_CONSULTAS_XAI) {
    let sessaoId: string | undefined;
    const turnos: TurnoRelatorio[] = [];
    console.log(`\n[${caso.id}] ${caso.titulo}`);

    for (let i = 0; i < caso.mensagens.length; i += 1) {
      const mensagem = caso.mensagens[i]!;
      ultimoAct.atual = null;
      tentouEscrever.atual = false;
      const t0 = Date.now();
      let resposta = "";
      let diagnostico: Record<string, unknown> | undefined;
      let erro: string | undefined;
      const maxTentativas = 3;
      for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
        ultimoAct.atual = null;
        tentouEscrever.atual = false;
        try {
          const saida = await core.processar({
            usuarioId: usuario.id,
            mensagem,
            sessaoId,
            canal: "web",
            primeiroNome,
          });
          sessaoId = saida.sessaoId;
          resposta = saida.resposta;
          diagnostico = saida.diagnostico;
          if (tentouEscrever.atual) {
            resposta = `[eval] escrita bloqueada. O LLM emitiu ${ultimoAct.atual?.act ?? "write"}.`;
            break;
          }
          if (!llmFalhou(saida)) {
            erro = undefined;
            break;
          }
          erro = String(saida.diagnostico?.reason ?? "LLM falhou");
          if (tentativa < maxTentativas) {
            console.log(`    retry ${tentativa}/${maxTentativas - 1} após falha de LLM…`);
            resetar_circuitos_provedores();
            await sleep(8000);
          }
        } catch (e) {
          erro = e instanceof Error ? e.message : String(e);
          resposta = `[eval] falhou: ${erro}`;
          if (tentativa < maxTentativas) {
            resetar_circuitos_provedores();
            await sleep(8000);
          }
        }
      }
      const ms = Date.now() - t0;
      await sleep(1500);
      const doc = sessaoId ? await repoSessao.getDocumento(sessaoId) : null;
      const query = enxugarQuery(doc?.documento.query as QueryState | undefined);
      const julgamento = julgarTurno({
        mensagem,
        resposta,
        act: ultimoAct.atual,
        query,
        tentouEscrever: tentouEscrever.atual,
        erro,
      });

      if (sessaoId) {
        const hist = historicoPorSessao.get(sessaoId) ?? [];
        hist.push({ papel: "usuario", conteudo: mensagem });
        hist.push({ papel: "sistema", conteudo: resposta });
        historicoPorSessao.set(sessaoId, hist.slice(-16));
      }

      turnos.push({
        n: i + 1,
        mensagem,
        act: ultimoAct.atual,
        query,
        resposta,
        diagnostico,
        veredito: julgamento.veredito,
        motivos: julgamento.motivos,
        ms,
        tentouEscrever: tentouEscrever.atual,
        erro,
      });
      console.log(`  ${i + 1}. ${julgamento.veredito} · ${mensagem.slice(0, 60)} (${ms}ms)`);
    }

    conversas.push({
      id: caso.id,
      categoria: caso.categoria,
      titulo: caso.titulo,
      sessaoId: sessaoId ?? "",
      turnos,
    });
  }

  const todos = conversas.flatMap((c) => c.turnos);
  const relatorio: RelatorioSimulacao = {
    geradoEm: new Date().toISOString(),
    dataAtual,
    usuario: { id: usuario.id, primeiroNome },
    totais: {
      conversas: conversas.length,
      turnos: todos.length,
      ok: todos.filter((t) => t.veredito === "ok").length,
      suspeita: todos.filter((t) => t.veredito === "suspeita").length,
      falhou: todos.filter((t) => t.veredito === "falhou").length,
    },
    conversas,
  };

  const pasta = path.join(RAIZ, ".tmp-analise/simulacao-xai");
  await mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, `relatorio-${dataAtual}.json`);
  await writeFile(arquivo, JSON.stringify(relatorio, null, 2), "utf8");
  console.log(`\nGravado ${arquivo}`);
  console.log(
    `Totais: ${relatorio.totais.ok} ok · ${relatorio.totais.suspeita} suspeita · ${relatorio.totais.falhou} falhou / ${relatorio.totais.turnos} turnos`,
  );
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
