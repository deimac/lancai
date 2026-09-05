import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { rotulo_mes_curto } from "@lancai/tipos";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type DashboardResposta, type ProximoPagamento } from "../lib/api";
import {
  formatar_data_curta,
  formatar_moeda,
  nome_mes_curto,
  rotulo_faturas_recorte,
  rotulo_legenda_periodos,
} from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import {
  perfil_de_tipo_gasto,
  tipo_gasto_para_query,
  type TipoGastoExtrato,
} from "../lib/filtrar-extrato";
import { DonutCategoriasDashboard } from "../componentes/DonutCategoriasDashboard";
import { CardFaturasDashboard } from "../componentes/CardFaturasDashboard";
import { DrawerCartoesDashboard } from "../componentes/DrawerCartoesDashboard";
import { IconeCategoria } from "../componentes/IconeCategoria";
import { SeletorTipoGasto } from "../componentes/SeletorTipoGasto";
import { Botao } from "../componentes/ui/Botao";
import { mes_de_hoje, normalizar_mes, SeletorMes } from "../componentes/SeletorMes";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

function eh_entrada(tipo: string): boolean {
  return ["receita", "reembolso", "estorno", "aporte"].includes(tipo);
}

function formatar_oculto(valor: string, ocultar: boolean): string {
  return ocultar ? "R$ •••" : valor;
}

function selo_pagamento(item: ProximoPagamento): { rotulo: string; classe: string } {
  if (item.situacao === "paga" || item.pago) {
    return { rotulo: "Paga", classe: "bg-receita/15 text-receita" };
  }
  if (item.situacao === "vencida" || item.vencida) {
    return { rotulo: "Vencida", classe: "bg-despesa/15 text-despesa" };
  }
  if (item.situacao === "a_pagar") {
    return { rotulo: "A pagar", classe: "bg-despesa/10 text-despesa" };
  }
  return { rotulo: "Em aberto", classe: "bg-fundo text-texto-suave" };
}

function titulo_proximo(item: ProximoPagamento): string {
  if (item.origem !== "fatura" || !item.competenciaCiclo) return item.descricao;
  const ciclo = rotulo_mes_curto(item.competenciaCiclo);
  if (item.descricao.includes(` · ${ciclo}`)) return item.descricao;
  return `${item.descricao} · ${ciclo}`;
}

function sub_proximo(item: ProximoPagamento): string {
  if (item.origem === "fatura") {
    const vence = `vence ${formatar_data_curta(item.data)}`;
    if (item.dataPagamento) return `${vence} · pago ${formatar_data_curta(item.dataPagamento)}`;
    return vence;
  }
  if (item.origem === "parcela") return `${formatar_data_curta(item.data)} · Parcela`;
  if (item.origem === "recorrente") return `${formatar_data_curta(item.data)} · Recorrente`;
  return `${formatar_data_curta(item.data)} · Previsto`;
}

type PontoResultadoGrafico = {
  rotulo: string;
  entradas: number;
  saidas: number;
  resultadoAcumulado: number;
};

