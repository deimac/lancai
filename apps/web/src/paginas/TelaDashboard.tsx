import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type DashboardResposta } from "../lib/api";
import { formatar_data_curta, formatar_mes, formatar_moeda } from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { DrawerCartoesDashboard } from "../componentes/DrawerCartoesDashboard";
import { IconeCategoria } from "../componentes/IconeCategoria";
import { Botao } from "../componentes/ui/Botao";
import { mes_de_hoje, normalizar_mes, SeletorMes } from "../componentes/SeletorMes";
import { useContextoLayout } from "../layout/useContextoLayout";
import { hex_cor_categoria } from "../lib/visual-categoria";
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
  const [dados, setDados] = useState<DashboardResposta | null>(null);
  const [visaoGeral, setVisaoGeral] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [drawerCartoesAberto, setDrawerCartoesAberto] = useState(false);
  const [ocultarValores, setOcultarValores] = useState(false);
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
        clienteApi.obter_dashboard(usuario.id, `${mes}-01`),
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
  }, [usuario, mes]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

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
  const resultadoMes =
    dados.resumo.resultadoMes ?? dados.resumo.receitasMes - dados.resumo.despesasMes;

  const fluxoChart = dados.fluxoSaldo.map((ponto) => ({
    ...ponto,
    rotulo: formatar_data_curta(ponto.data),
  }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-texto-suave">Cockpit</p>
          <h1 className="text-2xl font-semibold capitalize tracking-tight">
            {formatar_mes(dados.mes)}
          </h1>
          {visaoGeral ? (
            <p className="text-sm text-texto-suave">Todos os workspaces</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
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
            <p className="mt-1 text-xs text-texto-suave">gasto no mês</p>
            <p className="mt-2 text-sm font-medium text-receita tabular-nums">
              {formatar_oculto(formatar_moeda(cartoesDisponivel), ocultarValores)} disponível
            </p>
            <p className="mt-3 flex items-center gap-1 text-xs font-medium text-primaria">
              {quantidadeCartoes === 1 ? "1 cartão" : `${quantidadeCartoes} cartões`}
              <span className="text-texto-suave">·</span>
              Ver cartões
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
              Receitas do mês
            </span>
            <TrendingUp size={16} className="text-receita" />
          </div>
          <p className="text-2xl font-semibold tracking-tight text-receita tabular-nums">
            {formatar_oculto(formatar_moeda(dados.resumo.receitasMes), ocultarValores)}
          </p>
          <Variacao valor={dados.resumo.variacaoReceitas} />
        </motion.div>

        <motion.div
          {...fade}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/20"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Despesas do mês
            </span>
            <TrendingDown size={16} className="text-despesa" />
          </div>
          <p className="text-2xl font-semibold tracking-tight text-despesa tabular-nums">
            {formatar_oculto(formatar_moeda(dados.resumo.despesasMes), ocultarValores)}
          </p>
          <Variacao valor={dados.resumo.variacaoDespesas} />
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
              Resultado do mês
            </p>
            <p className="text-sm text-texto-suave">Receitas − despesas</p>
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

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <motion.section
          {...fade}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <h2 className="mb-4 text-sm font-medium text-texto">Fluxo de saldo</h2>
          {fluxoChart.length === 0 ? (
            <p className="py-10 text-center text-sm text-texto-suave">
              Sem movimentos neste mês para montar o gráfico.
            </p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={fluxoChart}>
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
                    contentStyle={{
                      background: "var(--color-superficie)",
                      border: "1px solid var(--color-borda)",
                      borderRadius: 12,
                      color: "var(--color-texto)",
                    }}
                    formatter={(valor) => formatar_moeda(Number(valor))}
                    labelFormatter={(rotulo) => `Dia ${rotulo}`}
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
          )}
        </motion.section>

        <motion.section
          {...fade}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <h2 className="mb-4 text-sm font-medium text-texto">Gastos por categoria</h2>
          {dados.gastosPorCategoria.length === 0 ? (
            <p className="py-10 text-center text-sm text-texto-suave">Nenhuma despesa no mês.</p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="h-44 w-full sm:w-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dados.gastosPorCategoria}
                      dataKey="total"
                      nameKey="categoriaNome"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={2}
                    >
                      {dados.gastosPorCategoria.map((item) => (
                        <Cell key={item.categoriaNome} fill={hex_cor_categoria(item.cor)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(valor) => formatar_oculto(formatar_moeda(Number(valor)), ocultarValores)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-2">
                {dados.gastosPorCategoria.map((item) => (
                  <li key={item.categoriaNome} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <IconeCategoria icone={item.icone} cor={item.cor} tamanho={12} />
                      <span className="truncate text-sm text-texto">{item.categoriaNome}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-texto">
                      {formatar_oculto(formatar_moeda(item.total), ocultarValores)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <motion.section
          {...fade}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-texto">Lançamentos recentes</h2>
            <Link to="/extrato" className="text-xs text-primaria hover:underline">
              Ver extrato
            </Link>
          </div>
          {dados.recentes.length === 0 ? (
            <p className="py-8 text-center text-sm text-texto-suave">Nada neste mês ainda.</p>
          ) : (
            <ul className="divide-y divide-borda">
              {dados.recentes.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-texto">{item.descricao}</p>
                    <p className="truncate text-xs text-texto-suave">
                      {formatar_data_curta(item.data)}
                      {item.categoriaNome ? ` · ${item.categoriaNome}` : ""}
                      {item.origemNome ? ` · ${item.origemNome}` : ""}
                    </p>
                  </div>
                  <span
                    className={unir_classes(
                      "shrink-0 font-medium",
                      eh_entrada(item.tipo) ? "text-receita" : "text-despesa",
                    )}
                  >
                    {eh_entrada(item.tipo) ? "+" : "−"}
                    {formatar_oculto(formatar_moeda(item.valor), ocultarValores)}
                  </span>
                </li>
              ))}
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
                <span className="font-medium">{formatar_oculto(formatar_moeda(conta.saldoAtual), ocultarValores)}</span>
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
                <span className="text-texto-suave">
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
              {(dados.proximosPagamentos ?? []).slice(0, 8).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-texto">{item.descricao}</p>
                    <p className="text-xs text-texto-suave">
                      {formatar_data_curta(item.data)}
                      {item.origem === "fatura"
                        ? " · Fatura"
                        : item.origem === "parcela"
                          ? " · Parcela"
                          : item.origem === "recorrente"
                            ? " · Recorrente"
                            : " · Previsto"}
                      {item.vencida ? " · vencida" : ""}
                    </p>
                  </div>
                  <span className={item.vencida ? "text-despesa" : "text-texto"}>
                    {formatar_oculto(formatar_moeda(item.valor), ocultarValores)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </motion.section>

        <motion.section
          {...fade}
          className="rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-texto">Orçamentos</h2>
            <Link to="/categorias" className="text-xs text-primaria hover:underline">
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
                        <IconeCategoria icone={item.icone} cor={item.cor} tamanho={12} />
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
                        style={{ width: `${Math.min(item.percentual, 100)}%` }}
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
      />
    </div>
  );
}
