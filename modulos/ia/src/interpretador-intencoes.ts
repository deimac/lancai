import type { IntencaoDetectada } from "@lancai/tipos";
import { z } from "zod";
import { modelo_classificar_do_ambiente, type OrquestradorIA } from "./orquestrador-ia";
import { normalizar_intencao_cadastro } from "./normalizar-intencao-cadastro";
import { normalizar_intencao_movimento } from "./normalizar-intencao-movimento";
import { normalizar_intencao_plasticos } from "./normalizar-intencao-plasticos";
import type { ContextoInterpretacao } from "./prompt";
import {
  montar_prompt_classificar,
  montar_prompt_extrair,
  montar_prompt_sistema,
  montar_prompt_sistema_classificar,
} from "./prompt";
import {
  mensagem_parece_resposta_slot,
  ramo_de_intencao_pendente,
  schemaClassificacaoRamo,
  schema_por_ramo,
  type RamoIntencao,
} from "./ramos-intencao";

export type { ContextoInterpretacao } from "./prompt";

const CACHE_CLASSIFICAR_TTL_MS = 45_000;
const cacheClassificar = new Map<string, { ramo: RamoIntencao; expiraEm: number }>();

function chave_cache_classificar(mensagem: string, contexto: ContextoInterpretacao): string {
  return `${contexto.dataAtual}|${mensagem.trim().toLocaleLowerCase("pt-BR")}`;
}

function ler_cache_classificar(chave: string): RamoIntencao | null {
  const item = cacheClassificar.get(chave);
  if (!item) return null;
  if (Date.now() > item.expiraEm) {
    cacheClassificar.delete(chave);
    return null;
  }
  return item.ramo;
}

function gravar_cache_classificar(chave: string, ramo: RamoIntencao): void {
  cacheClassificar.set(chave, { ramo, expiraEm: Date.now() + CACHE_CLASSIFICAR_TTL_MS });
}

/** Expõe reset do cache (testes). */
export function resetar_cache_classificacao_intencoes(): void {
  cacheClassificar.clear();
}

/**
 * Transforma mensagem em `IntencaoDetectada` em 2 estágios (classificar → extrair)
 * para reduzir tokens do JSON Schema e caber no TPM do Groq.
 */
export class InterpretadorIntencoes {
  constructor(private readonly orquestrador: OrquestradorIA) {}

  async interpretar_mensagem(
    mensagem: string,
    contexto: ContextoInterpretacao,
  ): Promise<IntencaoDetectada> {
    const ramo = await this.obter_ramo(mensagem, contexto);
    console.info(`[ia] ramo=${ramo} llm=true`);

    const schemaExtracao = schema_por_ramo(ramo);
    const resultado = await this.orquestrador.gerar_objeto_estruturado<{
      intencao_detectada: IntencaoDetectada;
    }>({
      schema: schemaExtracao as z.ZodType<{ intencao_detectada: IntencaoDetectada }, z.ZodTypeDef, any>,
      system: montar_prompt_sistema(),
      prompt: montar_prompt_extrair(mensagem, contexto, ramo),
      estagio: "extrair",
    });

    const aposMovimento = normalizar_intencao_movimento(resultado.intencao_detectada, contexto, mensagem);
    const aposCadastro = normalizar_intencao_cadastro(aposMovimento, contexto, mensagem);
    return normalizar_intencao_plasticos(aposCadastro, mensagem);
  }

  private async obter_ramo(mensagem: string, contexto: ContextoInterpretacao): Promise<RamoIntencao> {
    const pendente = contexto.intencaoPendente?.intencao_pendente;
    if (pendente && mensagem_parece_resposta_slot(mensagem)) {
      const ramo = ramo_de_intencao_pendente(pendente);
      console.info(`[ia] classificar pulado (slot-filling → ${ramo})`);
      return ramo;
    }

    const chave = chave_cache_classificar(mensagem, contexto);
    const cached = ler_cache_classificar(chave);
    if (cached) {
      console.info(`[ia] classificar cache hit → ${cached}`);
      return cached;
    }

    const classificado = await this.orquestrador.gerar_objeto_estruturado({
      schema: schemaClassificacaoRamo,
      system: montar_prompt_sistema_classificar(),
      prompt: montar_prompt_classificar(mensagem, contexto),
      modeloOverride: modelo_classificar_do_ambiente("groq"),
      estagio: "classificar",
    });

    gravar_cache_classificar(chave, classificado.ramo);
    const tokensApprox = Math.ceil((mensagem.length + 200) / 4);
    console.info(`[ia] classificar ok ramo=${classificado.ramo} tokens_approx~${tokensApprox}`);
    return classificado.ramo;
  }
}
