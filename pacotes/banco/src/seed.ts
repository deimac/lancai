import { eq } from "drizzle-orm";
import { CATEGORIAS_PADRAO } from "./categorias-padrao";
import { obter_banco } from "./cliente";
import { usuario, categoria } from "./schema";

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

  const nomesExistentes = new Set(
    categoriasExistentes.map((item) => item.nome.toLocaleLowerCase("pt-BR")),
  );

  const categoriasFaltantes = CATEGORIAS_PADRAO.filter(
    (categoriaPadrao) => !nomesExistentes.has(categoriaPadrao.nome.toLocaleLowerCase("pt-BR")),
  );

  if (categoriasFaltantes.length > 0) {
    await banco.insert(categoria).values(
      categoriasFaltantes.map((categoriaPadrao) => ({
        nome: categoriaPadrao.nome,
        tipo: categoriaPadrao.tipo,
        icone: categoriaPadrao.icone,
        cor: categoriaPadrao.cor,
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
