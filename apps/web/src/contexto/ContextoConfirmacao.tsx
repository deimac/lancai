import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ModalConfirmacao,
  type PedidoConfirmacao,
} from "../componentes/ui/ModalConfirmacao";

type ContextoConfirmacaoValor = {
  confirmar: (pedido: PedidoConfirmacao) => Promise<boolean>;
};

const ContextoConfirmacao = createContext<ContextoConfirmacaoValor | undefined>(undefined);

export function ConfirmacaoProvedor({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null);
  const resolverRef = useRef<((valor: boolean) => void) | null>(null);

  const fechar = useCallback((valor: boolean) => {
    resolverRef.current?.(valor);
    resolverRef.current = null;
    setPedido(null);
  }, []);

  const confirmar = useCallback((proximo: PedidoConfirmacao) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setPedido(proximo);
    });
  }, []);

  const valor = useMemo(() => ({ confirmar }), [confirmar]);

  return (
    <ContextoConfirmacao.Provider value={valor}>
      {children}
      <ModalConfirmacao
        aberto={Boolean(pedido)}
        pedido={pedido}
        aoCancelar={() => fechar(false)}
        aoConfirmar={() => fechar(true)}
      />
    </ContextoConfirmacao.Provider>
  );
}

export function useConfirmacao(): ContextoConfirmacaoValor {
  const ctx = useContext(ContextoConfirmacao);
  if (!ctx) {
    throw new Error("useConfirmacao deve ser usado dentro de ConfirmacaoProvedor.");
  }
  return ctx;
}
