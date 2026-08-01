import {
  adicionarMeses,
  calcularDataVencimentoFatura,
  dividirEmParcelas,
  paraDataISO,
} from "@lancai/tipos";

export interface ParcelaCalculada {
  numeroParcela: number;
  valor: number;
  dataMovimento: string;
}

/**
 * Divide uma compra no cartão em N parcelas, respeitando o fechamento/vencimento
 * do cartão para calcular a data da primeira fatura. As parcelas seguintes
 * caem sempre um mês depois da anterior, no mesmo dia de vencimento.
 * Função pura — não lê nem escreve no banco.
 */
export function registrar_parcelamento(
  valorTotal: number,
  quantidadeParcelas: number,
  dataCompra: Date,
  cartao: { fechamento: number; vencimento: number },
): ParcelaCalculada[] {
  const valoresParcelas = dividirEmParcelas(valorTotal, quantidadeParcelas);
  const dataPrimeiraParcela = calcularDataVencimentoFatura(
    dataCompra,
    cartao.fechamento,
    cartao.vencimento,
  );

  return valoresParcelas.map((valor, indice) => ({
    numeroParcela: indice + 1,
    valor,
    dataMovimento: paraDataISO(indice === 0 ? dataPrimeiraParcela : adicionarMeses(dataPrimeiraParcela, indice)),
  }));
}
