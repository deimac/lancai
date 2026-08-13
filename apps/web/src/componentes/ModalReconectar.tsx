import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type ContaExternaPreview,
  type ContaResumo,
  type ConexaoDetalhada,
  type PareamentoReatachar,
  type ProgressoImportacaoApi,
} from "../lib/api";
import {
  BarraProgressoImportacao,
  type ProgressoImportacaoUi,
} from "./BarraProgressoImportacao";
import { Botao } from "./ui/Botao";

type Props = {
  aberto: boolean;
  usuarioId: string;
  contas: ContaResumo[];
  cartoes: CartaoResumo[];
  conexoes: ConexaoDetalhada[];
  conexaoId: string | null;
  alvoContaId?: string;
  alvoCartaoId?: string;
  aoFechar: () => void;
  aoConcluir: () => void;
};

function eh_cartao_externo(tipo: string): boolean {
  const t = tipo.toLowerCase();
  return t.includes("credit") || t.includes("card") || t.includes("cartao");
}

function eh_of(item: { origem?: string; sincronizada?: boolean }) {
  return item.origem === "open_finance" || item.sincronizada;
}

export function ModalReconectar({
  aberto,
  usuarioId,
  contas,
  cartoes,
  conexoes,
  conexaoId,
  alvoContaId,
  alvoCartaoId,
  aoFechar,
  aoConcluir,
}: Props) {
  const toast = useToast();
  const conexao = useMemo(
    () => conexoes.find((c) => c.id === conexaoId) ?? null,
    [conexoes, conexaoId],
  );
  const [itemId, setItemId] = useState("");
  const [passo, setPasso] = useState<"item" | "parear">("item");
  const [instituicao, setInstituicao] = useState<string | null>(null);
  const [externas, setExternas] = useState<ContaExternaPreview[]>([]);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<ProgressoImportacaoUi | null>(null);

  const contasCandidatas = useMemo(() => {
    const daConexao = conexaoId
      ? contas.filter((c) => c.conexaoId === conexaoId)
      : [];
    const orfas = contas.filter((c) => eh_of(c) && !c.conexaoId);
    const alvo = alvoContaId ? contas.filter((c) => c.id === alvoContaId) : [];
    const porId = new Map([...daConexao, ...orfas, ...alvo].map((c) => [c.id, c]));
    return [...porId.values()];
  }, [contas, conexaoId, alvoContaId]);

  const cartoesCandidatos = useMemo(() => {
    const daConexao = conexaoId
      ? cartoes.filter((c) => c.conexaoId === conexaoId)
      : [];
    const orfas = cartoes.filter((c) => eh_of(c) && !c.conexaoId);
    const alvo = alvoCartaoId ? cartoes.filter((c) => c.id === alvoCartaoId) : [];
    const porId = new Map([...daConexao, ...orfas, ...alvo].map((c) => [c.id, c]));
    return [...porId.values()];
  }, [cartoes, conexaoId, alvoCartaoId]);

  useEffect(() => {
    if (!aberto) return;
    setItemId(conexao?.idExterno ?? "");
    setPasso("item");
    setInstituicao(conexao?.instituicao ?? null);
    setExternas([]);
    setMapa({});
    setOcupado(false);
    setProgresso(null);
  }, [aberto, conexao]);

  if (!aberto) return null;

  async function inspecionar() {
    const id = itemId.trim();
    if (!id) {
      toast.erro("Informe o itemId do banco.");
      return;
    }
    setOcupado(true);
    try {
      const preview = await clienteApi.inspecionar_item({
        usuarioId,
        conexaoExterna: id,
      });
      setInstituicao(preview.instituicao);
      setExternas(preview.contas);
      const inicial: Record<string, string> = {};
      for (const c of preview.contas) {
        const cartao = eh_cartao_externo(c.tipo);
        const candidatos = cartao ? cartoesCandidatos : contasCandidatas;
        const alvoId = cartao ? alvoCartaoId : alvoContaId;
        const alvo = alvoId ? candidatos.find((local) => local.id === alvoId) : undefined;
        const porNome = candidatos.find(
          (local) => local.nome.toLowerCase() === c.nome.toLowerCase(),
        );
        const escolhido =
          alvo && (!porNome || porNome.id === alvo.id || candidatos.length === 1)
            ? alvo
            : porNome;
        if (escolhido) {
          inicial[c.idExterno] = cartao ? `cartao:${escolhido.id}` : `conta:${escolhido.id}`;
        } else if (candidatos.length === 1) {
          const unico = candidatos[0]!;
          inicial[c.idExterno] = cartao ? `cartao:${unico.id}` : `conta:${unico.id}`;
        } else {
          inicial[c.idExterno] = "";
        }
      }
      setMapa(inicial);
      setPasso("parear");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível ler o item.");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    const pareamentos: PareamentoReatachar[] = [];
    for (const ext of externas) {
      const valor = mapa[ext.idExterno] ?? "";
      if (!valor) continue;
      const [tipo, id] = valor.split(":");
      if (tipo === "conta") pareamentos.push({ contaExternaId: ext.idExterno, contaId: id });
      else if (tipo === "cartao") pareamentos.push({ contaExternaId: ext.idExterno, cartaoId: id });
    }

    setOcupado(true);
    setProgresso({ percentual: 2, mensagem: "Reconectando…" });
    try {
      const { resumo } = await clienteApi.reatachar_conexao(
        {
          usuarioId,
          conexaoExterna: itemId.trim(),
          pareamentos,
          conexaoId: conexaoId || undefined,
          alvoContaId,
          alvoCartaoId,
        },
        (p: ProgressoImportacaoApi) => {
          setProgresso({
            percentual: p.percentual,
            mensagem: p.mensagem,
            criados: p.criados,
          });
        },
      );
      const partes = [
        `${resumo.criados} novo(s)`,
        resumo.duplicados > 0 ? `${resumo.duplicados} já existente(s)` : null,
        (resumo.puladosSemanticos ?? 0) > 0
          ? `${resumo.puladosSemanticos} pulado(s) (já no extrato)`
          : null,
      ].filter(Boolean);
      toast.sucesso(
        `Banco reconectado${instituicao ? ` · ${instituicao}` : ""}. ${partes.join(" · ")}.`,
      );
      aoConcluir();
      aoFechar();
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Falha ao reconectar.");
    } finally {
      setOcupado(false);
      setProgresso(null);
    }
  }

  const alvoNome =
    cartoes.find((c) => c.id === alvoCartaoId)?.nome ??
    contas.find((c) => c.id === alvoContaId)?.nome;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-borda bg-superficie shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-borda px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-texto">
              {conexaoId ? "Reconectar banco" : "Conectar banco"}
            </p>
            <p className="text-xs text-texto-suave">
              {conexaoId
                ? `${conexao?.instituicao ?? alvoNome ?? "Instituição"} — religa o mesmo cartão/conta, sem duplicar`
                : "Cole o itemId do Meu Pluggy. Contas e cartões já existentes são religados, sem duplicar."}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-texto-suave hover:bg-fundo"
            onClick={aoFechar}
            disabled={ocupado}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {passo === "item" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-texto-suave">ItemId (Meu Pluggy)</span>
              <input
                className="rounded-lg border border-borda bg-superficie-alta px-3 py-2 text-texto"
                value={itemId}
                disabled={ocupado}
                onChange={(e) => setItemId(e.target.value)}
                placeholder="uuid do item"
              />
            </label>
          )}

          {passo === "parear" && (
            <>
              <p className="text-sm text-texto">
                {instituicao ?? "Instituição"} — deixe em branco para associar automaticamente.
                Recurso realmente novo vira conta ou cartão local.
              </p>
              <ul className="flex flex-col gap-3">
                {externas.map((ext) => {
                  const cartao = eh_cartao_externo(ext.tipo);
                  const opcoes = cartao ? cartoesCandidatos : contasCandidatas;
                  return (
                    <li
                      key={ext.idExterno}
                      className="rounded-xl border border-borda bg-fundo/40 px-3 py-2"
                    >
                      <p className="text-sm font-medium text-texto">{ext.nome}</p>
                      <p className="text-xs text-texto-suave">
                        {cartao ? "Cartão" : "Conta"} · {ext.tipo}
                      </p>
                      <select
                        className="mt-2 w-full rounded-lg border border-borda bg-superficie-alta px-3 py-2 text-sm text-texto"
                        value={mapa[ext.idExterno] ?? ""}
                        disabled={ocupado}
                        onChange={(e) =>
                          setMapa((m) => ({ ...m, [ext.idExterno]: e.target.value }))
                        }
                      >
                        <option value="">Associar automaticamente</option>
                        {opcoes.map((local) => (
                          <option
                            key={local.id}
                            value={cartao ? `cartao:${local.id}` : `conta:${local.id}`}
                          >
                            {local.nome}
                            {local.instituicao ? ` · ${local.instituicao}` : ""}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
              <BarraProgressoImportacao progresso={progresso} />
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-borda px-4 py-3">
          {passo === "parear" && (
            <Botao variante="fantasma" disabled={ocupado} onClick={() => setPasso("item")}>
              Voltar
            </Botao>
          )}
          <Botao variante="fantasma" disabled={ocupado} onClick={aoFechar}>
            Cancelar
          </Botao>
          {passo === "item" ? (
            <Botao disabled={ocupado || !itemId.trim()} onClick={() => void inspecionar()}>
              {ocupado ? "Lendo…" : "Continuar"}
            </Botao>
          ) : (
            <Botao disabled={ocupado} onClick={() => void confirmar()}>
              {ocupado ? "Sincronizando…" : "Reconectar e sincronizar"}
            </Botao>
          )}
        </div>
      </div>
    </div>
  );
}
