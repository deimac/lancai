import { createClient } from "@supabase/supabase-js";

export class ErroValidacaoSenhaIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroValidacaoSenhaIndisponivel";
  }
}

/**
 * Valida a senha da conta LançAI (Supabase Auth) sem persistir a senha.
 * Usa signInWithPassword no backend com a chave anônima.
 */
export async function verificar_senha_usuario(email: string, senha: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chave = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !chave) {
    throw new ErroValidacaoSenhaIndisponivel(
      "Validação de senha indisponível: configure SUPABASE_URL e SUPABASE_ANON_KEY na API.",
    );
  }

  try {
    const supabase = createClient(url, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    return !error;
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    throw new ErroValidacaoSenhaIndisponivel(`Falha ao validar senha no Auth: ${detalhe}`);
  }
}
