/**
 * Invalidação do cockpit por escopo — evita que criar uma regra recarregue Contas.
 * O layout guarda um contador por escopo; cada tela depende só do que lê.
 */

export const ESCOPOS_DADOS = [
  "dashboard",
  "contas",
  "cartoes",
  "categorias",
  "regras",
  "extrato",
  "conexoes",
] as const;

export type EscopoDados = (typeof ESCOPOS_DADOS)[number];

export type VersoesDados = Record<EscopoDados, number>;

export type AlvoInvalidacao = EscopoDados | "tudo";

export function versao_inicial(): VersoesDados {
  return {
    dashboard: 0,
    contas: 0,
    cartoes: 0,
    categorias: 0,
    regras: 0,
    extrato: 0,
    conexoes: 0,
  };
}

export function avancar(versoes: VersoesDados, ...alvos: AlvoInvalidacao[]): VersoesDados {
  if (alvos.length === 0) return versoes;

  const proxima = { ...versoes };
  const tudo = alvos.includes("tudo");
  for (const escopo of ESCOPOS_DADOS) {
    if (tudo || alvos.includes(escopo)) {
      proxima[escopo] += 1;
    }
  }
  return proxima;
}

/** Soma estável para deps de useEffect — só muda quando um dos escopos avança. */
export function chave_dependencia(versoes: VersoesDados | undefined, ...escopos: EscopoDados[]): number {
  if (!versoes) return 0;
  return escopos.reduce((acc, escopo) => acc + versoes[escopo], 0);
}
