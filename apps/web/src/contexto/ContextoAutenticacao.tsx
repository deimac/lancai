import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { clienteSupabase } from "../lib/supabase";
import { clienteApi } from "../lib/api";
import type { Usuario } from "../lib/api";

interface ContextoAutenticacaoValor {
  sessao: Session | null;
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const ContextoAutenticacao = createContext<ContextoAutenticacaoValor | undefined>(undefined);

export function AutenticacaoProvedor({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function sincronizar_usuario_do_banco(sessaoAtual: Session) {
    const dados = await clienteApi.sincronizar_usuario({
      id: sessaoAtual.user.id,
      nome: (sessaoAtual.user.user_metadata?.nome as string | undefined) ?? sessaoAtual.user.email ?? "Usuário",
      email: sessaoAtual.user.email ?? "",
    });
    setUsuario(dados);
  }

  useEffect(() => {
    clienteSupabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      if (data.session) {
        sincronizar_usuario_do_banco(data.session).finally(() => setCarregando(false));
      } else {
        setCarregando(false);
      }
    });

    const { data: assinatura } = clienteSupabase.auth.onAuthStateChange((_evento, novaSessao) => {
      setSessao(novaSessao);
      if (novaSessao) {
        sincronizar_usuario_do_banco(novaSessao);
      } else {
        setUsuario(null);
      }
    });

    return () => assinatura.subscription.unsubscribe();
  }, []);

  async function entrar(email: string, senha: string) {
    const { error } = await clienteSupabase.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;
  }

  async function cadastrar(nome: string, email: string, senha: string) {
    const { error } = await clienteSupabase.auth.signUp({
      email,
      password: senha,
      options: { data: { nome } },
    });
    if (error) throw error;
  }

  async function sair() {
    await clienteSupabase.auth.signOut();
  }

  return (
    <ContextoAutenticacao.Provider value={{ sessao, usuario, carregando, entrar, cadastrar, sair }}>
      {children}
    </ContextoAutenticacao.Provider>
  );
}

export function useAutenticacao(): ContextoAutenticacaoValor {
  const contexto = useContext(ContextoAutenticacao);
  if (!contexto) {
    throw new Error("useAutenticacao precisa ser usado dentro de um AutenticacaoProvedor");
  }
  return contexto;
}
