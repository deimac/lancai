import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";
import { schemaIntencaoRegistrarMovimento, type IntencaoRegistrarMovimento } from "@lancai/tipos";

const schemaVisaoComprovante = z.object({
  intencao_detectada: schemaIntencaoRegistrarMovimento,
});

export type EntradaExtrairComprovante = {
  base64: string;
  mimetype: string;
  caption?: string;
  dataAtual: string;
};

/**
 * Extrai REGISTRAR_MOVIMENTO de foto/PDF de comprovante.
 * Prefere Gemini (visão nativa); fallback Groq com modelo de visão.
 */
export async function extrair_comprovante_visao(
  entrada: EntradaExtrairComprovante,
): Promise<IntencaoRegistrarMovimento> {
  const prompt = `Extraia o lançamento financeiro deste comprovante.
Data de hoje: ${entrada.dataAtual}.
${entrada.caption ? `Legenda do usuário: ${entrada.caption}` : ""}
Preencha intencao REGISTRAR_MOVIMENTO com valor, descricao, tipo_movimento (despesa/receita), data_movimento YYYY-MM-DD se legível.
Se não souber conta/cartão/categoria, deixe null — o sistema pergunta depois.
Responda só o objeto estruturado.`;

  const bytes = Buffer.from(entrada.base64, "base64");
  const mediaType = entrada.mimetype || "image/jpeg";
  const ehPdf = mediaType.toLowerCase().includes("pdf");

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    const modeloId = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
    const model = createGoogleGenerativeAI({ apiKey: geminiKey })(modeloId);
    const conteudoMidia = ehPdf
      ? ({ type: "file" as const, data: bytes, mediaType: "application/pdf" as const })
      : ({ type: "image" as const, image: bytes });
    const resultado = await generateObject({
      model,
      schema: schemaVisaoComprovante,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, conteudoMidia],
        },
      ],
      abortSignal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? "25000") || 25000),
    });
    return resultado.object.intencao_detectada;
  }

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (!groqKey) {
    throw new Error("Nenhum provedor de visão configurado (GEMINI_API_KEY ou GROQ_API_KEY).");
  }
  if (ehPdf) {
    throw new Error(
      "PDF de comprovante exige GEMINI_API_KEY. Envie uma foto do comprovante.",
    );
  }

  const modeloVisao =
    process.env.GROQ_MODEL_VISION?.trim() || "meta-llama/llama-4-scout-17b-16e-instruct";
  const model = createGroq({ apiKey: groqKey })(modeloVisao);
  const resultado = await generateObject({
    model,
    schema: schemaVisaoComprovante,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: bytes, mediaType },
        ],
      },
    ],
    abortSignal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? "25000") || 25000),
    providerOptions: { groq: { strictJsonSchema: false } },
  });
  return resultado.object.intencao_detectada;
}
