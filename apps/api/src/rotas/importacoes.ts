import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import {
  confirmar_importacao_pdf,
  preview_importacao_pdf,
  schemaConfirmarImportacaoPdf,
} from "../servicos/servico-importar-pdf";

const schemaCamposPreview = z.object({
  usuarioId: z.string().uuid(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
});

async function ler_multipart_pdf(requisicao: {
  parts: () => AsyncIterableIterator<{
    type: string;
    fieldname: string;
    value?: unknown;
    toBuffer?: () => Promise<Buffer>;
    filename?: string;
    mimetype?: string;
  }>;
}): Promise<{
  campos: { usuarioId: string; contaId?: string; cartaoId?: string };
  arquivo: Uint8Array;
  nomeArquivo?: string;
}> {
  const campos: Record<string, string> = {};
  let arquivo: Uint8Array | undefined;
  let nomeArquivo: string | undefined;

  for await (const parte of requisicao.parts()) {
    if (parte.type === "file") {
      if (parte.fieldname !== "arquivo") continue;
      const buffer = await parte.toBuffer!();
      arquivo = new Uint8Array(buffer);
      nomeArquivo = parte.filename;
      const mime = parte.mimetype ?? "";
      if (mime && mime !== "application/pdf" && mime !== "application/octet-stream") {
        throw new Error("MIME_PDF");
      }
    } else if (typeof parte.value === "string") {
      campos[parte.fieldname] = parte.value;
    }
  }

  if (!arquivo) {
    throw new Error("ARQUIVO_AUSENTE");
  }

  const parsed = schemaCamposPreview.parse({
    usuarioId: campos.usuarioId,
    contaId: campos.contaId || undefined,
    cartaoId: campos.cartaoId || undefined,
  });

  return { campos: parsed, arquivo, nomeArquivo };
}

export async function registrar_rotas_importacao(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 8 },
  });
  app.post("/pdf", async (requisicao, resposta) => {
    if (!requisicao.isMultipart()) {
      return resposta.status(400).send({ erro: "Envie o PDF em multipart (campo arquivo)." });
    }

    let lido: Awaited<ReturnType<typeof ler_multipart_pdf>>;
    try {
      lido = await ler_multipart_pdf(requisicao);
    } catch (erro) {
      if (erro instanceof Error && erro.message === "ARQUIVO_AUSENTE") {
        return resposta.status(400).send({ erro: "Envie o PDF no campo arquivo." });
      }
      if (erro instanceof Error && erro.message === "MIME_PDF") {
        return resposta.status(400).send({ erro: "O arquivo precisa ser um PDF." });
      }
      throw erro;
    }

    const preview = await preview_importacao_pdf({
      usuarioId: lido.campos.usuarioId,
      contaId: lido.campos.contaId,
      cartaoId: lido.campos.cartaoId,
      arquivo: lido.arquivo,
      nomeArquivo: lido.nomeArquivo,
    });
    return preview;
  });

  app.post("/pdf/confirmar", async (requisicao) => {
    const dados = schemaConfirmarImportacaoPdf.parse(requisicao.body);
    return confirmar_importacao_pdf(dados, { log: requisicao.log });
  });
}
