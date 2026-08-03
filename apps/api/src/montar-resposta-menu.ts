/** Palavras-chave que disparam o atalho de menu/ajuda, sem custo de IA. */
const PALAVRAS_CHAVE_MENU = ["menu", "ajuda", "/menu", "/ajuda", "help"];

export function eh_atalho_menu(mensagem: string): boolean {
  return PALAVRAS_CHAVE_MENU.includes(mensagem.trim().toLowerCase());
}

interface ContagensCadastro {
  totalContas: number;
  totalCartoes: number;
}

/**
 * Texto fixo de ajuda/menu do Lançai. Isolado aqui (em vez de dentro da rota)
 * para ficar fácil de manter e reaproveitar — ex.: nos chips de atalho do
 * frontend, que também podem disparar essa mesma mensagem "menu".
 */
export function montar_resposta_menu(contagens: ContagensCadastro): string {
  const resumoCadastro =
    contagens.totalContas === 0
      ? "Você ainda não tem nenhuma conta cadastrada — que tal começarmos por aí?"
      : `Você tem ${contagens.totalContas} conta(s) e ${contagens.totalCartoes} cartão(ões) cadastrados.`;

  return `**Como o Lançai funciona**
Aqui você não preenche formulários — é só conversar comigo, em português, como se estivesse mandando mensagem para um assistente.

${resumoCadastro}

**O que você pode fazer:**

📥 Registrar receita ou despesa
"Gastei R$ 45 no almoço hoje"
"Recebi R$ 2.500 do João"

🔁 Transferência entre contas
"Transferi R$ 300 do Nubank para o Inter"

🧾 Compra parcelada
"Comprei um notebook de R$ 8.000 em 10x no cartão Nubank"

✏️ Corrigir um lançamento
"Corrige o combustível de ontem para R$ 210"

🏦 Cadastrar conta ou cartão
"Quero cadastrar minha conta Nubank com saldo de R$ 500"
"Cadastra meu cartão Inter, limite 3000, fecha dia 5 e vence dia 12"

📊 Consultas
"Quanto tenho no total?"
"Quanto gastei com alimentação este mês?"
"O que eu lancei hoje?"
"Mostra os dados do cartão Nubank" — pede a senha da conta LançAI antes de revelar

Digite "menu" ou "ajuda" a qualquer momento para ver essas opções de novo.`;
}
