import type { FastifyInstance } from "fastify";
import { inArray } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  obter_banco,
} from "@lancai/banco";
import { listar_recorrencias } from "../servicos/recorrencia-servico";
import { montar_comprometimento } from "../servicos/comprometimento-servico";
import { perfil_de_tipo_gasto_dashboard } from "../servicos/montar-dashboard";
import { hojeISO } from "@lancai/tipos";

export async function registrar_rotas_recorrencia(app: FastifyInstance) {
  app.get("/", async (requisicao, resposta) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    if (!usuarioId) {
      return resposta.status(400).send({ erro: "usuarioId é obrigatório." });
    }
    const lista = await listar_recorrencias(usuarioId);
    const banco = obter_banco();
    const categoriaIds = [...new Set(lista.map((item) => item.categoriaId))];
    const contaIds = [...new Set(lista.map((item) => item.contaId).filter(Boolean))] as string[];
    const cartaoIds = [...new Set(lista.map((item) => item.cartaoId).filter(Boolean))] as string[];

    const [categorias, contas, cartoes] = await Promise.all([
      categoriaIds.length
        ? banco
            .select({ id: categoriaTabela.id, nome: categoriaTabela.nome, icone: categoriaTabela.icone, cor: categoriaTabela.cor })
            .from(categoriaTabela)
            .where(inArray(categoriaTabela.id, categoriaIds))
        : [],
      contaIds.length
        ? banco
            .select({ id: contaTabela.id, nome: contaTabela.nome })
            .from(contaTabela)
            .where(inArray(contaTabela.id, contaIds))
        : [],
      cartaoIds.length
        ? banco
            .select({ id: cartaoTabela.id, nome: cartaoTabela.nome })
            .from(cartaoTabela)
            .where(inArray(cartaoTabela.id, cartaoIds))
        : [],
    ]);

    const mapaCat = new Map(categorias.map((item) => [item.id, item]));
    const mapaConta = new Map(contas.map((item) => [item.id, item.nome]));
    const mapaCartao = new Map(cartoes.map((item) => [item.id, item.nome]));

    return lista.map((item) => {
      const cat = mapaCat.get(item.categoriaId);
      return {
        id: item.id,
        descricao: item.descricao,
        valor: Number(item.valor),
        tipo: item.tipo,
        diaDoMes: item.diaDoMes,
        categoriaId: item.categoriaId,
        categoriaNome: cat?.nome ?? null,
        icone: cat?.icone ?? "geral",
        cor: cat?.cor ?? "neutro",
        contaNome: item.contaId ? (mapaConta.get(item.contaId) ?? null) : null,
        cartaoNome: item.cartaoId ? (mapaCartao.get(item.cartaoId) ?? null) : null,
      };
    });
  });

  app.get("/parcelamentos", async (requisicao, resposta) => {
    const { usuarioId, data, tipoGasto } = requisicao.query as {
      usuarioId?: string;
      data?: string;
      tipoGasto?: string;
    };
    if (!usuarioId) {
      return resposta.status(400).send({ erro: "usuarioId é obrigatório." });
    }
    return montar_comprometimento(
      usuarioId,
      data ?? hojeISO(),
      perfil_de_tipo_gasto_dashboard(tipoGasto),
    );
  });
}
