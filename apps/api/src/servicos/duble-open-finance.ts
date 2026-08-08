import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { ProvedorDuble, type MovimentacaoExterna, type ResumoIngestao } from "@lancai/open-finance";
import { enriquecer_apos_ingestao } from "./pos-ingestao-open-finance";
import {
  obter_provedor_open_finance,
  obter_servico_conexao,
  obter_servico_ingestao,
} from "./open-finance";

export function obter_provedor_duble(): ProvedorDuble | null {
  const provedor = obter_provedor_open_finance();
  return provedor instanceof ProvedorDuble ? provedor : null;
}

const AMOSTRAS: Omit<MovimentacaoExterna, "idExterno" | "contaExternaId">[] = [
  {
    ocorridoEm: dias_atras(1),
    valor: 42.9,
    tipo: "despesa",
    descricaoFonte: "COMPRA CARTAO MERCADO CENTRAL",
    statusFonte: "confirmado",
  },
  {
    ocorridoEm: dias_atras(2),
    valor: 18.5,
    tipo: "despesa",
    descricaoFonte: "UBER *TRIP",
    statusFonte: "confirmado",
  },
  {
    ocorridoEm: dias_atras(3),
    valor: 2500,
    tipo: "receita",
    descricaoFonte: "TED SALARIO EMPRESA XYZ",
    statusFonte: "confirmado",
  },
];

function dias_atras(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Cria uma conexão de mentira com uma conta externa pronta para associar.
 * Só existe quando `OPEN_FINANCE_PROVEDOR=duble`.
 */
export async function criar_conexao_duble(entrada: {
  workspaceId: string;
  usuarioId: string;
}) {
  const provedor = obter_provedor_duble();
  const conexao = obter_servico_conexao();
  if (!provedor || !conexao) {
    throw new ErroDubleIndisponivel();
  }

  const conexaoExterna = `duble-${randomUUID()}`;
  const contaExternaId = `acc-${randomUUID()}`;

  provedor.registrarContas(conexaoExterna, [
    { idExterno: contaExternaId, nome: "Conta Corrente Mentira", tipo: "BANK" },
  ]);

  return conexao.registrar_conexao({
    workspaceId: entrada.workspaceId,
    usuarioId: entrada.usuarioId,
    conexaoExterna,
  });
}

/**
 * Seméia movimentações no dublê, anuncia o lote e roda o mesmo pós-processo
 * do webhook (conciliação, classificação, alerta de orçamento).
 */
export async function sincronizar_conexao_duble(entrada: {
  conexaoId: string;
  workspaceId: string;
  log: FastifyBaseLogger;
  movimentos?: Array<{
    valor: number;
    tipo: "receita" | "despesa";
    descricaoFonte: string;
    ocorridoEm: string;
  }>;
}): Promise<ResumoIngestao & { eventoId: string }> {
  const provedor = obter_provedor_duble();
  const conexaoSvc = obter_servico_conexao();
  const ingestao = obter_servico_ingestao();
  if (!provedor || !conexaoSvc || !ingestao) {
    throw new ErroDubleIndisponivel();
  }

  const detalhe = await conexaoSvc.detalhar(entrada.conexaoId);
  if (detalhe.conexao.workspaceId !== entrada.workspaceId) {
    throw new ErroConexaoDubleNaoEncontrada(entrada.conexaoId);
  }

  const contas = detalhe.contas.filter((c) => c.contaId || c.cartaoId);
  if (contas.length === 0) {
    throw new ErroDubleSemAssociacao();
  }

  const lote: MovimentacaoExterna[] = [];
  for (const conta of contas) {
    const base =
      entrada.movimentos?.map((m) => ({
        ...m,
        statusFonte: "confirmado" as const,
      })) ?? AMOSTRAS;

    for (const amostra of base) {
      lote.push({
        ...amostra,
        idExterno: `tx-${randomUUID()}`,
        contaExternaId: conta.contaExternaId,
      });
    }
  }

  const conexaoExterna = detalhe.conexao.idExterno;
  provedor.semear(conexaoExterna, lote);

  const eventoId = `ev-${randomUUID()}`;
  const corpo = provedor.anunciar_lote(conexaoExterna, eventoId);
  const { novo, interpretado } = await ingestao.receber(corpo);

  if (!novo) {
    return {
      eventoId,
      criados: 0,
      duplicados: 0,
      atualizados: 0,
      removidos: 0,
      semDestino: 0,
      paginas: 0,
      movimentoIdsCriados: [],
    };
  }

  const resumo = await ingestao.processar(interpretado);
  await enriquecer_apos_ingestao({ eventoId, resumo, log: entrada.log });

  return { eventoId, ...resumo };
}

export class ErroDubleIndisponivel extends Error {
  constructor() {
    super("O dublê só responde quando OPEN_FINANCE_PROVEDOR=duble.");
    this.name = "ErroDubleIndisponivel";
  }
}

export class ErroConexaoDubleNaoEncontrada extends Error {
  constructor(id: string) {
    super(`conexão não encontrada: ${id}`);
    this.name = "ErroConexaoDubleNaoEncontrada";
  }
}

export class ErroDubleSemAssociacao extends Error {
  constructor() {
    super("Associe pelo menos uma conta do banco a uma conta ou cartão local antes de sincronizar.");
    this.name = "ErroDubleSemAssociacao";
  }
}
