import { createClient } from "@supabase/supabase-js";

/**
 * Valida a senha da conta LançAI (Supabase Auth) sem persistir a senha.
 * Usa signInWithPassword no backend com a chave anônima.
 */
export async function verificar_senha_usuario(email: string, senha: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chave = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !chave) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY não configuradas para validar senha.");
  }

  const supabase = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  return !error;
}
