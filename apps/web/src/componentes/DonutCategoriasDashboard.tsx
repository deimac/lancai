import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { IconeCategoria } from "./IconeCategoria";
import type { RankingCategoria } from "../lib/api";
import { formatar_moeda } from "../lib/formatar";
import { hex_cor_categoria } from "../lib/visual-categoria";
import { unir_classes } from "../lib/unir-classes";

type AbaDonut = "saidas" | "entradas";

type Destaque = { nome: string; total: number };

type Props = {
  gastos: RankingCategoria[];
  receitas: RankingCategoria[];
  ocultarValores: boolean;
};

function formatar_oculto(valor: string, ocultar: boolean): string {
  return ocultar ? "R$ •••" : valor;
}

function percentual(total: number, soma: number): number {
  if (soma <= 0) return 0;
  return Math.round((total / soma) * 100);
}

export function DonutCategoriasDashboard({ gastos, receitas, ocultarValores }: Props) {
  const [aba, setAba] = useState<AbaDonut>("saidas");
  const [destaque, setDestaque] = useState<Destaque | null>(null);

  const itens = aba === "saidas" ? gastos : receitas;
  const soma = useMemo(() => itens.reduce((acc, item) => acc + item.total, 0), [itens]);
  const rotulo = destaque?.nome ?? "Total";
  const valor = destaque?.total ?? soma;

  function marcar(item: RankingCategoria) {
    setDestaque({ nome: item.categoriaNome, total: item.total });
  }

  function limpar() {
    setDestaque(null);
  }

  function trocarAba(proxima: AbaDonut) {
    setAba(proxima);
    setDestaque(null);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-texto">
          {aba === "saidas" ? "Despesas por categoria" : "Receitas por categoria"}
        </h2>
        <div className="flex rounded-lg border border-borda p-0.5 text-xs">
          <button
            type="button"
            onClick={() => trocarAba("saidas")}
            className={unir_classes(
              "rounded-md px-2.5 py-1 font-medium transition",
              aba === "saidas" ? "bg-primaria/15 text-primaria" : "text-texto-suave hover:text-texto",
            )}
          >
            Saídas
          </button>
          <button
            type="button"
            onClick={() => trocarAba("entradas")}
            className={unir_classes(
              "rounded-md px-2.5 py-1 font-medium transition",
              aba === "entradas" ? "bg-primaria/15 text-primaria" : "text-texto-suave hover:text-texto",
            )}
          >
            Entradas
          </button>
        </div>
      </div>

      {itens.length === 0 ? (
        <p className="py-10 text-center text-sm text-texto-suave">
          {aba === "saidas" ? "Nenhuma despesa neste mês." : "Nenhuma receita neste mês."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={itens}
                    dataKey="total"
                    nameKey="categoriaNome"
                    innerRadius={38}
                    outerRadius={58}
                    paddingAngle={2}
                    stroke="none"
                    onMouseEnter={(_, index) => {
                      const item = itens[index];
                      if (item) marcar(item);
                    }}
                    onMouseLeave={limpar}
                  >
                    {itens.map((item) => {
                      const ativo = destaque?.nome === item.categoriaNome;
                      return (
                        <Cell
                          key={item.categoriaNome}
                          fill={hex_cor_categoria(item.cor)}
                          opacity={destaque && !ativo ? 0.4 : 1}
                          stroke={ativo ? "var(--color-superficie)" : "none"}
                          strokeWidth={ativo ? 2 : 0}
                        />
                      );
                    })}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="min-w-0">
              <p className="text-xl font-semibold tabular-nums tracking-tight text-texto">
                {formatar_oculto(formatar_moeda(valor), ocultarValores)}
              </p>
              <p className="truncate text-xs text-texto-suave">{rotulo}</p>
            </div>
          </div>

          <ul className="space-y-0.5">
            {itens.map((item) => {
              const ativo = destaque?.nome === item.categoriaNome;
              return (
                <li key={item.categoriaNome}>
                  <button
                    type="button"
                    onMouseEnter={() => marcar(item)}
                    onMouseLeave={limpar}
                    onFocus={() => marcar(item)}
                    onBlur={limpar}
                    className={unir_classes(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition",
                      ativo ? "bg-primaria/10" : "hover:bg-borda/40",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <IconeCategoria icone={item.icone} cor={item.cor} tamanho={14} />
                      <span className="truncate text-sm text-texto">{item.categoriaNome}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-texto-suave">
                      {percentual(item.total, soma)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
