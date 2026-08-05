import { EvolutionService, type MidiaWhatsAppResumo } from "@lancai/evolution";
import { extrair_comprovante_visao, transcrever_audio_groq } from "@lancai/ia";
import { hojeISO, type IntencaoDetectada } from "@lancai/tipos";

export type ResultadoMidiaWhatsApp =
  | { ok: true; texto: string; intencaoPrevia?: IntencaoDetectada }
  | { ok: false; mensagemUsuario: string };

let evolutionSingleton: EvolutionService | null = null;

function obter_evolution(): EvolutionService {
  if (!evolutionSingleton) evolutionSingleton = new EvolutionService();
  return evolutionSingleton;
}

/**
 * Baixa mídia Evolution e converte em texto (áudio) ou intenção (foto/PDF).
 */
export async function processar_midia_whatsapp(
  midia: MidiaWhatsAppResumo,
): Promise<ResultadoMidiaWhatsApp> {
  try {
    const baixada = await obter_evolution().obterBase64Midia({
      key: midia.key,
      message: midia.mensagemBruta,
    });
    const mimetype = baixada.mimetype ?? midia.mimetype ?? "application/octet-stream";

    if (midia.tipo === "audio") {
      const texto = await transcrever_audio_groq({
        base64: baixada.base64,
        mimetype,
      });
      console.info(`[midia] áudio transcrito chars=${texto.length}`);
      return { ok: true, texto };
    }

    const intencao = await extrair_comprovante_visao({
      base64: baixada.base64,
      mimetype,
      caption: midia.caption,
      dataAtual: hojeISO(),
    });
    console.info(
      `[midia] comprovante → REGISTRAR_MOVIMENTO valor=${intencao.valor ?? "?"} desc=${intencao.descricao}`,
    );
    const textoFallback =
      midia.caption?.trim() ||
      `Comprovante: ${intencao.descricao}${intencao.valor != null ? ` ${intencao.valor}` : ""}`;
    return { ok: true, texto: textoFallback, intencaoPrevia: intencao };
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    console.warn(`[midia] falha: ${msg.slice(0, 240)}`);
    if (midia.tipo === "audio") {
      return {
        ok: false,
        mensagemUsuario:
          "Não consegui entender o áudio. Pode tentar de novo ou escrever a mensagem?",
      };
    }
    return {
      ok: false,
      mensagemUsuario:
        "Não consegui ler o comprovante. Envie uma foto nítida (ou o valor e a descrição por texto).",
    };
  }
}
