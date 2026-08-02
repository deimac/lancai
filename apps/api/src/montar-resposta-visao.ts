import { formatarMoeda } from "@lancai/tipos";
import type { ResultadoVisao } from "@lancai/relatorios";

function rotuloPerfil(perfil: "pf" | "pj"): string {
  return perfil === "pj" ? "empresa" : "pessoal";
}

function formatarData(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Formata o resultado estruturado do `ModuloRelatorios` (Fase 5) no texto que
 * o usuário vê no chat. Mesma separação usada em `montar_resposta_chat`: o
 * módulo de domínio devolve dados, a camada de API formata a mensagem.
 */
export function montar_resposta_visao(resultado: ResultadoVisao): string {
  switch (resultado.tipo) {
    case "saldos": {
      const { contas, totalGeral } = resultado.dados;
      if (contas.length === 0) return "Você ainda não tem nenhuma conta cadastrada.";
      if (contas.length === 1) {
        const [conta] = contas;
        return `Você tem ${formatarMoeda(conta!.saldoAtual)} na conta "${conta!.nome}".`;
      }
      const linhas = contas.map((conta) => `- ${conta.nome} (${rotuloPerfil(conta.perfil)}): ${formatarMoeda(conta.saldoAtual)}`);
      return `${linhas.join("\n")}\n\nTotal: ${formatarMoeda(totalGeral)}`;
    }

    case "cartoes": {
      const { cartoes } = resultado.dados;
      if (cartoes.length === 0) return "Você ainda não tem nenhum cartão cadastrado.";
      const linhas = cartoes.map(
        (cartao) =>
          `- ${cartao.nome} (${rotuloPerfil(cartao.perfil)}): limite ${formatarMoeda(cartao.limite)}, comprometido ${formatarMoeda(
            cartao.comprometido,
          )}, disponível ${formatarMoeda(cartao.disponivel)} (fecha dia ${cartao.fechamento}, vence dia ${cartao.vencimento})`,
      );
      return linhas.join("\n");
    }

    case "parcelamentos": {
      const { compras } = resultado.dados;
      if (compras.length === 0) return "Você não tem nenhuma compra parcelada em aberto.";
      const linhas = compras.map((compra) => {
        const proxima = compra.proximaParcelaData ? ` (próxima em ${formatarData(compra.proximaParcelaData)})` : "";
        return `- "${compra.descricao}" no ${compra.cartaoNome}: faltam ${compra.parcelasRestantes}/${compra.parcelasTotais} parcelas, ${formatarMoeda(compra.valorRestante)} restantes${proxima}`;
      });
      return linhas.join("\n");
    }

    case "categoria": {
      const { categoriaNome, totalDespesas, totalReceitas, ranking } = resultado.dados;

      if (categoriaNome) {
        const partes = [`Em "${categoriaNome}", você gastou ${formatarMoeda(totalDespesas)}.`];
        if (totalReceitas > 0) partes.push(`Recebeu ${formatarMoeda(totalReceitas)} nessa categoria.`);
        return partes.join(" ");
      }

      if (ranking.length === 0) return "Não encontrei nenhuma despesa no período para montar um ranking de categorias.";
      const linhas = ranking.map((item, indice) => `${indice + 1}. ${item.categoriaNome}: ${formatarMoeda(item.total)}`);
      return `Suas categorias com mais gasto no período:\n${linhas.join("\n")}\n\nTotal de despesas: ${formatarMoeda(totalDespesas)}.`;
    }

    case "futuro": {
      const { periodo, totalComprometido, itens } = resultado.dados;
      if (itens.length === 0) return `Você não tem nenhum compromisso previsto até ${formatarData(periodo.ate)}.`;
      return `Você tem ${formatarMoeda(totalComprometido)} comprometidos até ${formatarData(periodo.ate)}, em ${itens.length} lançamento(s) futuro(s).`;
    }

    case "fluxo": {
      const { totalPessoalComEmpresa, totalEmpresaComPessoal, itens } = resultado.dados;
      if (itens.length === 0) return "Não encontrei nenhum gasto cruzado entre pessoa física e empresa no período.";

      const partes: string[] = [];
      if (totalPessoalComEmpresa > 0) {
        partes.push(`Você gastou ${formatarMoeda(totalPessoalComEmpresa)} de pessoal usando dinheiro da empresa.`);
      }
      if (totalEmpresaComPessoal > 0) {
        partes.push(`A empresa gastou ${formatarMoeda(totalEmpresaComPessoal)} usando seu dinheiro pessoal — a empresa te deve esse valor.`);
      }
      return partes.join(" ");
    }

    case "evolucao": {
      const { meses } = resultado.dados;
      const linhas = meses.map((mes) => `- ${mes.mes}: recebeu ${formatarMoeda(mes.receitas)}, gastou ${formatarMoeda(mes.despesas)} (saldo do mês: ${formatarMoeda(mes.saldoLiquido)})`);
      return linhas.join("\n");
    }
  }
}
