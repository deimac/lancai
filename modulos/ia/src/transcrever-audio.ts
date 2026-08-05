/**
 * Transcrição de áudio via Groq Whisper (OpenAI-compatible).
 * Economia: Whisper é barato vs. LLM de intenção.
 */

export type EntradaTranscreverAudio = {
  base64: string;
  mimetype?: string;
  /** Idioma BCP-47; padrão pt. */
  idioma?: string;
};

function extensao_de_mimetype(mimetype?: string): string {
  const mime = (mimetype ?? "").toLowerCase();
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("webm")) return "webm";
  return "ogg";
}

export async function transcrever_audio_groq(entrada: EntradaTranscreverAudio): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY não configurada para transcrição de áudio.");
  }

  const modelo = process.env.GROQ_MODEL_WHISPER?.trim() || "whisper-large-v3-turbo";
  const bytes = Buffer.from(entrada.base64, "base64");
  const ext = extensao_de_mimetype(entrada.mimetype);
  const blob = new Blob([bytes], { type: entrada.mimetype || `audio/${ext}` });

  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", modelo);
  form.append("language", entrada.idioma ?? "pt");
  form.append("response_format", "json");

  const resposta = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");
    throw new Error(`Groq Whisper falhou (${resposta.status}): ${detalhe.slice(0, 300)}`);
  }

  const json = (await resposta.json()) as { text?: string };
  const texto = json.text?.trim();
  if (!texto) {
    throw new Error("Groq Whisper devolveu transcrição vazia.");
  }
  return texto;
}
