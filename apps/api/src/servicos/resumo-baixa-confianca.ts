import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  CATEGORIA_NAO_CLASSIFICADO,
  categoria,
  movimento,
  obter_banco,
  usuario,
} from "@lancai/banco";
import { Memoria, RepositorioMemoriaDrizzle } from "@lancai/conhecimento";
import { EvolutionService } from "@lancai/evolution";
import { formatarMoeda, hojeISO, LIMIAR_BAIXA_CONFIANCA } from "@lancai/tipos";

const CHAVE_HABITO = "resumo_baixa_confianca_dia";
const MAX_ITENS_MENSAGEM = 8;

export type ItemRevisaoWhatsApp = {
  id: string;
  descricao: string;
  valor: string;
  dataMovimento: string;
  categoriaNome: string;
  classificadoPor: "regra" | "ia" | "usuario";
  confiancaIa: number | null;
};

export type UsuarioComRevisao = {
  usuarioId: string;
  nome: string;
  whatsappNumero: string;
  itens: ItemRevisaoWhatsApp[];
};

export type ResultadoResumoBaixaConfianca = {
  dia: string;
  usuariosComFila: number;
  enviados: number;
  puladosIdempotencia: number;
  falhas: number;
  detalhes: Array<{
    usuarioId: string;
    quantidade: number;
    status: "enviado" | "pulado" | "falha" | "dry_run";
    erro?: string;
  }>;
};

type EnviarWhatsApp = (entrada: { numero: string; texto: string }) => Promise<unknown>;

