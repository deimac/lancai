import { eq } from "drizzle-orm";
import { obter_banco } from "./cliente";
import { usuario, categoria } from "./schema";

const CATEGORIAS_PADRAO: Array<{ nome: string; tipo: "receita" | "despesa" | "ambos" }> = [
  { nome: "Alimentação", tipo: "despesa" },
  { nome: "Combustível", tipo: "despesa" },
  { nome: "Transporte", tipo: "despesa" },
  { nome: "Moradia", tipo: "despesa" },
  { nome: "Saúde", tipo: "despesa" },
  { nome: "Lazer", tipo: "despesa" },
  { nome: "Assinaturas", tipo: "despesa" },
  { nome: "Viagens", tipo: "despesa" },
  { nome: "Educação", tipo: "despesa" },
  { nome: "Impostos", tipo: "despesa" },
  { nome: "Salário", tipo: "receita" },
  { nome: "Vendas", tipo: "receita" },
  { nome: "Serviços prestados", tipo: "receita" },
  { nome: "Outros", tipo: "ambos" },
];

async function semear() {
  const banco = obter_banco();

  const nomeUsuarioSeed = process.env.USUARIO_SEED_NOME ?? "Usuário LançAI";
  const emailUsuarioSeed = process.env.USUARIO_SEED_EMAIL;

  if (!emailUsuarioSeed) {
    console.error(
      "Defina USUARIO_SEED_EMAIL no ambiente para popular categorias padrão para o seu usuário.",
    );
    process.exit(1);
  }

  const [usuarioExistente] = await banco
    .select()
    .from(usuario)
    .where(eq(usuario.email, emailUsuarioSeed))
    .limit(1);

  const usuarioAtual =
    usuarioExistente ??
    (
      await banco
        .insert(usuario)
        .values({ nome: nomeUsuarioSeed, email: emailUsuarioSeed })
        .returning()
    )[0];

  if (!usuarioAtual) {
    throw new Error("Não foi possível criar ou localizar o usuário para o seed.");
  }

  console.log(`Semeando categorias padrão para ${usuarioAtual.email}...`);

  const categoriasExistentes = await banco
    .select({ nome: categoria.nome })
    .from(categoria)
    .where(eq(categoria.usuarioId, usuarioAtual.id));

  const nomesExistentes = new Set(categoriasExistentes.map((c) => c.nome));

  const categoriasFaltantes = CATEGORIAS_PADRAO.filter(
    (categoriaPadrao) => !nomesExistentes.has(categoriaPadrao.nome),
  );

  if (categoriasFaltantes.length > 0) {
    await banco.insert(categoria).values(
      categoriasFaltantes.map((categoriaPadrao) => ({
        nome: categoriaPadrao.nome,
        tipo: categoriaPadrao.tipo,
        usuarioId: usuarioAtual.id,
      })),
    );
  }

  console.log("Seed concluído.");
}

semear()
  .catch((erro) => {
    console.error("Falha ao executar o seed:", erro);
    process.exit(1);
  })
  .finally(() => process.exit(0));
