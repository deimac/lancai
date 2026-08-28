import { useEffect, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Wallet,
} from "lucide-react";
import type { DashboardCartao, DashboardResposta } from "../lib/api";
import { formatar_mes, formatar_moeda } from "../lib/formatar";
import { unir_classes } from "../lib/unir-classes";
import { Drawer } from "./ui/Drawer";

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  dados: DashboardResposta;
  visaoGeral: boolean;
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

function CardCartaoItem({
  cartao,
  mesRotulo,
  aoDetalhar,
}: {
  cartao: DashboardCartao;
  mesRotulo: string;
  aoDetalhar: () => void;
}) {
  const pct = percentual_uso(cartao.comprometido, cartao.limite);
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
        {formatar_moeda(cartao.gastoMes)}{" "}
        <span className="text-xs font-medium text-texto-suave">
          {cartao.gastoEhFaturaAtual ? "fatura atual" : `gasto em ${mesRotulo}`}
        </span>
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
  mesRotulo,
  mesTitulo,
}: {
  cartao: DashboardCartao;
  mesRotulo: string;
  mesTitulo: string;
}) {
  const pct = percentual_uso(cartao.comprometido, cartao.limite);
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
          Posição atual
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

      <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
          {cartao.gastoEhFaturaAtual ? "Fatura atual" : mesTitulo}
        </p>
        <p className="mt-3 text-2xl font-semibold tabular-nums text-despesa">
          {formatar_moeda(cartao.gastoMes)}
        </p>
        <p className="mt-1 text-sm text-texto-suave">
          {cartao.gastoEhFaturaAtual ? "Fatura atual" : `Gasto no mês (${mesRotulo})`}
        </p>
        <p className="mt-3 text-sm text-texto">
          {cartao.quantidadeLancamentos === 0
            ? "Nenhum lançamento neste mês"
            : cartao.quantidadeLancamentos === 1
              ? "1 lançamento"
              : `${cartao.quantidadeLancamentos} lançamentos`}
        </p>
      </section>

      <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">Ciclo</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <p className="flex items-center gap-1.5 text-texto">
            <Calendar size={14} className="text-texto-suave" />
            Fecha dia {cartao.fechamento}
          </p>
          <p className="flex items-center gap-1.5 text-texto">
            <Calendar size={14} className="text-texto-suave" />
            Vence dia {cartao.vencimento}
          </p>
        </div>
        <p className="mt-2 text-xs text-texto-suave">
          Valor da fatura do período não disponível neste painel.
        </p>
      </section>
    </div>
  );
}

export function DrawerCartoesDashboard({ aberto, aoFechar, dados, visaoGeral }: Props) {
  const [cartaoId, setCartaoId] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) setCartaoId(null);
  }, [aberto]);

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

  const mesTitulo = formatar_mes(dados.mes);
  const mesCurto = mesTitulo.split(" ")[0] ?? dados.mes;
  const gastoEhFaturaAtual = cartoes.some((c) => c.gastoEhFaturaAtual);
  const cartaoSelecionado = cartoes.find((c) => c.id === cartaoId) ?? null;

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
          mesRotulo={mesCurto}
          mesTitulo={mesTitulo}
        />
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              {gastoEhFaturaAtual ? "Fatura atual" : mesTitulo}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-despesa">
              {formatar_moeda(gastoMes)}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              {gastoEhFaturaAtual ? "Faturas em aberto" : "Gasto no mês"}
            </p>
            <p className="mt-2 text-sm text-texto">
              {qtdLanc === 0
                ? "Nenhum lançamento em cartão"
                : qtdLanc === 1
                  ? "1 lançamento"
                  : `${qtdLanc} lançamentos`}
            </p>
          </section>

          <section className="rounded-2xl border border-borda bg-fundo/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">
              Posição atual
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
                      mesRotulo={mesCurto}
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
