import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Building2, PenLine, Search } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type CategoriaResumo,
  type ContaResumo,
  type MovimentoResumo,
} from "../lib/api";
import type { Perfil } from "@lancai/tipos";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Campo } from "../componentes/ui/Campo";
import { Cartao } from "../componentes/ui/Cartao";
import { Paginador } from "../componentes/Paginador";
import { mes_de_hoje, normalizar_mes, SeletorMes } from "../componentes/SeletorMes";
import { useContextoLayout } from "../layout/useContextoLayout";
import {
  eh_nao_classificado,
  precisa_revisao,
  explicacao_classificacao,
  rotulo_classificado_por,
} from "../lib/fila-revisao";
import {
  classificacao_da_query,
  fila_da_query,
  filtrar_extrato,
  nome_origem_movimento,
  origem_da_query,
  origem_para_query,
  paginar,
  tamanho_pagina_da_query,
  tipo_gasto_da_query,
  tipo_gasto_para_query,
  TAMANHO_PAGINA_PADRAO,
  type ClassificacaoExtrato,
  type FilaExtrato,
  type OrigemExtrato,
  type TipoGastoExtrato,
} from "../lib/filtrar-extrato";
import { unir_classes } from "../lib/unir-classes";

function formatar_data(valor: string): string {
  const [ano, mes, dia] = valor.split("-");
  if (!ano || !mes || !dia) return valor;
  return `${dia}/${mes}/${ano}`;
}

