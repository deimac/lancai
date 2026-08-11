/**
 * Lock em memória por conexão — evita cruzar cron GET com “Atualizar agora”
 * na mesma instância. Sem Redis (ADR-014): uma réplica Coolify basta.
 */
const emAndamento = new Set<string>();

export function tentar_adquirir_lock_sync(conexaoId: string): boolean {
  if (emAndamento.has(conexaoId)) return false;
  emAndamento.add(conexaoId);
  return true;
}

export function liberar_lock_sync(conexaoId: string): void {
  emAndamento.delete(conexaoId);
}

export function sync_em_andamento(conexaoId: string): boolean {
  return emAndamento.has(conexaoId);
}
