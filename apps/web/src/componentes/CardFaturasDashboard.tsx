import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ArrowLeft, ArrowRight, CreditCard, ExternalLink } from "lucide-react";
import type { SerieFaturasDashboard, StatusFaturaDashboard } from "../lib/api";
import { formatar_data_curta, formatar_moeda } from "../lib/formatar";
import { unir_classes } from "../lib/unir-classes";

const COR_STATUS: Record<StatusFaturaDashboard, string> = {
    paga: "#2dd4a0",
    parcial: "#f6b94c",
    em_aberto: "#f07178",
    aberta: "#6ea8fe",
    prevista: "#a9aeb8",
};

const ROTULO_STATUS: Record<StatusFaturaDashboard, string> = {
    paga: "Paga",
    parcial: "Parcial",
    em_aberto: "Em aberto",
    aberta: "Ciclo aberto",
    prevista: "Prevista",
};

const CLASSE_STATUS: Record<StatusFaturaDashboard, { fundo: string; texto: string }> = {
    paga: { fundo: "bg-receita/15", texto: "text-receita" },
    parcial: { fundo: "bg-aviso/15", texto: "text-aviso" },
    em_aberto: { fundo: "bg-despesa/15", texto: "text-despesa" },
    aberta: { fundo: "bg-primaria/15", texto: "text-primaria" },
    prevista: { fundo: "bg-borda/60", texto: "text-texto-suave" },
};

function rotulo_mes(competencia: string): string {
    return new Date(`${competencia}-01T00:00:00Z`).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
}

function valor_oculto(valor: number, ocultar: boolean): string {
    return ocultar ? "R$ •••" : formatar_moeda(valor);
}

function SeloStatus({ status }: { status: StatusFaturaDashboard }) {
    const classe = CLASSE_STATUS[status];
    return (
        <span
            className={unir_classes(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium",
                classe.fundo,
                classe.texto,
            )}
        >
            <span className={unir_classes("h-1.5 w-1.5 rounded-full", classe.texto.replace("text-", "bg-"))} />
            {ROTULO_STATUS[status]}
        </span>
    );
}

function RotuloEixoFaturas({
    x = 0,
    y = 0,
    payload,
    dados,
    ocultarValores,
}: {
    x?: number;
    y?: number;
    payload?: { value?: string };
    dados: Array<{ rotulo: string; total: number; selecionado: boolean }>;
    ocultarValores: boolean;
}) {
    const dado = dados.find((item) => item.rotulo === payload?.value);
    return (
        <g transform={`translate(${x},${y})`}>
            <text
                textAnchor="middle"
                fill={dado?.selecionado ? "var(--color-texto)" : "var(--color-texto-suave)"}
                fontSize={dado?.selecionado ? 12 : 11}
                fontWeight={dado?.selecionado ? 700 : 400}
            >
                {payload?.value}
            </text>
            <text y={24} textAnchor="middle" fill="var(--color-texto)" fontSize={10}>
                {valor_oculto(dado?.total ?? 0, ocultarValores)}
            </text>
        </g>
    );
}

