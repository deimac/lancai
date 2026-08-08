/**
 * Textos de observabilidade do sync (13-OPEN_FINANCE §7): atraso desde o
 * último sucesso e aviso quando a conexão ativa parece parada.
 *
 * Limiar 36h: em produção a Pluggy sincroniza a cada 8–24h; passar disso sem
 * sync sugere falha silenciosa ou sandbox sem auto-sync.
 */
export const HORAS_SYNC_ATRASADO = 36;

export type EstadoAtrasoSync =
  | { nivel: "nunca" }
  | { nivel: "ok"; relativo: string; horas: number }
  | { nivel: "atrasado"; relativo: string; horas: number };

export function avaliar_atraso_sync(
  ultimoSyncEm: string | null,
  agora: Date = new Date(),
): EstadoAtrasoSync {
  if (!ultimoSyncEm) return { nivel: "nunca" };

  const quando = new Date(ultimoSyncEm);
  if (Number.isNaN(quando.getTime())) return { nivel: "nunca" };

  const ms = Math.max(0, agora.getTime() - quando.getTime());
  const horas = ms / (60 * 60 * 1000);
  const relativo = formatar_relativo(ms);

  if (horas >= HORAS_SYNC_ATRASADO) {
    return { nivel: "atrasado", relativo, horas };
  }
  return { nivel: "ok", relativo, horas };
}

/** Uma linha legível: "Último sync: 08 ago, 09:10 · há 2 h". */
export function texto_ultimo_sync(
  ultimoSyncEm: string | null,
  agora: Date = new Date(),
): { linha: string; atrasado: boolean } {
  const atraso = avaliar_atraso_sync(ultimoSyncEm, agora);

  if (atraso.nivel === "nunca") {
    return { linha: "Último sync: nunca", atrasado: false };
  }

  const absoluto = formatar_absoluto(ultimoSyncEm!);
  if (atraso.nivel === "atrasado") {
    return {
      linha: `Último sync: ${absoluto} · há ${atraso.relativo} (atrasado)`,
      atrasado: true,
    };
  }

  return {
    linha: `Último sync: ${absoluto} · há ${atraso.relativo}`,
    atrasado: false,
  };
}

export function texto_ultimo_lote(resumo: {
  criados: number;
  duplicados: number;
  atualizados: number;
  removidos: number;
  semDestino: number;
} | null): string | null {
  if (!resumo) return null;

  const partes: string[] = [];
  if (resumo.criados > 0) {
    partes.push(`${resumo.criados} ${resumo.criados === 1 ? "novo" : "novos"}`);
  }
  if (resumo.duplicados > 0) {
    partes.push(
      `${resumo.duplicados} ${resumo.duplicados === 1 ? "duplicata" : "duplicatas"}`,
    );
  }
  if (resumo.atualizados > 0) {
    partes.push(
      `${resumo.atualizados} ${resumo.atualizados === 1 ? "atualizado" : "atualizados"}`,
    );
  }
  if (resumo.removidos > 0) {
    partes.push(
      `${resumo.removidos} ${resumo.removidos === 1 ? "removido" : "removidos"}`,
    );
  }
  if (resumo.semDestino > 0) {
    partes.push(`${resumo.semDestino} sem conta associada`);
  }

  if (partes.length === 0) return "Último lote: sem mudanças";
  return `Último lote: ${partes.join(" · ")}`;
}

export function texto_consentimento(expiraEm: string | null, agora: Date = new Date()): string | null {
  if (!expiraEm) return null;
  const quando = new Date(expiraEm);
  if (Number.isNaN(quando.getTime())) return null;

  const ms = quando.getTime() - agora.getTime();
  if (ms <= 0) return "Consentimento expirado — reconecte o banco";

  const dias = ms / (24 * 60 * 60 * 1000);
  if (dias <= 14) {
    return `Consentimento expira em ${formatar_relativo(ms)}`;
  }
  return null;
}

function formatar_absoluto(iso: string): string {
  const data = new Date(iso);
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatar_relativo(ms: number): string {
  const minutos = Math.floor(ms / (60 * 1000));
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h`;

  const dias = Math.floor(horas / 24);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}
