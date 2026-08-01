import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAutenticacao } from "./contexto/ContextoAutenticacao";

export function RotaProtegida({ children }: { children: ReactNode }) {
  const { sessao, carregando } = useAutenticacao();

  if (carregando) {
    return <div className="flex min-h-screen items-center justify-center text-texto-suave">Carregando...</div>;
  }

  if (!sessao) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
