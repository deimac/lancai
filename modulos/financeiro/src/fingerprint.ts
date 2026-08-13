import { createHash } from "node:crypto";

/**
 * Hash determinístico da identidade financeira + dados da transação.
 * Usado para reidentificar Fato Open Finance quando o `idExterno` muda
 * (reatachar / novo itemId Pluggy). Não é único: duas compras iguais no
 * mesmo dia compartilham o fingerprint e são desambiguadas na ingestão.
 */
export function calcular_fingerprint_movimento(entrada: {
  identidadeId: string;
  dataMovimento: string;
  tipo: string;
  valor: number;
  descricaoFonte?: string | null;
  favorecidoFonte?: string | null;
}): string {
  const valorCentavos = Math.round(Number(entrada.valor) * 100);
  const dataStr = String(entrada.dataMovimento).slice(0, 10);
  const descNorm = normalizar_descricao_fingerprint(
    entrada.descricaoFonte,
    entrada.favorecidoFonte,
  );
  const partes = [entrada.identidadeId, dataStr, entrada.tipo, String(valorCentavos), descNorm].join(
    "|",
  );
  return createHash("sha256").update(partes).digest("hex").slice(0, 16);
}

export function normalizar_descricao_fingerprint(
  descricao?: string | null,
  favorecido?: string | null,
): string {
  const partes = [descricao, favorecido].filter(Boolean).join(" ");
  return partes
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
