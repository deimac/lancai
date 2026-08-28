import { useEffect, useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi } from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { formatar_data_curta, formatar_moeda } from "../lib/formatar";
import { IconeCategoria } from "../componentes/IconeCategoria";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";
import { hojeISO } from "@lancai/tipos";

const ROTULOS_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type Comprometimento = Awaited<ReturnType<typeof clienteApi.listar_parcelamentos>>;

function rotulo_mes(yyyyMm: string): string {
  const [, mes] = yyyyMm.split("-");
  const indice = Number(mes) - 1;
  const ano = yyyyMm.slice(2, 4);
  return `${ROTULOS_MES[indice] ?? mes}/${ano}`;
}

export function TelaRecorrentes() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [dados, setDados] = useState<Comprometimento | null>(null);
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const deps = chave_dependencia(contexto?.versoes, "extrato", "dashboard", "cartoes");

  useEffect(() => {
    if (!usuario) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setDados(null);
    setMesSelecionado(null);
    void clienteApi
      .listar_parcelamentos(usuario.id, hojeISO())
      .then((proximo) => {
        if (cancelado) return;
        setDados(proximo);
      })
      .catch((e) => {
        if (cancelado) return;
        setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar recorrentes.");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [usuario, deps]);

  const recorrentes = dados?.recorrentes ?? [];
  const compras = dados?.compras ?? [];
  const meses = useMemo(
    () =>
      (dados?.meses ?? []).map((item) => ({
        ...item,
        rotulo: rotulo_mes(item.mes),
      })),
    [dados?.meses],
  );

  const totalRecorrente = useMemo(
    () => recorrentes.filter((item) => item.tipo === "despesa").reduce((soma, item) => soma + item.valor, 0),
    [recorrentes],
  );
  const faltaParcelas = useMemo(
    () => compras.reduce((soma, item) => soma + item.valorRestante, 0),
    [compras],
  );
  const jaPago = useMemo(
    () => compras.reduce((soma, item) => soma + (item.valorTotal - item.valorRestante), 0),
    [compras],
  );
  const maxBarra = Math.max(totalRecorrente, faltaParcelas, 1);

  const comprasVisiveis = useMemo(() => {
    if (mesSelecionado) {
      return compras.filter((compra) => compra.parcelasPorMes.some((item) => item.mes === mesSelecionado));
    }
    return compras.filter((compra) => compra.valorRestante > 0);
  }, [compras, mesSelecionado]);

  if (!usuario) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-texto">Recorrentes e parcelados</h1>
        <p className="text-sm text-texto-suave">
          Comprometimento mensal — assinaturas e o que ainda falta nas compras parceladas
        </p>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm">{erro}</div>
      )}

      {carregando && !dados ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-borda bg-superficie/80 p-4">
              <p className="text-xs uppercase tracking-wide text-texto-suave">Recorrentes</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatar_moeda(totalRecorrente)}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-borda">
                <div
                  className="h-full rounded-full bg-primaria"
                  style={{ width: `${(totalRecorrente / maxBarra) * 100}%` }}
                />
              </div>
            </div>
            <div className="rounded-2xl border border-borda bg-superficie/80 p-4">
              <p className="text-xs uppercase tracking-wide text-texto-suave">Falta em parcelas</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-despesa">
                {formatar_moeda(faltaParcelas)}
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-borda">
                <div
                  className="h-full rounded-full bg-despesa"
                  style={{ width: `${(faltaParcelas / maxBarra) * 100}%` }}
                />
              </div>
            </div>
            <div className="rounded-2xl border border-borda bg-superficie/80 p-4">
              <p className="text-xs uppercase tracking-wide text-texto-suave">Já pago</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-receita">
                {formatar_moeda(jaPago)}
              </p>
            </div>
          </div>

          <section className="rounded-2xl border border-borda bg-superficie/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-texto">Comprometimento mensal</h2>
              {mesSelecionado ? (
                <button
                  type="button"
                  className="text-xs text-primaria hover:underline"
                  onClick={() => setMesSelecionado(null)}
                >
                  Ver todos
                </button>
              ) : null}
            </div>
            {meses.every((item) => item.parcelas === 0 && item.recorrentes === 0) ? (
              <p className="py-8 text-center text-sm text-texto-suave">
                Nada comprometido nos próximos meses.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={meses}
                    onClick={(estado) => {
                      const clique = estado as {
                        activePayload?: Array<{ payload?: { mes?: string } }>;
                      };
                      const mes = clique.activePayload?.[0]?.payload?.mes;
                      if (!mes) return;
                      setMesSelecionado((atual) => (atual === mes ? null : mes));
                    }}
                  >
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
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-superficie)",
                        border: "1px solid var(--color-borda)",
                        borderRadius: 12,
                        color: "var(--color-texto)",
                      }}
                      formatter={(valor, nome) => [formatar_moeda(Number(valor)), String(nome)]}
                    />
                    <Legend />
                    <Bar dataKey="parcelas" name="Parcelas" fill="#f07178" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="recorrentes" name="Recorrentes" fill="#7c6af7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-borda bg-superficie/80 p-4">
            <h2 className="mb-3 text-sm font-medium">
              Parcelados
              {mesSelecionado ? ` em ${rotulo_mes(mesSelecionado)}` : " em aberto"}
            </h2>
            {comprasVisiveis.length === 0 ? (
              <p className="py-6 text-center text-sm text-texto-suave">
                {mesSelecionado
                  ? "Nenhuma parcela neste mês."
                  : "Nenhuma compra parcelada em aberto."}
              </p>
            ) : (
              <ul className="space-y-3">
                {comprasVisiveis.map((compra) => {
                  const pct =
                    compra.parcelasTotais > 0
                      ? (compra.parcelasPagas / compra.parcelasTotais) * 100
                      : 0;
                  return (
                    <li
                      key={`${compra.descricao}-${compra.cartaoNome}-${compra.proximaParcelaData}`}
                      className="rounded-xl border border-borda bg-fundo/40 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-texto">{compra.descricao}</p>
                          <p className="text-xs text-texto-suave">
                            {compra.cartaoNome} · {compra.parcelasPagas}/{compra.parcelasTotais} pagas
                            {compra.proximaParcelaData
                              ? ` · próxima ${formatar_data_curta(compra.proximaParcelaData)}`
                              : ""}
                            {compra.valorRestante > compra.valorParcela
                              ? ` · faltam ${formatar_moeda(compra.valorRestante)}`
                              : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm tabular-nums text-despesa">
                            {formatar_moeda(compra.valorParcela)}
                          </span>
                          <span className="text-xs text-texto-suave">parcela</span>
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-borda">
                        <div
                          className={unir_classes("h-full rounded-full bg-primaria")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-borda bg-superficie/80 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Repeat size={16} className="text-primaria" />
              Recorrentes
            </h2>
            {recorrentes.length === 0 ? (
              <p className="py-6 text-center text-sm text-texto-suave">
                Nenhuma recorrência vigente. Assinatura = mesmo valor ~1 vez por mês, ainda caindo. O
                assistente também cadastra: “todo mês dia 10 Netflix 55”.
              </p>
            ) : (
              <ul className="divide-y divide-borda">
                {recorrentes.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <IconeCategoria icone={item.icone} cor={item.cor} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-texto">{item.descricao}</p>
                        <p className="text-xs text-texto-suave">
                          {item.origem === "detectado" ? "Detectado no extrato" : "Cadastrado"}
                          {item.diaDoMes ? ` · dia ${item.diaDoMes}` : ""}
                          {item.contaNome || item.cartaoNome
                            ? ` · ${item.contaNome ?? item.cartaoNome}`
                            : ""}
                          {item.categoriaNome ? ` · ${item.categoriaNome}` : ""}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums">{formatar_moeda(item.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
