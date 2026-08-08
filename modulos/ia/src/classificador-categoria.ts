import { z } from "zod";
import {
  modelo_classificar_do_ambiente,
  type OrquestradorIA,
} from "./orquestrador-ia";

export interface EntradaClassificarCategoria {
  descricao: string;
  descricaoFonte: string;
  favorecidoFonte: string | null;
  tipo: string;
  categorias: Array<{ id: string; nome: string }>;
}

export interface ResultadoClassificarCategoria {
  categoriaId: string;
  confianca: number;
}

const schemaSugestao = z.object({
  categoria_nome: z.string().min(1),
  confianca: z.number().min(0).max(1),
});

/**
 * Fallback de classificação por LLM (10-IA §10). Só propõe nome da lista;
 * quem grava é o Conhecimento no composition root.
 *
 * A forma bate com `SugeridorCategoria` de `@lancai/conhecimento` por tipagem
 * estrutural — este módulo não importa Conhecimento.
 */
export class ClassificadorCategoria {
  constructor(private readonly orquestrador: OrquestradorIA) {}

  async sugerir(
    entrada: EntradaClassificarCategoria,
  ): Promise<ResultadoClassificarCategoria | null> {
    if (entrada.categorias.length === 0) return null;

    const lista = entrada.categorias.map((categoria) => categoria.nome).join(", ");
    const favorecido = entrada.favorecidoFonte?.trim() || "(não informado)";

    const bruto = await this.orquestrador.gerar_objeto_estruturado({
      schema: schemaSugestao,
      estagio: "classificar_categoria",
      modeloOverride: modelo_classificar_do_ambiente(),
      system: [
        "Você classifica lançamentos financeiros em categorias.",
        "Escolha EXATAMENTE um nome da lista fornecida — não invente categorias.",
        "confianca é um número entre 0 e 1 (1 = certeza).",
        "Responda só o JSON pedido.",
      ].join(" "),
      prompt: [
        `Tipo: ${entrada.tipo}`,
        `Descrição no extrato: ${entrada.descricaoFonte}`,
        `Favorecido: ${favorecido}`,
        `Descrição no LançAI: ${entrada.descricao}`,
        `Categorias permitidas: ${lista}`,
        'Devolva {"categoria_nome":"...","confianca":0.0}',
      ].join("\n"),
    });

    const nome = bruto.categoria_nome.trim().toLocaleLowerCase("pt-BR");
    const escolhida = entrada.categorias.find(
      (categoria) => categoria.nome.toLocaleLowerCase("pt-BR") === nome,
    );
    if (!escolhida) return null;

    return { categoriaId: escolhida.id, confianca: bruto.confianca };
  }
}

/** Desliga o fallback de IA sem afetar regras determinísticas. */
export function classificacao_ia_habilitada(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const bruto = (env.CLASSIFICACAO_IA_HABILITADA ?? "true").trim().toLowerCase();
  return bruto !== "false" && bruto !== "0" && bruto !== "off" && bruto !== "no";
}
