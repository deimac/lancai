import { z } from "zod";
import {
  schemaIntencaoCancelarRecorrencia,
  schemaIntencaoConsultarDadosCartao,
  schemaIntencaoConsultarOrcamento,
  schemaIntencaoConsultarVisao,
  schemaIntencaoCorrigirCartao,
  schemaIntencaoCorrigirConta,
  schemaIntencaoCorrigirMovimento,
  schemaIntencaoCriarCartao,
  schemaIntencaoCriarConta,
  schemaIntencaoCriarRecorrencia,
  schemaIntencaoDefinirOrcamento,
  schemaIntencaoListarRecorrencias,
  schemaIntencaoNaoReconhecida,
  schemaIntencaoRegistrarMovimento,
  schemaIntencaoSolicitarInformacao,
} from "@lancai/tipos";

/** Ramos grosseiros do classificador (schema mínimo → economia de tokens). */
export const RAMOS_INTENCAO = [
  "registrar",
  "consultar",
  "corrigir",
  "cadastro",
  "orcamento",
  "recorrencia",
  "outro",
] as const;
export type RamoIntencao = (typeof RAMOS_INTENCAO)[number];

export const schemaClassificacaoRamo = z.object({
  ramo: z.enum(RAMOS_INTENCAO),
});

export type ClassificacaoRamo = z.infer<typeof schemaClassificacaoRamo>;

/** Schemas parciais por ramo — evita enviar o anyOf completo na extração. */
export function schema_por_ramo(ramo: RamoIntencao) {
  switch (ramo) {
    case "registrar":
      return z.object({
        intencao_detectada: z.discriminatedUnion("intencao", [
          schemaIntencaoRegistrarMovimento,
          schemaIntencaoSolicitarInformacao,
          schemaIntencaoNaoReconhecida,
        ]),
      });
    case "consultar":
      return z.object({
        intencao_detectada: z.discriminatedUnion("intencao", [
          schemaIntencaoConsultarVisao,
          schemaIntencaoConsultarDadosCartao,
          schemaIntencaoConsultarOrcamento,
          schemaIntencaoListarRecorrencias,
          schemaIntencaoNaoReconhecida,
        ]),
      });
    case "corrigir":
      return z.object({
        intencao_detectada: z.discriminatedUnion("intencao", [
          schemaIntencaoCorrigirMovimento,
          schemaIntencaoCorrigirConta,
          schemaIntencaoCorrigirCartao,
          schemaIntencaoNaoReconhecida,
        ]),
      });
    case "cadastro":
      return z.object({
        intencao_detectada: z.discriminatedUnion("intencao", [
          schemaIntencaoCriarConta,
          schemaIntencaoCriarCartao,
          schemaIntencaoCorrigirConta,
          schemaIntencaoCorrigirCartao,
          schemaIntencaoSolicitarInformacao,
          schemaIntencaoNaoReconhecida,
        ]),
      });
    case "orcamento":
      return z.object({
        intencao_detectada: z.discriminatedUnion("intencao", [
          schemaIntencaoDefinirOrcamento,
          schemaIntencaoConsultarOrcamento,
          schemaIntencaoNaoReconhecida,
        ]),
      });
    case "recorrencia":
      return z.object({
        intencao_detectada: z.discriminatedUnion("intencao", [
          schemaIntencaoCriarRecorrencia,
          schemaIntencaoListarRecorrencias,
          schemaIntencaoCancelarRecorrencia,
          schemaIntencaoSolicitarInformacao,
          schemaIntencaoNaoReconhecida,
        ]),
      });
    case "outro":
      return z.object({
        intencao_detectada: schemaIntencaoNaoReconhecida,
      });
  }
}

export function ramo_de_intencao_pendente(
  pendente:
    | "CRIAR_CONTA"
    | "CRIAR_CARTAO"
    | "REGISTRAR_MOVIMENTO"
    | "CRIAR_RECORRENCIA",
): RamoIntencao {
  if (pendente === "REGISTRAR_MOVIMENTO") return "registrar";
  if (pendente === "CRIAR_RECORRENCIA") return "recorrencia";
  return "cadastro";
}

/** Respostas curtas de slot-filling: pula o classificador. */
export function mensagem_parece_resposta_slot(mensagem: string): boolean {
  const texto = mensagem.trim();
  if (!texto) return false;
  if (/\b(gastei|paguei|comprei|recebi|quanto|mostra|cancela|apague|cadastr)\b/i.test(texto)) {
    return false;
  }
  if (texto.length <= 40) return true;
  return /^(sim|n[aã]o|ok|pode|confirmo|fechamento|vencimento|limite|saldo|dia\s*\d)/i.test(texto);
}
