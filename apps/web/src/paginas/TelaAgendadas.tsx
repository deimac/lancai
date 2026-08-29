import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type CartaoResumo, type MovimentoResumo } from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { formatar_moeda } from "../lib/formatar";
import { mes_de_hoje, normalizar_mes, SeletorMes } from "../componentes/SeletorMes";
import { useContextoLayout } from "../layout/useContextoLayout";
import { rotulo_natureza } from "../lib/natureza-extrato";
import { unir_classes } from "../lib/unir-classes";
import { hojeISO, competencia_ciclo_da_data, mapa_fechamento_cartoes, mapa_vencimento_cartoes, movimento_no_resultado_do_mes } from "@lancai/tipos";

function dias_do_mes(yyyyMm: string): Date[] {
  const partes = yyyyMm.split("-");
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);
  if (!ano || !mes) return [];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return Array.from({ length: ultimo }, (_, i) => new Date(Date.UTC(ano, mes - 1, i + 1)));
}

function iso_dia(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function data_na_agenda(
  item: Pick<MovimentoResumo, "dataMovimento" | "cartaoId">,
  cartoes: CartaoResumo[],
): string {
  const data = item.dataMovimento.slice(0, 10);
  if (!item.cartaoId) return data;
  const cartao = cartoes.find((c) => c.id === item.cartaoId);
  if (!cartao?.fechamento) return data;
  const competencia = competencia_ciclo_da_data(data, cartao.fechamento);
  if (competencia === data.slice(0, 7)) return data;
  return `${competencia}-${String(cartao.vencimento).padStart(2, "0")}`;
}

export function TelaAgendadas() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const mes = normalizar_mes(searchParams.get("mes"), mes_de_hoje());
  const [movimentos, setMovimentos] = useState<MovimentoResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = hojeISO();
  const deps = chave_dependencia(contexto?.versoes, "extrato", "dashboard");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [lista, cartoesCarregados] = await Promise.all([
        clienteApi.listar_movimentos(usuario.id),
        clienteApi.listar_cartoes(usuario.id, true),
      ]);
      setMovimentos(lista);
      setCartoes(cartoesCarregados);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar os agendamentos.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, deps]);

  const agendados = useMemo(() => {
    const fechamentoPorCartao = mapa_fechamento_cartoes(cartoes);
    const vencimentoPorCartao = mapa_vencimento_cartoes(cartoes);
    return movimentos.filter(
      (item) =>
        item.status === "previsto" &&
        item.tipo !== "receita" &&
        movimento_no_resultado_do_mes(item, mes, fechamentoPorCartao, vencimentoPorCartao),
    );
  }, [movimentos, mes, cartoes]);

  const vencidos = agendados.filter((item) => data_na_agenda(item, cartoes) < hoje);
  const futuros = agendados.filter((item) => data_na_agenda(item, cartoes) >= hoje);
  const dias = dias_do_mes(mes);
  const primeiro = dias[0];
  const offset = primeiro ? primeiro.getUTCDay() : 0;
  const porDia = useMemo(() => {
    const mapa = new Map<string, MovimentoResumo[]>();
    for (const item of agendados) {
      const dia = data_na_agenda(item, cartoes);
      const lista = mapa.get(dia) ?? [];
      lista.push(item);
      mapa.set(dia, lista);
    }
    return mapa;
  }, [agendados, cartoes]);

  if (!usuario) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Agendadas</h1>
          <p className="text-sm text-texto-suave">
            Previstos, faturas e parcelas do mês — o que ainda vai sair
          </p>
        </div>
        <SeletorMes
          mes={mes}
          onChange={(proximo) => {
            const params = new URLSearchParams(searchParams);
            if (proximo === mes_de_hoje()) params.delete("mes");
            else params.set("mes", proximo);
            setSearchParams(params, { replace: true });
          }}
        />
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm">{erro}</div>
      )}

      {carregando && agendados.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-borda bg-superficie/80 p-4">
              <p className="text-xs uppercase tracking-wide text-texto-suave">Vencidas</p>
              <p className="mt-1 text-2xl font-semibold text-despesa">{vencidos.length}</p>
            </div>
            <div className="rounded-2xl border border-borda bg-superficie/80 p-4">
              <p className="text-xs uppercase tracking-wide text-texto-suave">Agendadas</p>
              <p className="mt-1 text-2xl font-semibold text-texto">{futuros.length}</p>
            </div>
          </div>

          <section className="rounded-2xl border border-borda bg-superficie/80 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-texto">
              <CalendarDays size={16} className="text-primaria" />
              Calendário
            </h2>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-texto-suave">
              {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                <div key={`${d}-${i}`} className="py-1">
                  {d}
                </div>
              ))}
              {Array.from({ length: offset }).map((_, i) => (
                <div key={`v-${i}`} />
              ))}
              {dias.map((dia) => {
                const iso = iso_dia(dia);
                const itens = porDia.get(iso) ?? [];
                const vencida = itens.some((item) => data_na_agenda(item, cartoes) < hoje);
                return (
                  <div
                    key={iso}
                    className={unir_classes(
                      "min-h-14 rounded-lg border border-transparent px-1 py-1",
                      iso === hoje && "border-primaria/50",
                    )}
                  >
                    <p className="text-xs text-texto">{dia.getUTCDate()}</p>
                    {itens.length > 0 && (
                      <span
                        className={unir_classes(
                          "mt-1 inline-block h-1.5 w-1.5 rounded-full",
                          vencida ? "bg-despesa" : "bg-primaria",
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-borda bg-superficie/80 p-4">
            <h2 className="mb-3 text-sm font-medium text-texto">Lista</h2>
            {agendados.length === 0 ? (
              <p className="py-6 text-center text-sm text-texto-suave">
                Nada previsto neste mês.{" "}
                <Link to="/extrato" className="text-primaria hover:underline">
                  Ver transações
                </Link>
              </p>
            ) : (
              <ul className="divide-y divide-borda">
                {agendados.map((item) => {
                  const vencida = data_na_agenda(item, cartoes) < hoje;
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-texto">{item.descricao}</p>
                        <p className="text-xs text-texto-suave">
                          {item.dataMovimento.slice(8, 10)}/{item.dataMovimento.slice(5, 7)} ·{" "}
                          {rotulo_natureza(item)}
                          {vencida ? " · vencida" : ""}
                        </p>
                      </div>
                      <span className={vencida ? "text-despesa" : "text-texto"}>
                        {formatar_moeda(Number(item.valor))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
