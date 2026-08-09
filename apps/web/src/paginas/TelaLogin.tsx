import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { MarcaLancai } from "../componentes/MarcaLancai";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { Cartao } from "../componentes/ui/Cartao";

export function TelaLogin() {
  const { sessao, entrar, cadastrar } = useAutenticacao();
  const [modoCadastro, setModoCadastro] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);

  if (sessao) return <Navigate to="/" replace />;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setMensagemSucesso(null);
    setEnviando(true);
    try {
      if (modoCadastro) {
        await cadastrar(nome, email, senha);
        setMensagemSucesso("Conta criada! Se a confirmação por e-mail estiver ativa no Supabase, confira sua caixa de entrada.");
      } else {
        await entrar(email, senha);
      }
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Não foi possível continuar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-fundo px-4">
      <Cartao className="w-full max-w-sm">
        <MarcaLancai link={false} />
        <p className="mt-1 text-sm text-texto-suave">Converse com a sua vida financeira.</p>

        <form onSubmit={enviar} className="mt-6 flex flex-col gap-3">
          {modoCadastro && (
            <Campo placeholder="Seu nome" value={nome} onChange={(evento) => setNome(evento.target.value)} required />
          )}
          <Campo
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            required
          />
          <Campo
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
            minLength={6}
            required
          />

          {erro && <p className="text-sm text-perigo">{erro}</p>}
          {mensagemSucesso && <p className="text-sm text-primaria">{mensagemSucesso}</p>}

          <Botao type="submit" disabled={enviando}>
            {modoCadastro ? "Criar conta" : "Entrar"}
          </Botao>
        </form>

        <button
          type="button"
          onClick={() => setModoCadastro((atual) => !atual)}
          className="mt-4 w-full text-center text-xs text-texto-suave hover:text-texto"
        >
          {modoCadastro ? "Já tenho conta — entrar" : "Ainda não tenho conta — cadastrar"}
        </button>
      </Cartao>
    </div>
  );
}
