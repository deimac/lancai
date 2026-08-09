import { X } from "lucide-react";
import { Botao } from "./Botao";

export type PedidoConfirmacao = {
  titulo: string;
  mensagem: string;
  confirmarRotulo?: string;
  cancelarRotulo?: string;
  perigo?: boolean;
};

type Props = {
  aberto: boolean;
  pedido: PedidoConfirmacao | null;
  confirmando?: boolean;
  aoCancelar: () => void;
  aoConfirmar: () => void;
};

export function ModalConfirmacao({
  aberto,
  pedido,
  confirmando = false,
  aoCancelar,
  aoConfirmar,
}: Props) {
  if (!aberto || !pedido) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onClick={aoCancelar}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modal-confirmacao-titulo"
        aria-describedby="modal-confirmacao-mensagem"
        className="w-full max-w-md rounded-2xl border border-borda bg-superficie p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="modal-confirmacao-titulo" className="text-lg font-semibold text-texto">
            {pedido.titulo}
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

        <p id="modal-confirmacao-mensagem" className="text-sm leading-relaxed text-texto-suave">
          {pedido.mensagem}
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <Botao variante="fantasma" type="button" onClick={aoCancelar} disabled={confirmando}>
            {pedido.cancelarRotulo ?? "Cancelar"}
          </Botao>
          <Botao
            variante={pedido.perigo === false ? "primaria" : "perigo"}
            type="button"
            onClick={aoConfirmar}
            disabled={confirmando}
          >
            {confirmando ? "Aguarde..." : (pedido.confirmarRotulo ?? "Excluir")}
          </Botao>
        </div>
      </div>
    </div>
  );
}
