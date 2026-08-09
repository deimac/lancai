import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ToastSistema } from "../componentes/ui/ToastSistema";

export type TipoAviso = "sucesso" | "erro" | "info";

export type AvisoSistema = {
  id: string;
  tipo: TipoAviso;
  mensagem: string;
};

type ContextoToastValor = {
  avisos: AvisoSistema[];
  avisar: (tipo: TipoAviso, mensagem: string) => void;
  sucesso: (mensagem: string) => void;
  erro: (mensagem: string) => void;
  info: (mensagem: string) => void;
  dispensar: (id: string) => void;
};

const ContextoToast = createContext<ContextoToastValor | undefined>(undefined);

let contador = 0;

export function ToastProvedor({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<AvisoSistema[]>([]);

  const dispensar = useCallback((id: string) => {
    setAvisos((atual) => atual.filter((item) => item.id !== id));
  }, []);

  const avisar = useCallback((tipo: TipoAviso, mensagem: string) => {
    const texto = mensagem.trim();
    if (!texto) return;
    contador += 1;
    const id = `aviso-${Date.now()}-${contador}`;
    setAvisos((atual) => [...atual.slice(-4), { id, tipo, mensagem: texto }]);
  }, []);

  const valor = useMemo<ContextoToastValor>(
    () => ({
      avisos,
      avisar,
      sucesso: (mensagem) => avisar("sucesso", mensagem),
      erro: (mensagem) => avisar("erro", mensagem),
      info: (mensagem) => avisar("info", mensagem),
      dispensar,
    }),
    [avisos, avisar, dispensar],
  );

  return (
    <ContextoToast.Provider value={valor}>
      {children}
      <ToastSistema avisos={avisos} aoDispensar={dispensar} />
    </ContextoToast.Provider>
  );
}

export function useToast(): ContextoToastValor {
  const ctx = useContext(ContextoToast);
  if (!ctx) {
    throw new Error("useToast deve ser usado dentro de ToastProvedor.");
  }
  return ctx;
}
