import { useCallback, useEffect, useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi } from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { formatar_moeda } from "../lib/formatar";
import { IconeCategoria } from "../componentes/IconeCategoria";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";
import { hojeISO } from "@lancai/tipos";

type RecorrenciaUi = Awaited<ReturnType<typeof clienteApi.listar_recorrencias>>[number];
type Compra = Awaited<ReturnType<typeof clienteApi.listar_parcelamentos>>["compras"][number];

export function TelaRecorrentes() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [recorrencias, setRecorrencias] = useState<RecorrenciaUi[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const deps = chave_dependencia(contexto?.versoes, "extrato", "dashboard");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [recs, parcelamentos] = await Promise.all([
        clienteApi.listar_recorrencias(usuario.id),
        clienteApi.listar_parcelamentos(usuario.id, hojeISO()),
      ]);
      setRecorrencias(recs);
      setCompras(parcelamentos.compras);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar recorrentes.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, deps]);

  const totalRecorrente = useMemo(
    () => recorrencias.reduce((soma, item) => soma + item.valor, 0),
    [recorrencias],
  );
  const faltaParcelas = useMemo(
    () => compras.reduce((soma, item) => soma + item.valorRestante, 0),
    [compras],
  );
  const jaPago = useMemo(
    () =>
      compras.reduce(
        (soma, item) => soma + (item.valorTotal - item.valorRestante),
        0,
      ),
    [compras],
  );
  const maxBarra = Math.max(totalRecorrente, faltaParcelas, 1);

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

      {carregando && recorrencias.length === 0 && compras.length === 0 ? (
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
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Repeat size={16} className="text-primaria" />
              Recorrentes
            </h2>
            {recorrencias.length === 0 ? (
              <p className="py-6 text-center text-sm text-texto-suave">
                Nenhuma recorrência ativa. Peça no assistente: “todo mês dia 10 Netflix 55”.
              </p>
            ) : (
              <ul className="divide-y divide-borda">
                {recorrencias.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <IconeCategoria icone={item.icone} cor={item.cor} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-texto">{item.descricao}</p>
                        <p className="text-xs text-texto-suave">
                          Dia {item.diaDoMes}
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

          <section className="rounded-2xl border border-borda bg-superficie/80 p-4">
            <h2 className="mb-3 text-sm font-medium">Parcelados em aberto</h2>
            {compras.length === 0 ? (
              <p className="py-6 text-center text-sm text-texto-suave">Nenhuma compra parcelada em aberto.</p>
            ) : (
              <ul className="space-y-3">
                {compras.map((compra) => {
                  const pct =
                    compra.parcelasTotais > 0
                      ? (compra.parcelasPagas / compra.parcelasTotais) * 100
                      : 0;
                  return (
                    <li
                      key={`${compra.descricao}-${compra.cartaoNome}`}
                      className="rounded-xl border border-borda bg-fundo/40 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-texto">{compra.descricao}</p>
                          <p className="text-xs text-texto-suave">
                            {compra.cartaoNome} · {compra.parcelasPagas}/{compra.parcelasTotais} pagas
                          </p>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums text-despesa">
                          {formatar_moeda(compra.valorRestante)}
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
        </>
      )}
    </div>
  );
}