function para_confianca(valor: string | null): number | null {
  if (valor === null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function formatar_data(valor: string): string {
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  if (!ano || !mes || !dia) return String(valor);
  return `${dia}/${mes}`;
}

function motivo_revisao(item: ItemRevisaoWhatsApp): string {
  if (
    item.categoriaNome.toLocaleLowerCase("pt-BR") ===
    CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR")
  ) {
    return "sem categoria";
  }
  if (item.classificadoPor === "ia" && item.confiancaIa !== null) {
    return `IA ${Math.round(item.confiancaIa * 100)}%`;
  }
  return "revisar";
}

/** Texto do resumo diário — sem LLM. */
export function montar_texto_resumo_baixa_confianca(
  nome: string,
  itens: ItemRevisaoWhatsApp[],
): string {
  const primeiroNome = nome.trim().split(/\s+/)[0] || "olá";
  const cabeca =
    itens.length === 1
      ? `${primeiroNome}, você tem 1 lançamento para revisar:`
      : `${primeiroNome}, você tem ${itens.length} lançamentos para revisar:`;

  const visiveis = itens.slice(0, MAX_ITENS_MENSAGEM);
  const linhas = visiveis.map((item, i) => {
    const valor = formatarMoeda(Number(item.valor));
    return `${i + 1}. ${item.descricao} · ${valor} · ${formatar_data(item.dataMovimento)} · ${motivo_revisao(item)}`;
  });

  const resto = itens.length - visiveis.length;
  if (resto > 0) {
    linhas.push(`… e mais ${resto}.`);
  }

  return [
    cabeca,
    "",
    ...linhas,
    "",
    'Responda aqui (ex.: "classifica o ifood como Alimentação") ou abra Extrato → Revisar no app.',
  ].join("\n");
}

export async function listar_filas_baixa_confianca(): Promise<UsuarioComRevisao[]> {
  const banco = obter_banco();
  const limiar = LIMIAR_BAIXA_CONFIANCA.toFixed(3);
  const nomeNaoClassificado = CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR");

  const linhas = await banco
    .select({
      usuarioId: usuario.id,
      nome: usuario.nome,
      whatsappNumero: usuario.whatsappNumero,
      id: movimento.id,
      descricao: movimento.descricao,
      valor: movimento.valor,
      dataMovimento: movimento.dataMovimento,
      categoriaNome: categoria.nome,
      classificadoPor: movimento.classificadoPor,
      confiancaIa: movimento.confiancaIa,
    })
    .from(movimento)
    .innerJoin(categoria, eq(movimento.categoriaId, categoria.id))
    .innerJoin(usuario, eq(movimento.usuarioId, usuario.id))
    .where(
      and(
        eq(usuario.ativo, true),
        isNotNull(usuario.whatsappNumero),
        ne(movimento.status, "cancelado"),
        or(
          sql`lower(${categoria.nome}) = ${nomeNaoClassificado}`,
          and(
            eq(movimento.classificadoPor, "ia"),
            sql`${movimento.confiancaIa} is not null`,
            sql`${movimento.confiancaIa}::numeric < ${limiar}::numeric`,
          ),
        ),
      ),
    )
    .orderBy(
      desc(movimento.dataMovimento),
      sql`${movimento.ocorridoEmInstante} DESC NULLS LAST`,
    );

  const porUsuario = new Map<string, UsuarioComRevisao>();
  for (const linha of linhas) {
    if (!linha.whatsappNumero) continue;
    let bucket = porUsuario.get(linha.usuarioId);
    if (!bucket) {
      bucket = {
        usuarioId: linha.usuarioId,
        nome: linha.nome,
        whatsappNumero: linha.whatsappNumero,
        itens: [],
      };
      porUsuario.set(linha.usuarioId, bucket);
    }
    bucket.itens.push({
      id: linha.id,
      descricao: linha.descricao,
      valor: linha.valor,
      dataMovimento: String(linha.dataMovimento).slice(0, 10),
      categoriaNome: linha.categoriaNome,
      classificadoPor: linha.classificadoPor,
      confiancaIa: para_confianca(linha.confiancaIa),
    });
  }

  return [...porUsuario.values()];
}

/**
 * Envia resumo diário de baixa confiança / não classificado via WhatsApp.
 * Idempotente por dia e usuário (hábito `resumo_baixa_confianca_dia`).
 */
export async function enviar_resumos_baixa_confianca(opcoes?: {
  dryRun?: boolean;
  dia?: string;
  enviar?: EnviarWhatsApp;
  memoria?: Memoria;
  /** Injeta filas (testes); se omitido, consulta o banco. */
  filas?: UsuarioComRevisao[];
}): Promise<ResultadoResumoBaixaConfianca> {
  const dia = opcoes?.dia ?? hojeISO();
  const dryRun = opcoes?.dryRun === true;
  const memoria = opcoes?.memoria ?? new Memoria(new RepositorioMemoriaDrizzle());
  const enviar =
    opcoes?.enviar ??
    ((entrada) => new EvolutionService().enviarMensagemWhatsApp(entrada));

  const filas = opcoes?.filas ?? (await listar_filas_baixa_confianca());
  const resultado: ResultadoResumoBaixaConfianca = {
    dia,
    usuariosComFila: filas.length,
    enviados: 0,
    puladosIdempotencia: 0,
    falhas: 0,
    detalhes: [],
  };

  for (const fila of filas) {
    const jaEnviado = await memoria.buscar_habito(fila.usuarioId, CHAVE_HABITO);
    if (jaEnviado === dia) {
      resultado.puladosIdempotencia += 1;
      resultado.detalhes.push({
        usuarioId: fila.usuarioId,
        quantidade: fila.itens.length,
        status: "pulado",
      });
      continue;
    }

    const texto = montar_texto_resumo_baixa_confianca(fila.nome, fila.itens);

    if (dryRun) {
      resultado.detalhes.push({
        usuarioId: fila.usuarioId,
        quantidade: fila.itens.length,
        status: "dry_run",
      });
      continue;
    }

    try {
      await enviar({ numero: fila.whatsappNumero, texto });
      await memoria.salvar_habito(fila.usuarioId, CHAVE_HABITO, dia);
      resultado.enviados += 1;
      resultado.detalhes.push({
        usuarioId: fila.usuarioId,
        quantidade: fila.itens.length,
        status: "enviado",
      });
    } catch (erro) {
      resultado.falhas += 1;
      resultado.detalhes.push({
        usuarioId: fila.usuarioId,
        quantidade: fila.itens.length,
        status: "falha",
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return resultado;
}