function formatar_moeda_br(valor: number | string): string {
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (Number.isNaN(numero)) return String(valor);
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatar_valor(tipo: string, valor: string): string {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return valor;
  const absoluto = formatar_moeda_br(numero);
  if (tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte") {
    return `+ ${absoluto}`;
  }
  if (tipo === "despesa" || tipo === "retirada") {
    return `− ${absoluto}`;
  }
  return absoluto;
}

function formatar_mes_competencia(dataISO: string): string {
  const [ano, mes] = dataISO.split("-");
  if (!ano || !mes) return dataISO;
  const rotulos = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  const indice = Number(mes) - 1;
  return `${rotulos[indice] ?? mes}/${ano.slice(2)}`;
}

type ParcelasIrmasResposta = Awaited<ReturnType<typeof clienteApi.listar_parcelas_irmas>>;

function cor_valor(tipo: string, status: MovimentoResumo["status"]): string {
  if (status === "cancelado") return "text-texto-suave line-through";
  if (tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte") {
    return "text-primaria";
  }
  if (tipo === "despesa" || tipo === "retirada") return "text-texto";
  return "text-texto-suave";
}

const CLASSE_SELECT =
  "rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria disabled:opacity-60";

function perfil_origem_movimento(
  movimento: Pick<MovimentoResumo, "contaId" | "cartaoId">,
  contas: ContaResumo[],
  cartoes: CartaoResumo[],
): Perfil | null {
  if (movimento.contaId) {
    return contas.find((c) => c.id === movimento.contaId)?.perfil ?? null;
  }
  if (movimento.cartaoId) {
    return cartoes.find((c) => c.id === movimento.cartaoId)?.perfil ?? null;
  }
  return null;
}

function rotulo_tipo_gasto(tipo: Perfil | null | undefined): string {
  if (tipo === "pj") return "Empresa";
  if (tipo === "pf") return "Pessoal";
  return "";
}

export function TelaExtrato() {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const contexto = useContextoLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const mes = normalizar_mes(searchParams.get("mes"), mes_de_hoje());
  const filtro = fila_da_query(searchParams.get("fila") ?? searchParams.get("filtro"));
  const busca = searchParams.get("q") ?? "";
  const categoriaId = searchParams.get("categoria");
  const classificacao = classificacao_da_query(searchParams.get("classificacao"));
  const origem = origem_da_query(searchParams.get("origem"));
  const tipoGasto = tipo_gasto_da_query(searchParams.get("tipoGasto"));
  const porPagina = tamanho_pagina_da_query(searchParams.get("porPagina"));
  const [pagina, setPagina] = useState(1);
  const [movimentos, setMovimentos] = useState<MovimentoResumo[]>([]);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [visaoGeral, setVisaoGeral] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [parcelasExpandidasId, setParcelasExpandidasId] = useState<string | null>(null);
  const [parcelasPorMovimento, setParcelasPorMovimento] = useState<
    Record<string, ParcelasIrmasResposta>
  >({});
  const [carregandoParcelasId, setCarregandoParcelasId] = useState<string | null>(null);
  const depsDados = chave_dependencia(
    contexto?.versoes,
    "extrato",
    "categorias",
    "contas",
    "cartoes",
  );

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [
        movimentosCarregados,
        contasCarregadas,
        cartoesCarregados,
        categoriasCarregadas,
        workspaces,
      ] = await Promise.all([
        clienteApi.listar_movimentos(usuario.id),
        clienteApi.listar_contas(usuario.id),
        clienteApi.listar_cartoes(usuario.id),
        clienteApi.listar_categorias(usuario.id),
        clienteApi.listar_workspaces(usuario.id).catch(() => []),
      ]);
      setMovimentos(movimentosCarregados);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
      setCategorias(categoriasCarregadas);
      const ativo = workspaces.find((w) => w.ativo);
      setVisaoGeral(ativo?.id === "geral" || Boolean(ativo?.sintetico));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o extrato.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  function sincronizar_params(entrada: {
    filtro?: FilaExtrato;
    mes?: string;
    busca?: string;
    categoriaId?: string | null;
    classificacao?: ClassificacaoExtrato;
    origem?: OrigemExtrato;
    tipoGasto?: TipoGastoExtrato;
    porPagina?: number;
  }) {
    const proximoFiltro = entrada.filtro ?? filtro;
    const proximoMes = entrada.mes ?? mes;
    const proximaBusca = entrada.busca ?? busca;
    const proximaCategoria =
      entrada.categoriaId === undefined ? categoriaId : entrada.categoriaId;
    const proximaClassificacao = entrada.classificacao ?? classificacao;
    const proximaOrigem = entrada.origem ?? origem;
    const proximoTipoGasto = entrada.tipoGasto ?? tipoGasto;
    const proximoPorPagina = entrada.porPagina ?? porPagina;
    const params = new URLSearchParams();
    if (proximoFiltro !== "todas") params.set("fila", proximoFiltro);
    if (proximoMes !== mes_de_hoje()) params.set("mes", proximoMes);
    if (proximaBusca.trim()) params.set("q", proximaBusca);
    if (proximaCategoria) params.set("categoria", proximaCategoria);
    if (proximaClassificacao !== "todas") params.set("classificacao", proximaClassificacao);
    const origemQuery = origem_para_query(proximaOrigem);
    if (origemQuery) params.set("origem", origemQuery);
    const tipoGastoQuery = tipo_gasto_para_query(proximoTipoGasto);
    if (tipoGastoQuery) params.set("tipoGasto", tipoGastoQuery);
    if (proximoPorPagina !== TAMANHO_PAGINA_PADRAO) {
      params.set("porPagina", String(proximoPorPagina));
    }
    setSearchParams(params, { replace: true });
    setPagina(1);
  }

  function escolher_filtro(proximo: FilaExtrato) {
    sincronizar_params({ filtro: proximo });
  }

  function escolher_mes(proximo: string) {
    sincronizar_params({ mes: proximo });
  }

  async function alternar_parcelas(movimentoId: string) {
    if (!usuario) return;
    if (parcelasExpandidasId === movimentoId) {
      setParcelasExpandidasId(null);
      return;
    }
    setParcelasExpandidasId(movimentoId);
    if (parcelasPorMovimento[movimentoId]) return;
    setCarregandoParcelasId(movimentoId);
    try {
      const resposta = await clienteApi.listar_parcelas_irmas(movimentoId, usuario.id);
      setParcelasPorMovimento((atual) => ({ ...atual, [movimentoId]: resposta }));
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível carregar as parcelas.");
      setParcelasExpandidasId(null);
    } finally {
      setCarregandoParcelasId(null);
    }
  }

  const quantidadeRevisar = useMemo(
    () =>
      movimentos.filter(
        (m) => m.dataMovimento.startsWith(`${mes}-`) && precisa_revisao(m),
      ).length,
    [movimentos, mes],
  );

  const categoriasParaClassificar = useMemo(
    () => categorias.filter((c) => !eh_nao_classificado(c.nome)),
    [categorias],
  );

  const visiveis = useMemo(
    () =>
      filtrar_extrato(movimentos, contas, cartoes, {
        mes,
        fila: filtro,
        busca,
        categoriaId,
        classificacao,
        origem,
        tipoGasto,
      }),
    [movimentos, contas, cartoes, mes, filtro, busca, categoriaId, classificacao, origem, tipoGasto],
  );

  const paginaAtual = useMemo(
    () => paginar(visiveis, pagina, porPagina),
    [visiveis, pagina, porPagina],
  );

  const filtrosAtivos =
    busca.trim() !== "" ||
    Boolean(categoriaId) ||
    classificacao !== "todas" ||
    origem.tipo !== "todas" ||
    tipoGasto !== "todas";

  async function classificar(movimentoId: string, categoriaId: string) {
    if (!usuario || !categoriaId) return;
    setSalvandoId(movimentoId);
    setErro(null);
    try {
      const atualizado = await clienteApi.atualizar_conhecimento({
        usuarioId: usuario.id,
        movimentoId,
        categoriaId,
      });
      setMovimentos((atual) =>
        atual.map((item) =>
          item.id === movimentoId
            ? {
                ...item,
                categoriaId: atualizado.categoriaId,
                categoriaNome: atualizado.categoriaNome,
                classificadoPor: atualizado.classificadoPor,
                regraId: atualizado.regraId,
                regraTrecho: null,
                classificadoEm: atualizado.classificadoEm,
                confiancaIa: atualizado.confiancaIa,
                tipoGasto: atualizado.tipoGasto,
              }
            : item,
        ),
      );
      contexto?.invalidar("extrato", "dashboard");
      toast.sucesso("Movimento classificado.");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível classificar.");
    } finally {
      setSalvandoId(null);
    }
  }

  async function alterar_tipo_gasto(movimentoId: string, proximo: Perfil) {
    if (!usuario) return;
    setSalvandoId(movimentoId);
    setErro(null);
    try {
      const atualizado = await clienteApi.atualizar_conhecimento({
        usuarioId: usuario.id,
        movimentoId,
        tipoGasto: proximo,
      });
      setMovimentos((atual) =>
        atual.map((item) =>
          item.id === movimentoId ? { ...item, tipoGasto: atualizado.tipoGasto } : item,
        ),
      );
      contexto?.invalidar("extrato", "dashboard");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível atualizar o tipo de gasto.");
    } finally {
      setSalvandoId(null);
    }
  }

  if (!usuario) {
    return (
      <div className="flex h-full items-center justify-center text-texto-suave">Carregando...</div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Extrato</h1>
          <p className="text-sm text-texto-suave">
            {visaoGeral
              ? "Todos os workspaces — classifique e revise o que veio do banco ou do assistente"
              : "Classifique e revise o que veio do banco ou do assistente"}
          </p>
        </div>
        <SeletorMes mes={mes} onChange={escolher_mes} />
      </div>

      {quantidadeRevisar > 0 && filtro !== "revisar" && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => escolher_filtro("revisar")}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-aviso/40 bg-aviso/10 px-4 py-3 text-left transition hover:bg-aviso/15"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-aviso" />
            <p className="text-sm text-texto">
              {quantidadeRevisar} para revisar
              <span className="text-texto-suave"> — sem categoria ou IA insegura</span>
            </p>
          </div>
          <span className="text-sm font-medium text-primaria">Abrir fila</span>
        </motion.button>
      )}

      <div className="flex flex-col gap-2">
        <label className="relative block">
          <span className="sr-only">Buscar lançamento</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-suave"
          />
          <Campo
            value={busca}
            onChange={(e) => sincronizar_params({ busca: e.target.value })}
            placeholder="Buscar por descrição, banco ou conta"
            className="pl-9"
          />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-texto-suave">
            Origens
            <select
              value={origem_para_query(origem) ?? ""}
              onChange={(e) => sincronizar_params({ origem: origem_da_query(e.target.value || null) })}
              className={unir_classes(CLASSE_SELECT, "normal-case tracking-normal")}
            >
              <option value="">Todos</option>
              {contas.length > 0 && (
                <optgroup label="Contas">
                  {contas.map((conta) => (
                    <option key={conta.id} value={`conta:${conta.id}`}>
                      {conta.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              {cartoes.length > 0 && (
                <optgroup label="Cartões">
                  {cartoes.map((cartao) => (
                    <option key={cartao.id} value={`cartao:${cartao.id}`}>
                      {cartao.nome}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-texto-suave">
            Categoria
            <select
              value={categoriaId ?? ""}
              onChange={(e) => sincronizar_params({ categoriaId: e.target.value || null })}
              className={unir_classes(CLASSE_SELECT, "normal-case tracking-normal")}
            >
              <option value="">Todas</option>
              {categorias.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-texto-suave">
            Classificação
            <select
              value={classificacao}
              onChange={(e) =>
                sincronizar_params({
                  classificacao: classificacao_da_query(e.target.value),
                })
              }
              className={unir_classes(CLASSE_SELECT, "normal-case tracking-normal")}
            >
              <option value="todas">Todas</option>
              <option value="usuario">Você</option>
              <option value="regra">Regra</option>
              <option value="ia">IA</option>
              <option value="sem_classificar">Sem classificar</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-texto-suave">
            Tipo de gasto
            <select
              value={tipoGasto === "todas" ? "" : tipoGasto}
              onChange={(e) =>
                sincronizar_params({ tipoGasto: tipo_gasto_da_query(e.target.value || null) })
              }
              className={unir_classes(CLASSE_SELECT, "normal-case tracking-normal")}
            >
              <option value="">Todos</option>
              <option value="pessoal">Pessoal</option>
              <option value="empresa">Empresa</option>
            </select>
          </label>
        </div>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {carregando && movimentos.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : visiveis.length === 0 ? (
        <Cartao>
          <p className="text-sm text-texto">
            {filtro === "revisar"
              ? "Fila limpa — nada para revisar."
              : "Nenhum lançamento por aqui."}
          </p>
          <p className="mt-1 text-xs text-texto-suave">
            {filtrosAtivos
              ? "Tente limpar a busca ou os filtros."
              : filtro === "banco"
                ? "Conecte um banco em Contas e associe as contas para o extrato aparecer."
                : filtro === "revisar"
                  ? "Quando a IA classificar com pouca certeza, o item aparece aqui."
                  : "Lance pelo assistente ou conecte um banco para começar."}
          </p>
          {filtro === "banco" && !filtrosAtivos && (
            <Link to="/contas" className="mt-3 inline-block text-sm text-primaria hover:underline">
              Ir para Contas
            </Link>
          )}
        </Cartao>
      ) : (
        <>
        <ul className="flex flex-col gap-2">
          {paginaAtual.itens.map((movimento, indice) => {
            const doBanco = movimento.fonte === "open_finance";
            const revisao = precisa_revisao(movimento);
            return (
              <motion.li
                key={movimento.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(indice, 12) * 0.015 }}
              >
                <div
                  className={unir_classes(
                    "rounded-2xl border px-4 py-3",
                    revisao
                      ? "border-aviso/35 bg-aviso/5"
                      : "border-borda bg-superficie/80",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-texto">
                          {movimento.descricao}
                        </p>
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave"
                          title={
                            doBanco
                              ? movimento.descricaoFonte
                              : "Lançamento criado manualmente"
                          }
                        >
                          {doBanco ? <Building2 size={10} /> : <PenLine size={10} />}
                          {doBanco ? "Banco" : "Manual"}
                        </span>
                        <span
                          className={unir_classes(
                            "rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                            revisao
                              ? "border-aviso/40 text-aviso"
                              : "border-borda text-texto-suave",
                          )}
                          title={explicacao_classificacao(movimento)}
                        >
                          {rotulo_classificado_por(
                            movimento.classificadoPor,
                            movimento.confiancaIa,
                          )}
                        </span>
                        {movimento.status === "previsto" && (
                          <span className="text-[10px] uppercase text-texto-suave">Pendente</span>
                        )}
                        {movimento.status === "cancelado" && (
                          <span className="text-[10px] uppercase text-texto-suave">Cancelado</span>
                        )}
                        {movimento.parcelaNumero &&
                          movimento.parcelaTotal &&
                          movimento.parcelaTotal >= 2 && (
                          <span
                            className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] text-texto-suave"
                            title="Parcela da compra no cartão (competência da fatura)"
                          >
                            Parcela {movimento.parcelaNumero}/{movimento.parcelaTotal}
                            {movimento.parcelaCompraValor
                              ? ` · total ${formatar_moeda_br(movimento.parcelaCompraValor)}`
                              : ""}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-texto-suave">
                        {formatar_data(movimento.dataMovimento)} ·{" "}
                        {nome_origem_movimento(movimento, contas, cartoes)}
                        {rotulo_tipo_gasto(movimento.tipoGasto)
                          ? ` · ${rotulo_tipo_gasto(movimento.tipoGasto)}`
                          : ""}
                      </p>
                      {!eh_nao_classificado(movimento.categoriaNome) && (
                        <p className="mt-0.5 text-xs text-texto-suave">
                          {explicacao_classificacao(movimento)}
                        </p>
                      )}
                    </div>
                    <p
                      className={`shrink-0 text-sm font-medium tabular-nums ${cor_valor(movimento.tipo, movimento.status)}`}
                    >
                      {formatar_valor(movimento.tipo, movimento.valor)}
                    </p>
                  </div>

                  {movimento.parcelaNumero &&
                    movimento.parcelaTotal &&
                    movimento.parcelaTotal >= 2 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => void alternar_parcelas(movimento.id)}
                          className="text-xs text-primaria hover:underline"
                        >
                          {parcelasExpandidasId === movimento.id
                            ? "Ocultar parcelas"
                            : "Ver parcelas"}
                        </button>
                        {parcelasExpandidasId === movimento.id && (
                          <div className="mt-2 rounded-xl border border-borda bg-fundo/40 px-3 py-2">
                            {carregandoParcelasId === movimento.id ? (
                              <p className="text-xs text-texto-suave">Carregando parcelas…</p>
                            ) : (parcelasPorMovimento[movimento.id]?.parcelas.length ?? 0) === 0 ? (
                              <p className="text-xs text-texto-suave">
                                Não encontrei as outras parcelas deste parcelamento.
                              </p>
                            ) : (
                              <>
                                {parcelasPorMovimento[movimento.id]?.totalCompra != null && (
                                  <p className="mb-1.5 text-[11px] text-texto-suave">
                                    Compra em{" "}
                                    {movimento.parcelaTotal}x · total{" "}
                                    {formatar_moeda_br(
                                      parcelasPorMovimento[movimento.id]!.totalCompra!,
                                    )}{" "}
                                    (só a parcela do mês entra no total do extrato)
                                  </p>
                                )}
                                <ul className="flex flex-col gap-1">
                                  {parcelasPorMovimento[movimento.id]!.parcelas.map((parcela) => (
                                    <li
                                      key={parcela.id}
                                      className={unir_classes(
                                        "flex items-center justify-between gap-2 text-xs",
                                        parcela.id === movimento.id
                                          ? "font-medium text-texto"
                                          : "text-texto-suave",
                                      )}
                                    >
                                      <span>
                                        {parcela.parcelaNumero}/{parcela.parcelaTotal} ·{" "}
                                        {formatar_mes_competencia(parcela.dataMovimento)}
                                        {parcela.status === "previsto" ? " · pendente" : ""}
                                      </span>
                                      <span className="tabular-nums">
                                        {formatar_moeda_br(parcela.valor)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                  {movimento.status !== "cancelado" && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-texto-suave">
                        Categoria
                        <select
                          value={
                            eh_nao_classificado(movimento.categoriaNome)
                              ? ""
                              : movimento.categoriaId
                          }
                          disabled={salvandoId === movimento.id || categoriasParaClassificar.length === 0}
                          onChange={(e) => {
                            if (e.target.value) void classificar(movimento.id, e.target.value);
                          }}
                          className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm normal-case tracking-normal text-texto outline-none focus:border-primaria disabled:opacity-60"
                        >
                          <option value="">
                            {eh_nao_classificado(movimento.categoriaNome)
                              ? "Escolher categoria..."
                              : movimento.categoriaNome}
                          </option>
                          {categoriasParaClassificar.map((categoria) => (
                            <option key={categoria.id} value={categoria.id}>
                              {categoria.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(() => {
                        const origemPerfil = perfil_origem_movimento(
                          movimento,
                          contas,
                          cartoes,
                        );
                        if (!origemPerfil) return null;
                        const cruzado =
                          origemPerfil === "pj"
                            ? movimento.tipoGasto === "pf"
                            : movimento.tipoGasto === "pj";
                        return (
                          <label className="flex items-center gap-2 pb-2 text-sm text-texto">
                            <input
                              type="checkbox"
                              className="size-4 rounded border-borda"
                              checked={cruzado}
                              disabled={salvandoId === movimento.id}
                              onChange={() => {
                                const proximo: Perfil = cruzado
                                  ? origemPerfil
                                  : origemPerfil === "pj"
                                    ? "pf"
                                    : "pj";
                                void alterar_tipo_gasto(movimento.id, proximo);
                              }}
                            />
                            <span className="normal-case">
                              {origemPerfil === "pj"
                                ? "Gasto pessoal?"
                                : "É um gasto da empresa?"}
                            </span>
                          </label>
                        );
                      })()}
                      {salvandoId === movimento.id && (
                        <span className="pb-2 text-xs text-texto-suave">Salvando...</span>
                      )}
                    </div>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ul>
        <Paginador
          pagina={paginaAtual.pagina}
          paginas={paginaAtual.paginas}
          total={paginaAtual.total}
          porPagina={paginaAtual.porPagina}
          de={paginaAtual.de}
          ate={paginaAtual.ate}
          onPagina={setPagina}
          onPorPagina={(n) => sincronizar_params({ porPagina: n })}
        />
        </>
      )}

      {categoriasParaClassificar.length === 0 && !carregando && (
        <p className="text-xs text-texto-suave">
          Sem categorias úteis.{" "}
          <Link to="/categorias" className="text-primaria hover:underline">
            Cadastre em Categorias
          </Link>
          .
        </p>
      )}
    </div>
  );
}
