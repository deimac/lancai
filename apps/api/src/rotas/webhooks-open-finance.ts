import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ErroWebhookInvalido } from "@lancai/open-finance";
import { enriquecer_apos_ingestao } from "../servicos/pos-ingestao-open-finance";
import { obter_servico_ingestao } from "../servicos/open-finance";

/**
 * O provedor manda um header combinado, configurável só por API. Sem segredo
 * configurado a rota fica fechada: webhook aberto é porta para gravar Fato falso
 * no extrato de alguém.
 */
function autorizado(requisicao: FastifyRequest): { ok: true } | { ok: false; motivo: string } {
  const esperado = process.env.OPEN_FINANCE_WEBHOOK_SEGREDO?.trim();
  if (!esperado) return { ok: false, motivo: "OPEN_FINANCE_WEBHOOK_SEGREDO não configurado." };

  const recebido = requisicao.headers["x-lancai-webhook"];
  if (typeof recebido !== "string" || !recebido.trim()) {
    return { ok: false, motivo: "Segredo ausente." };
  }

  return comparar_seguro(recebido.trim(), esperado)
    ? { ok: true }
    : { ok: false, motivo: "Segredo inválido." };
}

function comparar_seguro(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function registrar_rotas_webhooks_open_finance(app: FastifyInstance) {
  app.post("/open-finance", async (requisicao, resposta) => {
    const servico = obter_servico_ingestao();
    if (!servico) {
      return resposta.status(503).send({ erro: "Fonte Open Finance desativada." });
    }

    const permissao = autorizado(requisicao);
    if (!permissao.ok) {
      requisicao.log.warn({ motivo: permissao.motivo }, "[open-finance] webhook rejeitado");
      return resposta.status(401).send({ erro: "Não autorizado." });
    }

    /**
     * Interpretar e gravar o bruto acontece antes da resposta porque é rápido e
     * sem rede, e é o que garante a idempotência: sem o registro, a retentativa
     * do provedor — até nove — processaria o mesmo lote de novo.
     */
    let recebido: Awaited<ReturnType<typeof servico.receber>>;
    try {
      recebido = await servico.receber(requisicao.body);
    } catch (erro) {
      if (erro instanceof ErroWebhookInvalido) {
        requisicao.log.warn({ err: erro }, "[open-finance] corpo não reconhecido");
        return resposta.status(400).send({ erro: "Corpo inválido." });
      }
      throw erro;
    }

    const { novo, interpretado } = recebido;

    // 2XX imediato: o provedor retenta o que passa de cinco segundos.
    await resposta.status(200).send({ ok: true });

    if (!novo) {
      requisicao.log.info(
        { eventoId: interpretado.eventoId },
        "[open-finance] retentativa descartada",
      );
      return;
    }

    try {
      const resumo = await servico.processar(interpretado);
      requisicao.log.info(
        { eventoId: interpretado.eventoId, tipo: interpretado.notificacao.tipo, ...resumo },
        "[open-finance] evento processado",
      );

      await enriquecer_apos_ingestao({
        eventoId: interpretado.eventoId,
        resumo,
        log: requisicao.log,
      });
    } catch (erro) {
      /**
       * O erro já ficou gravado no evento pelo serviço. Não relançamos: a
       * resposta 2XX já saiu, e derrubar o request aqui só polui o log sem dar
       * ao provedor nenhuma informação.
       */
      requisicao.log.error(
        { err: erro, eventoId: interpretado.eventoId },
        "[open-finance] falha ao processar evento",
      );
    }
  });
}
