import { eq } from "drizzle-orm";
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
 * Fluxo produto: remoteJid → dígitos → `usuario.whatsapp_numero`.
 */
export async function buscar_usuario_por_whatsapp(
  remoteJidOuNumero: string,
): Promise<UsuarioWhatsApp | null> {
  const numero = extrair_telefone_whatsapp(remoteJidOuNumero);
  if (!numero) return null;

  const banco = obter_banco();
  const [encontrado] = await banco
    .select({
      id: usuarioTabela.id,
      nome: usuarioTabela.nome,
      email: usuarioTabela.email,
      whatsappNumero: usuarioTabela.whatsappNumero,
    })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.whatsappNumero, numero))
    .limit(1);

  return encontrado ?? null;
}
