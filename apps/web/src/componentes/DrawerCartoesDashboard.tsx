import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Wallet,
} from "lucide-react";
import { ciclo_do_movimento, intervalo_ciclo_fatura } from "@lancai/tipos";
import { clienteApi, type DashboardCartao, type DashboardResposta, type MovimentoResumo } from "../lib/api";
import type { TipoGastoExtrato } from "../lib/filtrar-extrato";
import {
  formatar_intervalo_ciclo,
  formatar_moeda,
  rotulo_faturas_recorte,
} from "../lib/formatar";
import { unir_classes } from "../lib/unir-classes";
import { Drawer } from "./ui/Drawer";

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  dados: DashboardResposta;
  visaoGeral: boolean;
  usuarioId: string;
  tipoGasto: TipoGastoExtrato;
  hrefFaturas: string;
};

function percentual_uso(comprometido: number, limite: number): number | null {
  if (limite <= 0) return null;
  return Math.round((comprometido / limite) * 1000) / 10;
}

function cor_barra(percentual: number | null): string {
  const p = percentual ?? 0;
  if (p >= 80) return "bg-despesa";
  if (p >= 50) return "bg-aviso";
  return "bg-primaria";
}

function BarraUtilizacao({ percentual }: { percentual: number | null }) {
  const largura = Math.min(100, Math.max(0, percentual ?? 0));
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-borda/60">
        <div
          className={unir_classes(
            "h-full rounded-full transition-all duration-300",
            cor_barra(percentual),
          )}
          style={{ width: `${largura}%` }}
        />
      </div>
      {percentual != null ? (
        <p className="mt-1 text-xs text-texto-suave">{percentual.toFixed(1)}% do limite utilizado</p>
      ) : (
        <p className="mt-1 text-xs text-texto-suave">Limite não informado</p>
      )}
    </div>
  );
}

function intervalo_do_cartao(cartao: DashboardCartao): string {
  if (cartao.cicloInicio && cartao.cicloFim) {
    return formatar_intervalo_ciclo(cartao.cicloInicio, cartao.cicloFim);
  }
  const competencia = cartao.competenciaCiclo;
  if (!competencia || !cartao.fechamento) return "";
  const ciclo = intervalo_ciclo_fatura(competencia, cartao.fechamento);
  return formatar_intervalo_ciclo(ciclo.inicio, ciclo.fim);
}

function href_fatura_cartao(base: string, cartaoId: string): string {
  const params = new URLSearchParams(base.startsWith("/extrato?") ? base.slice("/extrato?".length) : "");
  params.set("visao", "faturas");
  params.set("origem", `cartao:${cartaoId}`);
  return `/extrato?${params.toString()}`;
}

function CardCartaoItem({
  cartao,
  rotuloFaturas,
  aoDetalhar,
}: {
  cartao: DashboardCartao;
  rotuloFaturas: string;
  aoDetalhar: () => void;
}) {
  const pct = percentual_uso(cartao.comprometido, cartao.limite);
  const intervalo = intervalo_do_cartao(cartao);
  return (
    <button
      type="button"
      onClick={aoDetalhar}
      className="w-full rounded-2xl border border-borda bg-fundo/40 p-4 text-left transition hover:border-primaria/40 hover:bg-fundo/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaria/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="shrink-0 text-primaria" />
            <p className="truncate font-medium text-texto">{cartao.nome}</p>
          </div>
          <p className="mt-0.5 text-xs text-texto-suave">
            {[cartao.instituicao, cartao.final4 ? `•••• ${cartao.final4}` : null]
              .filter(Boolean)
              .join(" · ") || (cartao.sincronizada ? "Sincronizado" : "Manual")}
          </p>
        </div>
        <span
          className={unir_classes(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            cartao.sincronizada
              ? "bg-primaria/15 text-primaria"
              : "bg-superficie-alta text-texto-suave",
          )}
        >
          {cartao.sincronizada ? "Sincronizado" : "Ativo"}
        </span>
      </div>

      <p className="mt-3 text-lg font-semibold tabular-nums text-despesa">
        {formatar_moeda(cartao.gastoMes)}
      </p>
      <p className="mt-0.5 text-xs text-texto-suave">
        {intervalo ? `${rotuloFaturas} · ${intervalo}` : rotuloFaturas}
      </p>
      <p className="mt-1 text-sm font-medium tabular-nums text-receita">
        {formatar_moeda(cartao.disponivel)} disponível
      </p>
      <p className="mt-1 text-xs text-texto-suave">
        Limite {formatar_moeda(cartao.limite)} · usado {formatar_moeda(cartao.comprometido)}
      </p>
      <BarraUtilizacao percentual={pct} />
      <p className="mt-3 flex items-center gap-1 text-sm font-medium text-primaria">
        Ver detalhes
        <ChevronRight size={14} />
      </p>
    </button>
  );
}

