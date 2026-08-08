import { AdaptadorPluggy } from "./pluggy/adaptador";
import type { ProvedorOpenFinance } from "./provedor";
import { ProvedorDuble } from "./provedor-duble";

/**
 * O catálogo de adaptadores mora aqui, e não em `apps/api`, porque saber quais
 * provedores existem é conhecimento deste módulo. Montar do lado de fora
 * obrigaria a aplicação a nomear cada provedor e a conhecer suas variáveis de
 * ambiente — exatamente o espalhamento que o [ADR-011](docs/adr/011-open-finance-isolado.md)
 * proíbe e que `isolamento-do-provedor.test.ts` detecta.
 *
 * Nome vazio devolve nulo, e é assim que a Fonte fica desligada por padrão.
 * Nome que não existe, ou credencial faltando, **falha**: uma Fonte que finge
 * estar conectada ao banco é pior do que uma Fonte desligada.
 */
export function criar_provedor_open_finance(
  nome: string | undefined | null,
): ProvedorOpenFinance | null {
  const escolhido = nome?.trim();
  if (!escolhido) return null;

  const construtor = CATALOGO[escolhido];
  if (!construtor) {
    throw new Error(`Provedor de Open Finance "${escolhido}" não tem adaptador implementado.`);
  }

  return construtor();
}

/** Nomes aceitos em `OPEN_FINANCE_PROVEDOR`, para mensagem de erro e diagnóstico. */
export function provedores_disponiveis(): string[] {
  return Object.keys(CATALOGO);
}

function exigir(variavel: string): string {
  const valor = process.env[variavel]?.trim();
  if (!valor) throw new Error(`${variavel} é obrigatória para este provedor de Open Finance.`);
  return valor;
}

const CATALOGO: Record<string, () => ProvedorOpenFinance> = {
  /** Provedor de mentira, em memória. Só sobe se alguém pedir pelo nome. */
  duble: () => new ProvedorDuble(),

  pluggy: () =>
    new AdaptadorPluggy({
      clientId: exigir("PLUGGY_CLIENT_ID"),
      clientSecret: exigir("PLUGGY_CLIENT_SECRET"),
      /**
       * Repassada ao provedor na criação do token, o que amarra os eventos ao
       * item recém-criado sem depender de configuração no painel dele.
       */
      webhookUrl: process.env.OPEN_FINANCE_WEBHOOK_URL?.trim(),
    }),
};