export function CardFaturasDashboard({
    faturas,
    ocultarValores,
    hrefExtrato,
}: {
    faturas: { meses: SerieFaturasDashboard[]; inicio: string; fim: string };
    ocultarValores: boolean;
    hrefExtrato: string;
}) {
    const [cartaoSelecionado, setCartaoSelecionado] = useState("todos");
    const [mesSelecionado, setMesSelecionado] = useState(
        () => faturas.meses[faturas.meses.length - 1]?.competencia ?? "",
    );
    const [indiceJanela, setIndiceJanela] = useState(() => {
        return Math.max(0, faturas.meses.length - Math.min(6, faturas.meses.length));
    });

    const meses = faturas.meses;
    const indiceMes = Math.max(0, meses.findIndex((item) => item.competencia === mesSelecionado));
    const serie = meses[indiceMes] ?? meses[meses.length - 1];
    const janelaTamanho = Math.min(6, meses.length || 1);
    const janelaInicio = Math.max(0, Math.min(indiceJanela, Math.max(0, meses.length - janelaTamanho)));
    const mesesVisiveis = meses.slice(janelaInicio, janelaInicio + janelaTamanho);

    useEffect(() => {
        if (meses.some((item) => item.competencia === mesSelecionado)) return;
        setMesSelecionado(meses[meses.length - 1]?.competencia ?? "");
    }, [meses, mesSelecionado]);

    const cartoes = useMemo(
        () => [...new Map(meses.flatMap((mes) => mes.linhas).map((linha) => [linha.cartaoId, linha.cartaoNome])).entries()],
        [meses],
    );
    const linhas = serie?.linhas.filter(
        (linha) => cartaoSelecionado === "todos" || linha.cartaoId === cartaoSelecionado,
    ) ?? [];
    const quantidadeCartoes = new Set(
        linhas
            .filter((linha) => linha.cartaoId !== "todos")
            .map((linha) => linha.cartaoId),
    ).size;
    const totalRecorte = linhas.reduce((soma, linha) => soma + linha.total, 0);
    const totalPagoRecorte = linhas.reduce((soma, linha) => soma + linha.totalPago, 0);
    const saldoRecorte = linhas.reduce((soma, linha) => soma + linha.saldo, 0);
    function total_mes(mes: SerieFaturasDashboard | undefined): number {
        return (mes?.linhas ?? [])
            .filter((linha) => cartaoSelecionado === "todos" || linha.cartaoId === cartaoSelecionado)
            .reduce((soma, linha) => soma + linha.total, 0);
    }

    const chartData = mesesVisiveis.map((mes) => {
        const linhasMes = mes.linhas.filter(
            (linha) => cartaoSelecionado === "todos" || linha.cartaoId === cartaoSelecionado,
        );
        return {
            competencia: mes.competencia,
            rotulo: new Date(`${mes.competencia}-01T00:00:00Z`).toLocaleDateString("pt-BR", {
                month: "short",
                timeZone: "UTC",
            }).replace(".", ""),
            total: linhasMes.reduce((soma, linha) => soma + linha.total, 0),
            pago: linhasMes.reduce((soma, linha) => soma + linha.totalPago, 0),
            status: mes.status,
            selecionado: mes.competencia === mesSelecionado,
        };
    });

    function navegar(delta: number) {
        const limite = Math.max(0, meses.length - janelaTamanho);
        const proximo = Math.min(Math.max(0, janelaInicio + delta), limite);
        if (proximo === janelaInicio) return;

        setIndiceJanela(proximo);

        const indiceSelecionado = meses.findIndex((item) => item.competencia === mesSelecionado);
        const selecionadoContinuaVisivel = indiceSelecionado >= proximo
            && indiceSelecionado < proximo + janelaTamanho;
        const selecaoTemFatura = indiceSelecionado >= 0 && total_mes(meses[indiceSelecionado]) > 0;
        const inicioNovosMeses = delta < 0 ? proximo : janelaInicio + janelaTamanho;
        const fimNovosMeses = delta < 0 ? janelaInicio : Math.min(proximo + janelaTamanho, meses.length);
        const indicesNovosMeses = Array.from(
            { length: Math.max(0, fimNovosMeses - inicioNovosMeses) },
            (_, indice) => inicioNovosMeses + indice,
        );
        const ordemBusca = delta < 0 ? indicesNovosMeses.reverse() : indicesNovosMeses;
        const indiceComFatura = ordemBusca.find((indice) => total_mes(meses[indice]) > 0);

        if (!selecionadoContinuaVisivel) {
            const indiceNovoFoco = indiceComFatura ?? (delta < 0
                ? Math.min(proximo + janelaTamanho - 1, meses.length - 1)
                : proximo);
            setMesSelecionado(meses[indiceNovoFoco]?.competencia ?? mesSelecionado);
        } else if (!selecaoTemFatura && indiceComFatura != null) {
            setMesSelecionado(meses[indiceComFatura]?.competencia ?? mesSelecionado);
        }
    }

    function selecionar_mes(competencia: string) {
        setMesSelecionado(competencia);
    }

    if (!serie) return null;

    return (
        <section className="rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/20 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primaria/15 text-primaria">
                            <CreditCard size={18} />
                        </span>
                        <div>
                            <h2 className="text-base font-semibold text-texto">Faturas de cartões</h2>
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        aria-label="Filtrar faturas por cartão"
                        value={cartaoSelecionado}
                        onChange={(evento) => setCartaoSelecionado(evento.target.value)}
                        className="rounded-lg border border-borda bg-fundo px-2.5 py-2 text-xs text-texto outline-none focus:border-primaria"
                    >
                        <option value="todos">Todos os cartões</option>
                        {cartoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                    </select>
                    <a
                        href={hrefExtrato}
                        className="inline-flex items-center gap-1 rounded-lg border border-borda px-2.5 py-2 text-xs font-medium text-primaria hover:border-primaria/50"
                    >
                        Ver Extrato <ExternalLink size={13} />
                    </a>
                </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
                <button
                    type="button"
                    aria-label="Mês anterior"
                    disabled={janelaInicio <= 0}
                    onClick={() => navegar(-1)}
                    className="rounded-lg border border-borda p-2 text-texto-suave hover:text-texto disabled:cursor-not-allowed disabled:opacity-35"
                >
                    <ArrowLeft size={16} />
                </button>
                <div className="text-center">
                    <p className="text-sm font-semibold capitalize text-texto">{rotulo_mes(serie.competencia)}</p>
                    <p className="mt-0.5 text-[11px] text-texto-suave">
                        {quantidadeCartoes} {quantidadeCartoes === 1 ? "cartão" : "cartões"} no recorte
                    </p>
                </div>
                <button
                    type="button"
                    aria-label="Próximo mês"
                    disabled={janelaInicio + janelaTamanho >= meses.length}
                    onClick={() => navegar(1)}
                    className="rounded-lg border border-borda p-2 text-texto-suave hover:text-texto disabled:cursor-not-allowed disabled:opacity-35"
                >
                    <ArrowRight size={16} />
                </button>
            </div>

            <div className="mt-3 h-56 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 26 }}>
                        <CartesianGrid stroke="var(--color-borda)" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                            dataKey="rotulo"
                            tick={<RotuloEixoFaturas dados={chartData} ocultarValores={ocultarValores} />}
                            axisLine={false}
                            tickLine={false}
                            height={50}
                        />
                        <YAxis hide />
                        <Bar
                            dataKey="total"
                            name="total"
                            radius={[6, 6, 0, 0]}
                            maxBarSize={42}
                            cursor="pointer"
                        >
                            {chartData.map((item) => {
                                const selecionado = item.competencia === mesSelecionado;
                                return (
                                    <Cell
                                        key={item.competencia}
                                        fill={selecionado ? "var(--color-texto)" : COR_STATUS[item.status]}
                                        fillOpacity={selecionado ? 1 : 0.6}
                                        stroke={selecionado ? "var(--color-primaria)" : "transparent"}
                                        strokeWidth={selecionado ? 2 : 0}
                                        cursor="pointer"
                                        onClick={() => selecionar_mes(item.competencia)}
                                        aria-label={`Selecionar mês ${rotulo_mes(item.competencia)}`}
                                        onKeyDown={(evento) => {
                                            if (evento.key === "Enter" || evento.key === " ") {
                                                evento.preventDefault();
                                                selecionar_mes(item.competencia);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                    />
                                );
                            })}
                        </Bar>
                        <Line type="monotone" dataKey="pago" name="pago" stroke="var(--color-receita)" strokeWidth={2} dot={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="flex items-baseline justify-center gap-2 text-center">
                    <span className="text-[11px] text-texto-suave">Total</span>
                    <span className="font-semibold tabular-nums text-texto">{valor_oculto(totalRecorte, ocultarValores)}</span>
                </div>
                <div className="flex items-baseline justify-center gap-2 text-center">
                    <span className="text-[11px] text-texto-suave">Total pago</span>
                    <span className="font-semibold tabular-nums text-receita">{valor_oculto(totalPagoRecorte, ocultarValores)}</span>
                </div>
                <div className="flex items-baseline justify-center gap-2 text-center">
                    <span className="text-[11px] text-texto-suave">Saldo aberto</span>
                    <span className="font-semibold tabular-nums text-despesa">{valor_oculto(saldoRecorte, ocultarValores)}</span>
                </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border border-borda">
                <div className="min-w-[760px]">
                    <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-3 bg-fundo/70 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-texto-suave">
                        <span>Cartão e ciclo</span><span>Total</span><span>Pago</span><span>Saldo</span><span>Status</span>
                    </div>
                    {linhas.length === 0 ? <p className="px-3 py-6 text-center text-sm text-texto-suave">Nenhuma fatura neste recorte.</p> : linhas.map((linha) => (
                        <div key={linha.cartaoId} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] items-center gap-3 border-t border-borda px-3 py-3 text-xs">
                            <div className="min-w-0"><p className="truncate font-medium text-texto">{linha.cartaoNome}</p><p className="mt-0.5 text-[11px] text-texto-suave">{formatar_data_curta(linha.cicloInicio)} a {formatar_data_curta(linha.cicloFim)} · vence {formatar_data_curta(linha.dataVencimento)}</p></div>
                            <span className="tabular-nums text-texto">{valor_oculto(linha.total, ocultarValores)}</span>
                            <span className="tabular-nums text-receita">{valor_oculto(linha.totalPago, ocultarValores)}</span>
                            <span className={unir_classes("tabular-nums", linha.saldo > 0 ? "text-despesa" : "text-texto-suave")}>{valor_oculto(linha.saldo, ocultarValores)}</span>
                            <span><SeloStatus status={linha.status} /></span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
