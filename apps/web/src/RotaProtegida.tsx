import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAutenticacao } from "./contexto/ContextoAutenticacao";
import { Botao } from "./componentes/ui/Botao";

export function RotaProtegida({ children }: { children: ReactNode }) {
  const { sessao, usuario, carregando, erroSincronizacao, tentar_sincronizar_de_novo, sair } =
    useAutenticacao();

  if (carregando) {
    return <div className="flex min-h-screen items-center justify-center text-texto-suave">Carregando...</div>;
  }

  if (!sessao) return <Navigate to="/login" replace />;

  if (!usuario) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-perigo">
          {erroSincronizacao ?? "Não foi possível carregar seu usuário."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Botao onClick={() => void tentar_sincronizar_de_novo()}>Tentar de novo</Botao>
          <Botao variante="fantasma" onClick={() => void sair()}>
            Sair
          </Botao>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
