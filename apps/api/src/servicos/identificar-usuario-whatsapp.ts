import { asc, eq } from "drizzle-orm";
import { obter_banco, usuario as usuarioTabela } from "@lancai/banco";
import { extrair_telefone_whatsapp } from "./telefone-whatsapp";

export type UsuarioWhatsApp = {
  id: string;
  nome: string;
  email: string;
  whatsappNumero: string | null;
};

/**
 * Localiza o usuário LançAI pelo número WhatsApp.
 * Bootstrap: se não houver vínculo e `WHATSAPP_NUMERO_DONO` bater com o número,
 * associa ao usuário do seed (`USUARIO_SEED_EMAIL`) ou ao primeiro usuário ativo.
 */
export async function buscar_usuario_por_whatsapp(
  remoteJidOuNumero: string,
): Promise<UsuarioWhatsApp | null> {
  const numero = extrair_telefone_whatsapp(remoteJidOuNumero);
  if (!numero) return null;

  const banco = obter_banco();
  const [porNumero] = await banco
    .select({
      id: usuarioTabela.id,
      nome: usuarioTabela.nome,
      email: usuarioTabela.email,
      whatsappNumero: usuarioTabela.whatsappNumero,
    })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.whatsappNumero, numero))
    .limit(1);

  if (porNumero) return porNumero;

  const dono = (process.env.WHATSAPP_NUMERO_DONO ?? "").replace(/\D/g, "");
  if (!dono || dono !== numero) return null;

  const emailSeed = process.env.USUARIO_SEED_EMAIL?.trim();
  let candidato: UsuarioWhatsApp | undefined;

  if (emailSeed) {
    const [porEmail] = await banco
      .select({
        id: usuarioTabela.id,
        nome: usuarioTabela.nome,
        email: usuarioTabela.email,
        whatsappNumero: usuarioTabela.whatsappNumero,
      })
      .from(usuarioTabela)
      .where(eq(usuarioTabela.email, emailSeed))
      .limit(1);
    candidato = porEmail;
  }

  if (!candidato) {
    const [primeiro] = await banco
      .select({
        id: usuarioTabela.id,
        nome: usuarioTabela.nome,
        email: usuarioTabela.email,
        whatsappNumero: usuarioTabela.whatsappNumero,
      })
      .from(usuarioTabela)
      .where(eq(usuarioTabela.ativo, true))
      .orderBy(asc(usuarioTabela.dataCriacao))
      .limit(1);
    candidato = primeiro;
  }

  if (!candidato) return null;

  const [atualizado] = await banco
    .update(usuarioTabela)
    .set({ whatsappNumero: numero, dataAtualizacao: new Date() })
    .where(eq(usuarioTabela.id, candidato.id))
    .returning({
      id: usuarioTabela.id,
      nome: usuarioTabela.nome,
      email: usuarioTabela.email,
      whatsappNumero: usuarioTabela.whatsappNumero,
    });

  return atualizado ?? { ...candidato, whatsappNumero: numero };
}
