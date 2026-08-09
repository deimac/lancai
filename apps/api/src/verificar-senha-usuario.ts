export class ErroValidacaoSenhaIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroValidacaoSenhaIndisponivel";
  }
}

/**
 * Valida a senha da conta LançAI (Supabase Auth) sem persistir a senha.
 * Usa o endpoint REST de password grant — evita supabase-js/WebSocket no Node < 22.
 */
export async function verificar_senha_usuario(email: string, senha: string): Promise<boolean> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const chave = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !chave) {
    throw new ErroValidacaoSenhaIndisponivel(
      "Validação de senha indisponível: configure SUPABASE_URL e SUPABASE_ANON_KEY na API.",
    );
  }

  try {
    const resposta = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: senha }),
    });

    // 200 = senha ok; 400/401 = credencial inválida (não é falha de infra).
    if (resposta.ok) return true;
    if (resposta.status === 400 || resposta.status === 401) return false;

    const corpo = await resposta.text().catch(() => "");
    throw new ErroValidacaoSenhaIndisponivel(
      `Auth respondeu ${resposta.status}${corpo ? `: ${corpo.slice(0, 200)}` : ""}`,
    );
  } catch (erro) {
    if (erro instanceof ErroValidacaoSenhaIndisponivel) throw erro;
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    throw new ErroValidacaoSenhaIndisponivel(`Falha ao validar senha no Auth: ${detalhe}`);
  }
}
