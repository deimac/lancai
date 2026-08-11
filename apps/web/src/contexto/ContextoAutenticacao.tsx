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
  /** Falha ao sincronizar o usuário com a API (ex.: banco indisponível). */
  erroSincronizacao: string | null;
  entrar: (email: string, senha: string) => Promise<void>;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  /** Atualiza o usuário em memória após PATCH de Configurações. */
  definir_usuario: (usuario: Usuario) => void;
  tentar_sincronizar_de_novo: () => Promise<void>;
}

const ContextoAutenticacao = createContext<ContextoAutenticacaoValor | undefined>(undefined);

export function AutenticacaoProvedor({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroSincronizacao, setErroSincronizacao] = useState<string | null>(null);

  async function sincronizar_usuario_do_banco(sessaoAtual: Session) {
    try {
      const dados = await clienteApi.sincronizar_usuario({
        id: sessaoAtual.user.id,
        nome:
          (sessaoAtual.user.user_metadata?.nome as string | undefined) ??
          sessaoAtual.user.email ??
          "Usuário",
        email: sessaoAtual.user.email ?? "",
      });
      setUsuario(dados);
      setErroSincronizacao(null);
    } catch (e) {
      setUsuario(null);
      setErroSincronizacao(
        e instanceof Error ? e.message : "Não foi possível carregar seu usuário.",
      );
    }
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
        void sincronizar_usuario_do_banco(novaSessao);
      } else {
        setUsuario(null);
        setErroSincronizacao(null);
      }
    });

    return () => assinatura.subscription.unsubscribe();
  }, []);

  async function tentar_sincronizar_de_novo() {
    if (!sessao) return;
    setCarregando(true);
    await sincronizar_usuario_do_banco(sessao);
    setCarregando(false);
  }

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

  function definir_usuario(proximo: Usuario) {
    setUsuario(proximo);
  }

  return (
    <ContextoAutenticacao.Provider
      value={{
        sessao,
        usuario,
        carregando,
        erroSincronizacao,
        entrar,
        cadastrar,
        sair,
        definir_usuario,
        tentar_sincronizar_de_novo,
      }}
    >
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
