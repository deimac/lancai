/**
 * Porta do fallback de classificação (09-REGRAS §9.1 passo 2).
 * A implementação com LLM mora em `modulos/ia`; Conhecimento só recebe a
 * sugestão — módulos periféricos não se importam (08-CONTRATOS §3).
 */
export interface EntradaSugestaoCategoria {
  descricao: string;
  descricaoFonte: string;
  favorecidoFonte: string | null;
  tipo: string;
  categorias: Array<{ id: string; nome: string }>;
}

export interface SugestaoCategoria {
  categoriaId: string;
  /** Entre 0 e 1 — gravado em `confianca_ia`. */
  confianca: number;
}

export interface SugeridorCategoria {
  sugerir(entrada: EntradaSugestaoCategoria): Promise<SugestaoCategoria | null>;
}