function DetalheCartao({
  cartao,
  rotuloFaturas,
  hrefFaturas,
  lancamentos,
  carregando,
}: {
  cartao: DashboardCartao;
  rotuloFaturas: string;
  hrefFaturas: string;
  lancamentos: MovimentoResumo[];
  carregando: boolean;
}) {
  const pct = percentual_uso(cartao.comprometido, cartao.limite);
  const intervalo = intervalo_do_cartao(cartao);
  const href = href_fatura_cartao(hrefFaturas, cartao.id);
  const soma = lancamentos.reduce((acc, item) => acc + (Number(item.valor) || 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <CreditCard size={20} className="text-primaria" />
          <h3 className="text-xl font-semibold text-texto">{cartao.nome}</h3>
        </div>
        <p className="mt-1 text-sm text-texto-suave">
          {[cartao.instituicao, cartao.final4 ? `•••• ${cartao.final4}` : null]
            .filter(Boolean)
            .join(" · ") || (cartao.sincronizada ? "Sincronizado" : "Cadastrado manualmente")}
        </p>
      </div>

      <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
          {rotuloFaturas}
        </p>
        <p className="mt-3 text-2xl font-semibold tabular-nums text-despesa">
          {formatar_moeda(cartao.gastoMes)}
        </p>
        {intervalo ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-texto-suave">
            <Calendar size={14} />
            {intervalo}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-texto">
          {cartao.quantidadeLancamentos === 0
            ? "Nenhum lançamento neste ciclo"
            : cartao.quantidadeLancamentos === 1
              ? "1 lançamento"
              : `${cartao.quantidadeLancamentos} lançamentos`}
        </p>
        {carregando ? (
          <p className="mt-3 text-xs text-texto-suave">Carregando lançamentos…</p>
        ) : lancamentos.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-borda/70 pt-3">
            {lancamentos.slice(0, 8).map((item) => (
              <li key={item.id} className="flex justify-between gap-2 text-[12px]">
                <span className="truncate text-texto">{item.descricao}</span>
                <span className="shrink-0 tabular-nums text-despesa">
                  {formatar_moeda(Number(item.valor) || 0)}
                </span>
              </li>
            ))}
            {lancamentos.length > 8 ? (
              <li className="text-[11px] text-texto-suave">
                +{lancamentos.length - 8} neste ciclo
              </li>
            ) : null}
            {Math.abs(soma - cartao.gastoMes) < 0.02 ? null : (
              <li className="text-[11px] text-texto-suave">
                Soma desta lista {formatar_moeda(soma)}
              </li>
            )}
          </ul>
        ) : null}
        <Link
          to={href}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primaria hover:underline"
        >
          Ver lançamentos
          <ChevronRight size={14} />
        </Link>
      </section>

      <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
          Limite dos cartões
        </p>
        <dl className="mt-3 space-y-3">
          <div className="flex justify-between gap-3 text-sm">
            <dt className="text-texto-suave">Limite</dt>
            <dd className="font-medium tabular-nums text-texto">{formatar_moeda(cartao.limite)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <dt className="text-texto-suave">Utilizado</dt>
            <dd className="font-medium tabular-nums text-despesa">
              {formatar_moeda(cartao.comprometido)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <dt className="flex items-center gap-1.5 text-texto-suave">
              <Wallet size={14} /> Disponível
            </dt>
            <dd className="font-medium tabular-nums text-receita">
              {formatar_moeda(cartao.disponivel)}
            </dd>
          </div>
        </dl>
        <BarraUtilizacao percentual={pct} />
      </section>
    </div>
  );
}

function perfil_do_tipo_gasto(tipo: TipoGastoExtrato): "pf" | "pj" | null {
  if (tipo === "pessoal") return "pf";
  if (tipo === "empresa") return "pj";
  return null;
}

function no_ciclo_do_cartao(movimento: MovimentoResumo, cartao: DashboardCartao): boolean {
  if (movimento.cartaoId !== cartao.id) return false;
  if (movimento.status === "cancelado") return false;
  if (movimento.papel === "pagamento_fatura") return false;
  if (movimento.possivelRepetido && movimento.ignoradoEmRelatorio) return false;
  const competencia =
    cartao.competenciaCiclo ??
    ciclo_do_movimento(movimento.dataMovimento, cartao.id, cartao.fechamento, {
      vencimento: cartao.vencimento,
      parcelaNumero: movimento.parcelaNumero,
      status: movimento.status,
    });
  return (
    ciclo_do_movimento(movimento.dataMovimento, cartao.id, cartao.fechamento, {
      vencimento: cartao.vencimento,
      parcelaNumero: movimento.parcelaNumero,
      status: movimento.status,
    }) === competencia
  );
}

export function DrawerCartoesDashboard({
  aberto,
  aoFechar,
  dados,
  visaoGeral,
  usuarioId,
  tipoGasto,
  hrefFaturas,
}: Props) {
  const [cartaoId, setCartaoId] = useState<string | null>(null);
  const [movimentos, setMovimentos] = useState<MovimentoResumo[]>([]);
  const [carregandoMov, setCarregandoMov] = useState(false);

  useEffect(() => {
    if (!aberto) setCartaoId(null);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setCarregandoMov(true);
    clienteApi
      .listar_movimentos(usuarioId)
      .then((lista) => {
        if (!cancelado) setMovimentos(lista);
      })
      .catch(() => {
        if (!cancelado) setMovimentos([]);
      })
      .finally(() => {
        if (!cancelado) setCarregandoMov(false);
      });
    return () => {
      cancelado = true;
    };
  }, [aberto, usuarioId]);

  const cartoes = dados.cartoes;
  const n = dados.resumo.quantidadeCartoes ?? cartoes.length;
  const gastoMes =
    dados.resumo.gastoCartoesMes ??
    cartoes.reduce((soma, c) => soma + (c.gastoMes ?? 0), 0);
  const qtdLanc =
    dados.resumo.quantidadeLancamentosCartoesMes ??
    cartoes.reduce((soma, c) => soma + (c.quantidadeLancamentos ?? 0), 0);
  const disponivel =
    dados.resumo.cartoesDisponivel ??
    cartoes.reduce((soma, c) => soma + c.disponivel, 0);
  const usado =
    dados.resumo.cartoesUsado ??
    cartoes.reduce((soma, c) => soma + c.comprometido, 0);
  const limite =
    dados.resumo.cartoesLimite ?? cartoes.reduce((soma, c) => soma + c.limite, 0);
  const pctGlobal =
    dados.resumo.percentualUtilizadoCartoes ?? percentual_uso(usado, limite);

  const gastoEhFaturaAtual = cartoes.some((c) => c.gastoEhFaturaAtual);
  const rotuloFaturas = rotulo_faturas_recorte(gastoEhFaturaAtual);
  const cartaoSelecionado = cartoes.find((c) => c.id === cartaoId) ?? null;
  const perfil = perfil_do_tipo_gasto(tipoGasto);

  const lancamentosDetalhe = useMemo(() => {
    if (!cartaoSelecionado) return [];
    return movimentos
      .filter((item) => {
        if (perfil && item.tipoGasto !== perfil) return false;
        return no_ciclo_do_cartao(item, cartaoSelecionado);
      })
      .sort((a, b) => String(b.dataMovimento).localeCompare(String(a.dataMovimento)));
  }, [movimentos, cartaoSelecionado, perfil]);

  const subtituloLista =
    n === 0
      ? "Nenhum cartão"
      : visaoGeral
        ? n === 1
          ? "1 cartão no total"
          : `${n} cartões no total`
        : n === 1
          ? "1 cartão neste workspace"
          : `${n} cartões neste workspace`;

  return (
    <Drawer
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={cartaoSelecionado ? "Cartão" : "Cartões"}
      subtitulo={cartaoSelecionado ? cartaoSelecionado.nome : subtituloLista}
      cabecalhoExtra={
        cartaoSelecionado ? (
          <button
            type="button"
            onClick={() => setCartaoId(null)}
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-primaria hover:underline"
          >
            <ChevronLeft size={16} />
            Voltar para cartões
          </button>
        ) : null
      }
    >
      {cartaoSelecionado ? (
        <DetalheCartao
          cartao={cartaoSelecionado}
          rotuloFaturas={rotuloFaturas}
          hrefFaturas={hrefFaturas}
          lancamentos={lancamentosDetalhe}
          carregando={carregandoMov}
        />
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              {rotuloFaturas}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-despesa">
              {formatar_moeda(gastoMes)}
            </p>
            <p className="mt-1 text-sm text-texto-suave">cada um no seu ciclo</p>
            <p className="mt-2 text-sm text-texto">
              {qtdLanc === 0
                ? "Nenhum lançamento em cartão"
                : qtdLanc === 1
                  ? "1 lançamento"
                  : `${qtdLanc} lançamentos`}
            </p>
            <Link
              to={hrefFaturas}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primaria hover:underline"
            >
              Ver lançamentos
              <ChevronRight size={14} />
            </Link>
          </section>

          <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Limite dos cartões
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-texto-suave">Utilizado</p>
                <p className="text-base font-semibold tabular-nums text-despesa">
                  {formatar_moeda(usado)}
                </p>
              </div>
              <div>
                <p className="text-xs text-texto-suave">Disponível</p>
                <p className="text-base font-semibold tabular-nums text-receita">
                  {formatar_moeda(disponivel)}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-texto-suave">
              Limite total {formatar_moeda(limite)}
            </p>
            <BarraUtilizacao percentual={pctGlobal} />
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-texto">Seus cartões</h3>
            {cartoes.length === 0 ? (
              <p className="rounded-2xl border border-borda bg-fundo/40 px-4 py-8 text-center text-sm text-texto-suave">
                Nenhum cartão neste escopo.
              </p>
            ) : (
              <ul className="space-y-3">
                {cartoes.map((cartao) => (
                  <li key={cartao.id}>
                    <CardCartaoItem
                      cartao={cartao}
                      rotuloFaturas={rotuloFaturas}
                      aoDetalhar={() => setCartaoId(cartao.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