function LegendaResultado({
  entradas,
  saidas,
  resultado,
  rotulo,
  ocultarValores,
}: {
  entradas: number;
  saidas: number;
  resultado: number;
  rotulo: string | null;
  ocultarValores: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs">
      {rotulo ? (
        <span className="w-full text-center text-[11px] text-texto-suave">Dia {rotulo}</span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 text-texto-suave">
        <span className="h-2 w-2 rounded-full bg-[#2dd4a0]" />
        Entradas
        <span className="font-medium tabular-nums text-receita">
          {formatar_oculto(formatar_moeda(entradas), ocultarValores)}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-texto-suave">
        <span className="h-2 w-2 rounded-full bg-texto" />
        Resultado
        <span
          className={unir_classes(
            "font-medium tabular-nums",
            resultado >= 0 ? "text-receita" : "text-despesa",
          )}
        >
          {formatar_oculto(
            `${resultado >= 0 ? "" : "−"}${formatar_moeda(Math.abs(resultado))}`,
            ocultarValores,
          )}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-texto-suave">
        <span className="h-2 w-2 rounded-full bg-[#f07178]" />
        Saídas
        <span className="font-medium tabular-nums text-despesa">
          {formatar_oculto(formatar_moeda(saidas), ocultarValores)}
        </span>
      </span>
    </div>
  );
}

function LegendaCaixa({
  saldo,
  rotulo,
  ocultarValores,
}: {
  saldo: number;
  rotulo: string | null;
  ocultarValores: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs">
      {rotulo ? (
        <span className="w-full text-center text-[11px] text-texto-suave">Dia {rotulo}</span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 text-texto-suave">
        <span className="h-2 w-2 rounded-full bg-[#2dd4a0]" />
        Saldo da conta
        <span className="font-medium tabular-nums text-texto">
          {formatar_oculto(formatar_moeda(saldo), ocultarValores)}
        </span>
      </span>
    </div>
  );
}

function Variacao({ valor }: { valor: number | null | undefined }) {
  if (valor == null) return null;
  const positivo = valor >= 0;
  return (
    <p className={unir_classes("mt-1 text-xs", positivo ? "text-receita" : "text-despesa")}>
      {positivo ? "▲" : "▼"} {Math.abs(valor).toFixed(1).replace(".", ",")}% vs mês anterior
    </p>
  );
}

export function TelaDashboard() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const mes = normalizar_mes(searchParams.get("mes"), mes_de_hoje());
  const [tipoGasto, setTipoGasto] = useState<TipoGastoExtrato>("todas");
  const perfilGasto = perfil_de_tipo_gasto(tipoGasto);
  const [dados, setDados] = useState<DashboardResposta | null>(null);
  const [visaoGeral, setVisaoGeral] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [drawerCartoesAberto, setDrawerCartoesAberto] = useState(false);
  const [ocultarValores, setOcultarValores] = useState(false);
  const [abaGrafico, setAbaGrafico] = useState<"resultado" | "caixa">("resultado");
  const [pontoResultadoHover, setPontoResultadoHover] = useState<PontoResultadoGrafico | null>(
    null,
  );
  const [pontoCaixaHover, setPontoCaixaHover] = useState<{ rotulo: string; saldo: number } | null>(
    null,
  );
  const depsDados = chave_dependencia(
    contexto?.versoes,
    "dashboard",
    "contas",
    "cartoes",
  );

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [dash, workspaces] = await Promise.all([
        clienteApi.obter_dashboard(usuario.id, `${mes}-01`, perfilGasto),
        clienteApi.listar_workspaces(usuario.id).catch(() => []),
      ]);
      setDados(dash);
      const ativo = workspaces.find((w) => w.ativo);
      setVisaoGeral(ativo?.id === "geral" || Boolean(ativo?.sintetico));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o dashboard.");
    } finally {
      setCarregando(false);
    }
  }, [usuario, mes, perfilGasto]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  useEffect(() => {
    if (!contexto?.geracaoCockpit) return;
    setTipoGasto("todas");
  }, [contexto?.geracaoCockpit]);

  useEffect(() => {
    if (!searchParams.has("tipoGasto")) return;
    const params = new URLSearchParams(searchParams);
    params.delete("tipoGasto");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setPontoResultadoHover(null);
    setPontoCaixaHover(null);
  }, [mes, abaGrafico, tipoGasto]);

  function escolher_tipo_gasto(proximo: TipoGastoExtrato) {
    setTipoGasto(proximo);
  }

  function escolher_mes(proximo: string) {
    const params = new URLSearchParams(searchParams);
    if (proximo === mes_de_hoje()) params.delete("mes");
    else params.set("mes", proximo);
    setSearchParams(params, { replace: true });
  }

  if (!usuario) return null;

  if (carregando && !dados) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-texto-suave">
        Carregando cockpit...
      </div>
    );
  }

  if (erro && !dados) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-perigo">{erro}</p>
        <Botao variante="fantasma" onClick={() => void carregar()}>
          Tentar de novo
        </Botao>
      </div>
    );
  }

  if (!dados) return null;

  const quantidadeContas = dados.resumo.quantidadeContas ?? dados.contas.length;
  const quantidadeCartoes = dados.resumo.quantidadeCartoes ?? dados.cartoes.length;
  const cartoesDisponivel =
    dados.resumo.cartoesDisponivel ??
    dados.cartoes.reduce((soma, cartao) => soma + cartao.disponivel, 0);
  const gastoCartoesMes =
    dados.resumo.gastoCartoesMes ??
    dados.cartoes.reduce((soma, cartao) => soma + (cartao.gastoMes ?? 0), 0);
  const gastoCartoesEhFaturaAtual = dados.cartoes.some((cartao) => cartao.gastoEhFaturaAtual);
  const resultadoMes =
    dados.resumo.resultadoMes ?? dados.resumo.receitasMes - dados.resumo.despesasMes;

  const fluxoChart = dados.fluxoSaldo.map((ponto) => ({
    ...ponto,
    rotulo: formatar_data_curta(ponto.data),
  }));
  const resultadoChart = (dados.fluxoResultado ?? []).map((ponto) => ({
    rotulo: formatar_data_curta(ponto.data),
    entradas: ponto.entradas,
    saidas: -ponto.saidas,
    resultadoAcumulado: ponto.resultadoAcumulado ?? ponto.resultado,
  }));
  const temResultado = resultadoChart.some(
    (ponto) => ponto.entradas !== 0 || ponto.saidas !== 0,
  );
  const totaisResultado = {
    entradas: resultadoChart.reduce((soma, ponto) => soma + ponto.entradas, 0),
    saidas: resultadoChart.reduce((soma, ponto) => soma + Math.abs(ponto.saidas), 0),
    resultado: resultadoChart.at(-1)?.resultadoAcumulado ?? 0,
  };
  const legendaResultado = pontoResultadoHover
    ? {
      entradas: pontoResultadoHover.entradas,
      saidas: Math.abs(pontoResultadoHover.saidas),
      resultado: pontoResultadoHover.resultadoAcumulado,
      rotulo: pontoResultadoHover.rotulo,
    }
    : { ...totaisResultado, rotulo: null as string | null };
  const ultimoCaixa = fluxoChart.at(-1);
  const legendaCaixa = pontoCaixaHover
    ? pontoCaixaHover
    : { saldo: ultimoCaixa?.saldo ?? 0, rotulo: null as string | null };
  const natureza = dados.natureza;
  const mostrarSplit = tipoGasto === "todas" && natureza;
  const tipoExtratoQuery = tipo_gasto_para_query(tipoGasto);
  const hrefExtrato = tipoExtratoQuery ? `/extrato?tipoGasto=${tipoExtratoQuery}` : "/extrato";
  const paramsFaturas = new URLSearchParams();
  paramsFaturas.set("visao", "faturas");
  if (tipoExtratoQuery) paramsFaturas.set("tipoGasto", tipoExtratoQuery);
  if (mes !== mes_de_hoje()) paramsFaturas.set("mes", mes);
  const hrefFaturas = `/extrato?${paramsFaturas.toString()}`;
  const faturasRotulo = rotulo_faturas_recorte(gastoCartoesEhFaturaAtual);
  const mesNome = nome_mes_curto(dados.mes);
  const cruzamento = dados.cruzamento;
  const mostrarCruzamento =
    !visaoGeral &&
    cruzamento != null &&
    (cruzamento.totalPessoalComEmpresa > 0 || cruzamento.totalEmpresaComPessoal > 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cockpit</h1>
          {visaoGeral ? (
            <p className="text-sm text-texto-suave">Todos os workspaces</p>
          ) : null}
          <p className="mt-1 text-xs text-texto-suave">{rotulo_legenda_periodos(dados.mes)}</p>
        </div>
        <div className="flex items-center gap-2">
          <SeletorTipoGasto valor={tipoGasto} onChange={escolher_tipo_gasto} />
          <button
            type="button"
            onClick={() => setOcultarValores((v) => !v)}
            className="rounded-lg border border-borda p-2 text-texto-suave hover:text-texto"
            title={ocultarValores ? "Mostrar valores" : "Ocultar valores"}
          >
            {ocultarValores ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <SeletorMes mes={mes} onChange={escolher_mes} />
        </div>
      </div>

      {dados.naoClassificado.quantidade > 0 && (
        <motion.div
          {...fade}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aviso/40 bg-aviso/10 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle size={16} className="text-aviso" />
            <span>
              {dados.naoClassificado.quantidade} lançamento
              {dados.naoClassificado.quantidade > 1 ? "s" : ""} sem categoria (
              {formatar_moeda(dados.naoClassificado.total)})
            </span>
          </div>
          <Link
            to="/extrato?fila=revisar"
            className="text-sm font-medium text-primaria hover:underline"
          >
            Classificar agora
          </Link>
        </motion.div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <motion.div
          {...fade}
          transition={{ delay: 0 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/20"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Saldo disponível
            </span>
            <Wallet size={16} className="text-primaria" />
          </div>
          <p className="text-2xl font-semibold tracking-tight text-texto tabular-nums">
            {formatar_oculto(formatar_moeda(dados.resumo.saldoTotal), ocultarValores)}
          </p>
          <p className="mt-2 text-xs text-texto-suave">
            {quantidadeContas === 0
              ? "Nenhuma conta cadastrada"
              : quantidadeContas === 1
                ? "1 conta"
                : `${quantidadeContas} contas`}
          </p>
        </motion.div>

        {quantidadeCartoes === 0 ? (
          <motion.div
            {...fade}
            transition={{ delay: 0.05 }}
            className="rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/20"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">
                Cartões
              </span>
              <CreditCard size={16} className="text-texto-suave" />
            </div>
            <p className="text-base font-medium text-texto">Nenhum cartão cadastrado</p>
            <p className="mt-1 text-xs text-texto-suave">
              Adicione um cartão para acompanhar limite, utilização e gastos mensais.
            </p>
            <Link
              to="/contas#cartoes"
              className="mt-3 inline-block text-sm font-medium text-primaria hover:underline"
            >
              + Adicionar cartão
            </Link>
          </motion.div>
        ) : (
          <motion.button
            type="button"
            {...fade}
            transition={{ delay: 0.05 }}
            onClick={() => setDrawerCartoesAberto(true)}
            className="h-full rounded-2xl border border-borda bg-superficie/80 p-4 text-left shadow-sm shadow-black/20 transition-colors hover:border-primaria/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaria/50"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">
                Cartões
              </span>
              <CreditCard size={16} className="text-primaria" />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-despesa tabular-nums">
              {formatar_oculto(formatar_moeda(gastoCartoesMes), ocultarValores)}
            </p>
            <p className="mt-1 text-xs text-texto-suave">
              {faturasRotulo} · diferente do utilizado do limite
            </p>
            <p className="mt-2 text-sm font-medium text-receita tabular-nums">
              {formatar_oculto(formatar_moeda(cartoesDisponivel), ocultarValores)} disponível
            </p>
            <p className="mt-3 flex items-center gap-1 text-xs font-medium text-primaria">
              {quantidadeCartoes === 1 ? "1 cartão" : `${quantidadeCartoes} cartões`}
              <span className="text-texto-suave">·</span>
              Ver faturas
              <ChevronRight size={14} />
            </p>
          </motion.button>
        )}

        <motion.div
          {...fade}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/20"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Receitas
            </span>
            <TrendingUp size={16} className="text-receita" />
          </div>
          <p className="text-2xl font-semibold tracking-tight text-receita tabular-nums">
            {formatar_oculto(formatar_moeda(dados.resumo.receitasMes), ocultarValores)}
          </p>
          <Variacao valor={dados.resumo.variacaoReceitas} />
          <p className="mt-2 text-xs text-texto-suave">
            Contas no calendário + cartões nos ciclos
          </p>
          {mostrarSplit && natureza ? (
            <p className="mt-2 text-xs text-texto-suave">
              Pessoal {formatar_oculto(formatar_moeda(natureza.pessoal.receitas), ocultarValores)}
              {" · "}
              Empresa {formatar_oculto(formatar_moeda(natureza.empresa.receitas), ocultarValores)}
            </p>
          ) : null}
        </motion.div>

        <motion.div
          {...fade}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/20"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Despesas
            </span>
            <TrendingDown size={16} className="text-despesa" />
          </div>
          <p className="text-2xl font-semibold tracking-tight text-despesa tabular-nums">
            {formatar_oculto(formatar_moeda(dados.resumo.despesasMes), ocultarValores)}
          </p>
          <Variacao valor={dados.resumo.variacaoDespesas} />
          <p className="mt-2 text-xs text-texto-suave">
            Contas no calendário + cartões nos ciclos
          </p>
          {mostrarSplit && natureza ? (
            <p className="mt-2 text-xs text-texto-suave">
              Pessoal {formatar_oculto(formatar_moeda(natureza.pessoal.despesas), ocultarValores)}
              {" · "}
              Empresa {formatar_oculto(formatar_moeda(natureza.empresa.despesas), ocultarValores)}
            </p>
          ) : null}
        </motion.div>
      </div>

      <motion.div
        {...fade}
        transition={{ delay: 0.2 }}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/80 px-5 py-4 shadow-sm shadow-black/20"
      >
        <div className="flex items-center gap-3">
          <div
            className={unir_classes(
              "flex h-10 w-10 items-center justify-center rounded-xl",
              resultadoMes >= 0 ? "bg-receita/15" : "bg-despesa/15",
            )}
          >
            <Activity
              size={18}
              className={resultadoMes >= 0 ? "text-receita" : "text-despesa"}
            />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Resultado
            </p>
            <p className="text-sm text-texto-suave">
              Contas: {mesNome} · Cartões: ciclos
            </p>
            <Variacao valor={dados.resumo.variacaoResultado} />
          </div>
        </div>
        <p
          className={unir_classes(
            "text-2xl font-semibold tracking-tight tabular-nums",
            resultadoMes >= 0 ? "text-receita" : "text-despesa",
          )}
        >
          {formatar_oculto(
            `${resultadoMes >= 0 ? "+" : "−"}${formatar_moeda(Math.abs(resultadoMes))}`,
            ocultarValores,
          )}
        </p>
      </motion.div>

      <motion.div {...fade} transition={{ delay: 0.22 }}>
        <CardFaturasDashboard
          faturas={dados.faturas}
          mesSelecionado={mes}
          ocultarValores={ocultarValores}
          onMesChange={escolher_mes}
          hrefExtrato={hrefFaturas}
        />
      </motion.div>

      {mostrarCruzamento && cruzamento ? (
        <motion.div
          {...fade}
          className="grid gap-4 rounded-2xl border border-borda bg-superficie/80 px-5 py-4 sm:grid-cols-2"
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Cruzamento neste workspace
            </p>
            <p className="mt-2 text-sm text-texto-suave">Pessoal pago com dinheiro da empresa</p>
            <p className="text-lg font-semibold tabular-nums text-texto">
              {formatar_oculto(
                formatar_moeda(cruzamento.totalPessoalComEmpresa),
                ocultarValores,
              )}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="mt-5 text-sm text-texto-suave sm:mt-6">
              Empresa paga com dinheiro pessoal
            </p>
            <p className="text-lg font-semibold tabular-nums text-texto">
              {formatar_oculto(
                formatar_moeda(cruzamento.totalEmpresaComPessoal),
                ocultarValores,
              )}
            </p>
          </div>
        </motion.div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <motion.section
          {...fade}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-texto">
                {abaGrafico === "resultado" ? "Resultado do mês" : "Caixa da conta"}
              </h2>
              {abaGrafico === "caixa" ? (
                <p className="mt-0.5 text-xs text-texto-suave">
                  Saldo na conta ao fim de cada dia — o último ponto é o disponível
                </p>
              ) : tipoGasto !== "todas" ? (
                <p className="mt-0.5 text-xs text-texto-suave">
                  {tipoGasto === "pessoal"
                    ? "Só lançamentos pessoais, de qualquer conta"
                    : "Só lançamentos da empresa, de qualquer conta"}
                </p>
              ) : null}
            </div>
            <div className="flex rounded-lg border border-borda p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setAbaGrafico("resultado")}
                className={unir_classes(
                  "rounded-md px-2.5 py-1 font-medium transition",
                  abaGrafico === "resultado"
                    ? "bg-primaria/15 text-primaria"
                    : "text-texto-suave hover:text-texto",
                )}
              >
                Resultado
              </button>
              <button
                type="button"
                onClick={() => setAbaGrafico("caixa")}
                className={unir_classes(
                  "rounded-md px-2.5 py-1 font-medium transition",
                  abaGrafico === "caixa"
                    ? "bg-primaria/15 text-primaria"
                    : "text-texto-suave hover:text-texto",
                )}
              >
                Caixa
              </button>
            </div>
          </div>
          {abaGrafico === "resultado" ? (
            !temResultado ? (
              <p className="py-10 text-center text-sm text-texto-suave">
                Sem movimentos neste mês para montar o gráfico.
              </p>
            ) : (
              <div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={resultadoChart}
                      onMouseMove={(estado) => {
                        const rotulo = estado.activeLabel;
                        if (rotulo == null) return;
                        const ponto = resultadoChart.find((item) => item.rotulo === String(rotulo));
                        if (ponto) setPontoResultadoHover(ponto);
                      }}
                      onMouseLeave={() => setPontoResultadoHover(null)}
                    >
                      <defs>
                        <linearGradient id="entradasFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2dd4a0" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#2dd4a0" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="saidasFill" x1="0" y1="1" x2="0" y2="0">
                          <stop offset="0%" stopColor="#f07178" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#f07178" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--color-borda)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="rotulo"
                        tick={{ fill: "var(--color-texto-suave)", fontSize: 11 }}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fill: "var(--color-texto-suave)", fontSize: 11 }}
                        axisLine={false}
                        tickFormatter={(v: number) =>
                          v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
                        }
                      />
                      <ReferenceLine y={0} stroke="var(--color-borda)" />
                      <Tooltip
                        content={() => null}
                        cursor={{ stroke: "var(--color-texto-suave)", strokeDasharray: "4 4" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="entradas"
                        name="Entradas"
                        stroke="#2dd4a0"
                        fill="url(#entradasFill)"
                        strokeWidth={1.5}
                      />
                      <Area
                        type="monotone"
                        dataKey="saidas"
                        name="Saídas"
                        stroke="#f07178"
                        fill="url(#saidasFill)"
                        strokeWidth={1.5}
                      />
                      <Line
                        type="monotone"
                        dataKey="resultadoAcumulado"
                        name="Resultado"
                        stroke="var(--color-texto)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <LegendaResultado
                  entradas={legendaResultado.entradas}
                  saidas={legendaResultado.saidas}
                  resultado={legendaResultado.resultado}
                  rotulo={legendaResultado.rotulo}
                  ocultarValores={ocultarValores}
                />
              </div>
            )
          ) : quantidadeContas === 0 ? (
            <p className="py-10 text-center text-sm text-texto-suave">
              Sem conta neste workspace para montar o caixa.
            </p>
          ) : (
            <div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={fluxoChart}
                    onMouseMove={(estado) => {
                      const rotulo = estado.activeLabel;
                      if (rotulo == null) return;
                      const ponto = fluxoChart.find((item) => item.rotulo === String(rotulo));
                      if (ponto) setPontoCaixaHover({ rotulo: ponto.rotulo, saldo: ponto.saldo });
                    }}
                    onMouseLeave={() => setPontoCaixaHover(null)}
                  >
                    <defs>
                      <linearGradient id="saldoFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2dd4a0" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#2dd4a0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-borda)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="rotulo" tick={{ fill: "var(--color-texto-suave)", fontSize: 11 }} axisLine={false} />
                    <YAxis
                      tick={{ fill: "var(--color-texto-suave)", fontSize: 11 }}
                      axisLine={false}
                      tickFormatter={(v: number) =>
                        v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
                      }
                    />
                    <Tooltip
                      content={() => null}
                      cursor={{ stroke: "var(--color-texto-suave)", strokeDasharray: "4 4" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="saldo"
                      stroke="#2dd4a0"
                      fill="url(#saldoFill)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <LegendaCaixa
                saldo={legendaCaixa.saldo}
                rotulo={legendaCaixa.rotulo}
                ocultarValores={ocultarValores}
              />
            </div>
          )}
        </motion.section>

        <motion.section
          {...fade}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <DonutCategoriasDashboard
            gastos={dados.gastosPorCategoria}
            receitas={dados.receitasPorCategoria ?? []}
            ocultarValores={ocultarValores}
          />
        </motion.section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <motion.section
          {...fade}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-texto">Transações recentes</h2>
            <Link to={hrefExtrato} className="text-xs text-primaria hover:underline">
              Ver transações
            </Link>
          </div>
          {dados.recentes.length === 0 ? (
            <p className="py-8 text-center text-sm text-texto-suave">Nada neste mês ainda.</p>
          ) : (
            <ul className="divide-y divide-borda">
              {dados.recentes.map((item) => {
                const entrada = eh_entrada(item.tipo);
                return (
                  <li
                    key={item.id}
                    className="grid grid-cols-[1.5rem_minmax(0,1fr)_8.5rem_6.75rem] items-center gap-2 py-1.5 text-sm"
                  >
                    <span
                      className={unir_classes(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        entrada ? "bg-receita/15 text-receita" : "bg-despesa/15 text-despesa",
                      )}
                    >
                      {entrada ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-left text-[13px] font-medium leading-tight text-texto">
                        {item.descricao}
                      </p>
                      <p className="truncate text-left text-[10px] leading-tight text-texto-suave">
                        {formatar_data_curta(item.data)}
                        {item.origemNome ? ` · ${item.origemNome}` : ""}
                      </p>
                    </div>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <IconeCategoria icone={item.icone} cor={item.cor} tamanho={12} />
                      <span className="truncate text-left text-[11px] text-texto-suave">
                        {item.categoriaNome ?? "Não classificado"}
                      </span>
                    </span>
                    <span
                      className={unir_classes(
                        "text-right text-[13px] font-medium tabular-nums",
                        entrada ? "text-receita" : "text-despesa",
                      )}
                    >
                      {entrada ? "+" : "−"}
                      {formatar_oculto(formatar_moeda(item.valor), ocultarValores)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.section>

        <motion.section
          {...fade}
          transition={{ delay: 0.25 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-texto">Contas</h2>
            <div className="flex gap-3 text-xs">
              <Link to="/contas" className="text-primaria hover:underline">
                Ver contas
              </Link>
            </div>
          </div>
          <ul className="space-y-2">
            {dados.contas.map((conta) => (
              <li
                key={`c-${conta.nome}`}
                className="flex items-center justify-between rounded-xl bg-fundo/50 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{conta.nome}</p>
                  <p className="text-xs text-texto-suave">
                    {conta.perfil === "pj" ? "Jurídica" : "Física"}
                  </p>
                </div>
                <span className="font-medium text-texto">{formatar_oculto(formatar_moeda(conta.saldoAtual), ocultarValores)}</span>
              </li>
            ))}
            {dados.cartoes.map((cartao) => (
              <li
                key={`k-${cartao.nome}`}
                className="flex items-center justify-between rounded-xl bg-fundo/50 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{cartao.nome}</p>
                  <p className="text-xs text-texto-suave">
                    Disponível {formatar_oculto(formatar_moeda(cartao.disponivel), ocultarValores)}
                    {" · "}
                    Usado {formatar_oculto(formatar_moeda(cartao.comprometido), ocultarValores)}
                  </p>
                </div>
                <span className="font-medium text-texto">
                  {formatar_oculto(formatar_moeda(cartao.limite), ocultarValores)}
                </span>
              </li>
            ))}
            {dados.contas.length === 0 && dados.cartoes.length === 0 && (
              <p className="py-6 text-center text-sm text-texto-suave">
                Cadastre uma conta pelo assistente para ver saldos aqui.
              </p>
            )}
          </ul>
        </motion.section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.section
          {...fade}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-texto">Próximos pagamentos</h2>
            <Link to="/agendadas" className="text-xs text-primaria hover:underline">
              Ver agenda
            </Link>
          </div>
          {(dados.proximosPagamentos ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-texto-suave">Nada previsto neste mês.</p>
          ) : (
            <ul className="divide-y divide-borda">
              {(dados.proximosPagamentos ?? []).slice(0, 8).map((item) => {
                const selo = selo_pagamento(item);
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p
                          className={unir_classes(
                            "truncate font-medium",
                            item.pago ? "text-texto-suave" : "text-texto",
                          )}
                        >
                          {titulo_proximo(item)}
                        </p>
                        <span
                          className={unir_classes(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            selo.classe,
                          )}
                        >
                          {selo.rotulo}
                        </span>
                      </div>
                      <p className="text-xs text-texto-suave">{sub_proximo(item)}</p>
                    </div>
                    <span
                      className={
                        item.pago
                          ? "text-texto-suave line-through"
                          : item.vencida
                            ? "text-despesa"
                            : "text-texto"
                      }
                    >
                      {formatar_oculto(formatar_moeda(item.valor), ocultarValores)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.section>

        <motion.section
          {...fade}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-texto">Orçamentos</h2>
            <Link
              to={mes === mes_de_hoje() ? "/categorias" : `/categorias?mes=${mes}`}
              className="text-xs text-primaria hover:underline"
            >
              Categorias
            </Link>
          </div>
          {(dados.orcamentos ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-texto-suave">
              Nenhum limite definido. Cadastre na tela de Categorias.
            </p>
          ) : (
            <ul className="space-y-3">
              {(dados.orcamentos ?? []).map((item) => {
                const estourou = item.percentual >= 100;
                return (
                  <li key={item.categoriaNome ?? "geral"} className="text-xs">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <IconeCategoria icone={item.icone} cor={item.cor} tamanho={14} />
                        <span className="truncate text-sm text-texto">
                          {item.categoriaNome ?? "Geral"}
                        </span>
                      </span>
                      <span className="tabular-nums text-texto-suave">
                        {formatar_oculto(formatar_moeda(item.gasto), ocultarValores)} /{" "}
                        {formatar_oculto(formatar_moeda(item.limite), ocultarValores)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-borda">
                      <div
                        className={unir_classes(
                          "h-full rounded-full",
                          estourou ? "bg-despesa" : "bg-primaria",
                        )}
                        style={{ width: `${Math.max(0, Math.min(item.percentual, 100))}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.section>
      </div>

      <DrawerCartoesDashboard
        aberto={drawerCartoesAberto}
        aoFechar={() => setDrawerCartoesAberto(false)}
        dados={dados}
        visaoGeral={visaoGeral}
        usuarioId={usuario.id}
        tipoGasto={tipoGasto}
        hrefFaturas={hrefFaturas}
      />
    </div>
  );
}
