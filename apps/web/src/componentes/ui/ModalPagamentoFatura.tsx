import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CartaoResumo } from "../../lib/api";
import { opcoes_competencia } from "../../lib/extrato-pagamento-fatura";
import { Botao } from "./Botao";

type Props = {
  aberto: boolean;
  cartoes: CartaoResumo[];
  cartaoIdInicial: string | null;
  competenciaInicial: string;
  confirmando?: boolean;
  aoCancelar: () => void;
  aoConfirmar: (cartaoId: string, competencia: string) => void;
};

export function ModalPagamentoFatura({
  aberto,
  cartoes,
  cartaoIdInicial,
  competenciaInicial,
  confirmando = false,
  aoCancelar,
  aoConfirmar,
}: Props) {
  const [cartaoId, setCartaoId] = useState(cartaoIdInicial ?? "");
  const [competencia, setCompetencia] = useState(competenciaInicial);
  const meses = opcoes_competencia(`${competenciaInicial}-01`);

  useEffect(() => {
    if (!aberto) return;
    setCartaoId(cartaoIdInicial ?? "");
    setCompetencia(competenciaInicial);
  }, [aberto, cartaoIdInicial, competenciaInicial]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onClick={aoCancelar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-pagamento-fatura-titulo"
        className="w-full max-w-sm rounded-2xl border border-borda bg-superficie p-5 shadow-xl"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="modal-pagamento-fatura-titulo" className="text-lg font-semibold text-texto">
            Pagamento de fatura
          </h2>
          <button
            type="button"
            onClick={aoCancelar}
            className="rounded-lg p-1 text-texto-suave hover:bg-superficie-alta hover:text-texto"
            aria-label="Fechar"
            disabled={confirmando}
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm text-texto-suave">
          Qual cartão e a fatura que este lançamento quitou? Em geral é a que vence neste mês (compras
          do ciclo anterior).
        </p>
        <label className="mb-3 block text-xs font-medium text-texto-suave">
          Cartão
          <select
            className="mt-1 w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
            value={cartaoId}
            onChange={(evento) => setCartaoId(evento.target.value)}
            disabled={confirmando}
          >
            <option value="">Selecione</option>
            {cartoes.map((cartao) => (
              <option key={cartao.id} value={cartao.id}>
                {cartao.nome}
                {cartao.workspaceNome ? ` · ${cartao.workspaceNome}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-4 block text-xs font-medium text-texto-suave">
          Fatura que vence em
          <select
            className="mt-1 w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
            value={competencia}
            onChange={(evento) => setCompetencia(evento.target.value)}
            disabled={confirmando}
          >
            {meses.map((mes) => (
              <option key={mes.valor} value={mes.valor}>
                {mes.rotulo}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Botao variante="fantasma" type="button" onClick={aoCancelar} disabled={confirmando}>
            Cancelar
          </Botao>
          <Botao
            variante="primaria"
            type="button"
            disabled={confirmando || !cartaoId || !competencia}
            onClick={() => aoConfirmar(cartaoId, competencia)}
          >
            {confirmando ? "Aguarde..." : "Confirmar"}
          </Botao>
        </div>
      </div>
    </div>
  );
}
