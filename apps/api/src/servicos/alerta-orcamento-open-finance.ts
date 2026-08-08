import { inArray } from "drizzle-orm";
import { movimento, obter_banco, usuario } from "@lancai/banco";
import { Memoria, RepositorioMemoriaDrizzle } from "@lancai/conhecimento";
import { EvolutionService } from "@lancai/evolution";
import { hojeISO } from "@lancai/tipos";
import {
  alertas_de_status_orcamento,
  listar_status_orcamentos,
  type AlertaOrcamento,
} from "./orcamento-servico";

type EnviarWhatsApp = (entrada: { numero: string; texto: string }) => Promise<unknown>;

const PREFIXO_HABITO = "alerta_orcamento";

export function chave_habito_alerta_orcamento(orcamentoId: string, mes: string): string {
  return `${PREFIXO_HABITO}:${orcamentoId}:${mes}`;
}

function faixa_numerica(faixa: AlertaOrcamento["faixa"]): number {
  return faixa;
}

/** Mantém só faixas novas (ou mais altas) em relação ao hábito do mês. */
export async function filtrar_alertas_ainda_nao_enviados(
  usuarioId: string,
  mes: string,
  candidatos: AlertaOrcamento[],
  memoria: Memoria,
): Promise<AlertaOrcamento[]> {
  const aEnviar: AlertaOrcamento[] = [];
  for (const alerta of candidatos) {
    const chave = chave_habito_alerta_orcamento(alerta.orcamentoId, mes);
    const ja = await memoria.buscar_habito(usuarioId, chave);
    const jaFaixa = ja === "80" || ja === "100" ? Number(ja) : 0;
    if (faixa_numerica(alerta.faixa) <= jaFaixa) continue;
    aEnviar.push(alerta);
  }
  return aEnviar;
}

/**
 * Após ingestão OF + classificação: avisa no WhatsApp se algum orçamento
 * cruzou 80% ou 100%. Idempotente por orçamento/mês (só sobe a faixa).
 */
export async function avisar_orcamentos_apos_movimentos(entrada: {
  movimentoIds: string[];
  dataAtual?: string;
  enviar?: EnviarWhatsApp;
  memoria?: Memoria;
}): Promise<{
  usuarios: number;
  enviados: number;
  pulados: number;
  falhas: number;
}> {
  const resultado = { usuarios: 0, enviados: 0, pulados: 0, falhas: 0 };
  if (entrada.movimentoIds.length === 0) return resultado;

  const dataAtual = entrada.dataAtual ?? hojeISO();
  const mes = dataAtual.slice(0, 7);
  const memoria = entrada.memoria ?? new Memoria(new RepositorioMemoriaDrizzle());
  const enviar =
    entrada.enviar ??
    ((dados) => new EvolutionService().enviarMensagemWhatsApp(dados));

  const banco = obter_banco();
  const movimentos = await banco
    .select({
      id: movimento.id,
      usuarioId: movimento.usuarioId,
      tipo: movimento.tipo,
      status: movimento.status,
      categoriaId: movimento.categoriaId,
      ignoradoEmRelatorio: movimento.ignoradoEmRelatorio,
    })
    .from(movimento)
    .where(inArray(movimento.id, entrada.movimentoIds));

  const despesas = movimentos.filter(
    (m) => m.tipo === "despesa" && m.status !== "cancelado" && !m.ignoradoEmRelatorio,
  );
  if (despesas.length === 0) return resultado;

  const porUsuario = new Map<string, Set<string>>();
  for (const m of despesas) {
    let set = porUsuario.get(m.usuarioId);
    if (!set) {
      set = new Set();
      porUsuario.set(m.usuarioId, set);
    }
    set.add(m.categoriaId);
  }

  const usuarioIds = [...porUsuario.keys()];
  const usuarios = await banco
    .select({
      id: usuario.id,
      nome: usuario.nome,
      whatsappNumero: usuario.whatsappNumero,
    })
    .from(usuario)
    .where(inArray(usuario.id, usuarioIds));

  const whatsappPorId = new Map(
    usuarios
      .filter((u) => u.whatsappNumero)
      .map((u) => [u.id, { nome: u.nome, numero: u.whatsappNumero! }] as const),
  );

  for (const [usuarioId, categorias] of porUsuario) {
    const destino = whatsappPorId.get(usuarioId);
    if (!destino) continue;
    resultado.usuarios += 1;

    let status;
    try {
      status = await listar_status_orcamentos(usuarioId, dataAtual);
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      if (/orcamento|does not exist|42P01/i.test(msg)) {
        resultado.pulados += 1;
        continue;
      }
      throw erro;
    }

    const relevantes = status.filter(
      (s) => !s.orcamento.categoriaId || categorias.has(s.orcamento.categoriaId),
    );
    const candidatos = alertas_de_status_orcamento(relevantes);
    if (candidatos.length === 0) {
      resultado.pulados += 1;
      continue;
    }

    const aEnviar = await filtrar_alertas_ainda_nao_enviados(
      usuarioId,
      mes,
      candidatos,
      memoria,
    );

    if (aEnviar.length === 0) {
      resultado.pulados += 1;
      continue;
    }

    const porOrcamento = new Map<string, AlertaOrcamento>();
    for (const alerta of aEnviar) {
      const atual = porOrcamento.get(alerta.orcamentoId);
      if (!atual || faixa_numerica(alerta.faixa) > faixa_numerica(atual.faixa)) {
        porOrcamento.set(alerta.orcamentoId, alerta);
      }
    }

    const textos = [...porOrcamento.values()].map((a) => a.texto);
    const primeiroNome = destino.nome.trim().split(/\s+/)[0] || "Olá";
    const corpo = `${primeiroNome}, atualizei seu extrato do banco.\n\n${textos.join("\n")}`;

    try {
      await enviar({ numero: destino.numero, texto: corpo });
      for (const alerta of porOrcamento.values()) {
        await memoria.salvar_habito(
          usuarioId,
          chave_habito_alerta_orcamento(alerta.orcamentoId, mes),
          String(alerta.faixa),
        );
      }
      resultado.enviados += 1;
    } catch {
      resultado.falhas += 1;
    }
  }

  return resultado;
}
