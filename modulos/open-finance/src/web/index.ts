import { abrir_widget_pluggy } from "./pluggy";
import type { LancadorDeWidget, PedidoDeConexao, WidgetAberto } from "./widget";

export type { PedidoDeConexao, WidgetAberto };

/**
 * Entrada de navegador do módulo, separada de `../index` de propósito: aquela
 * exporta repositório Drizzle e serviços, que não têm o que fazer num bundle de
 * frontend. Aqui só entra o que a tela precisa.
 */

/**
 * Abre o widget do provedor ativo. A tela passa o identificador que recebeu de
 * `GET /open-finance/fonte` e não precisa saber qual provedor é — mesma divisão
 * de `criar_provedor_open_finance` do lado do servidor.
 *
 * Provedor sem widget não é erro de programação, é configuração: o dublê existe
 * justamente para rodar sem provedor real, e a tela precisa saber disso para
 * explicar em vez de quebrar.
 */
export async function abrir_widget_conexao(
  provedor: string,
  pedido: PedidoDeConexao,
): Promise<WidgetAberto> {
  const lancador = CATALOGO[provedor];
  if (!lancador) {
    throw new ErroWidgetIndisponivel(provedor);
  }
  return lancador(pedido);
}

/** Se o provedor ativo tem widget. A tela usa para decidir o que oferecer. */
export function provedor_tem_widget(provedor: string): boolean {
  return provedor in CATALOGO;
}

export class ErroWidgetIndisponivel extends Error {
  constructor(provedor: string) {
    super(`A fonte ativa (${provedor}) não tem tela de conexão para abrir no navegador.`);
    this.name = "ErroWidgetIndisponivel";
  }
}

/**
 * O dublê não aparece aqui, e isso é o que se quer: ele existe para o servidor
 * provar o fluxo de ingestão sem provedor real, e não tem instituição de
 * verdade para o usuário escolher numa tela.
 */
const CATALOGO: Record<string, LancadorDeWidget> = {
  pluggy: abrir_widget_pluggy,
};
