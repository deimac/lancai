import { useEffect, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type ContaResumo,
  type DestinoPdf,
  type LinhaPreviewPdf,
  type PreviewImportacaoPdf,
} from "../lib/api";
import { formatar_moeda } from "../lib/formatar";
import { Botao } from "./ui/Botao";

type Props = {
  aberto: boolean;
  usuarioId: string;
  origem: DestinoPdf | null;
  contas: ContaResumo[];
  cartoes: CartaoResumo[];
  aoFechar: () => void;
  aoConcluir: () => void;
};

export function ModalImportarFatura({
  aberto,
  usuarioId,
  origem,
  aoFechar,
  aoConcluir,
}: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<"arquivo" | "conferir">("arquivo");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewImportacaoPdf | null>(null);
  const [linhas, setLinhas] = useState<LinhaPreviewPdf[]>([]);
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) {
      setEtapa("arquivo");
      setArquivo(null);
      setPreview(null);
      setLinhas([]);
      setLendo(false);
      setGravando(false);
      setErro(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [aberto]);

  if (!aberto || !origem) return null;
  const destino = origem;

  async function ler_pdf(file: File) {
    setErro(null);
    setLendo(true);
    setArquivo(file);
    setPreview(null);
    setLinhas([]);
    setEtapa("arquivo");
    try {
      const resultado = await clienteApi.preview_importacao_pdf({
        usuarioId,
        arquivo: file,
        contaId: destino.tipo === "conta" ? destino.id : undefined,
        cartaoId: destino.tipo === "cartao" ? destino.id : undefined,
      });
      setPreview(resultado);
      setLinhas(resultado.linhas);
      if (resultado.textoInsuficiente) return;
      setEtapa("conferir");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível ler o PDF.");
    } finally {
      setLendo(false);
    }
  }

  function atualizar_linha(indice: number, patch: Partial<LinhaPreviewPdf>) {
    setLinhas((atual) => atual.map((linha, i) => (i === indice ? { ...linha, ...patch } : linha)));
  }

  const aceitas = linhas.filter((linha) => linha.aceita && linha.destino);

  async function confirmar() {
    if (!preview || aceitas.length === 0) return;
    setGravando(true);
    setErro(null);
    try {
      const resultado = await clienteApi.confirmar_importacao_pdf({
        usuarioId,
        arquivoHash: preview.arquivoHash,
        provedor: preview.provedor,
        linhas: aceitas.map((linha) => ({
          ocorridoEm: linha.ocorridoEm,
          descricao: linha.descricao,
          valor: linha.valor,
          tipo: linha.tipo,
          destinoSugerido: destino.tipo,
          destino,
          parcelamento: linha.parcelamento,
        })),
      });
      const partes = [`${resultado.criados} lançamento(s) gravado(s)`];
      if (resultado.duplicados > 0) {
        partes.push(`${resultado.duplicados} já existiam`);
      }
      toast.sucesso(`${partes.join("; ")}.`);
      aoConcluir();
      aoFechar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível gravar a fatura.");
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-borda bg-superficie shadow-xl">
        <div className="flex items-center justify-between border-b border-borda px-4 py-3">
          <h2 className="text-lg font-semibold text-texto">Importar fatura</h2>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1 text-texto-suave hover:bg-superficie-alta hover:text-texto"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <p className="text-sm text-texto-suave">
            Tudo entra em <span className="font-medium text-texto">{destino.nome}</span>
            {destino.tipo === "cartao" ? " (cartão)" : " (conta)"}. PDF digital, com texto — não
            escaneado.
          </p>

          {etapa === "arquivo" && (
            <>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-borda bg-superficie-alta/40 px-4 py-8 text-center">
                <FileUp size={22} className="text-texto-suave" />
                <span className="text-sm text-texto">
                  {arquivo ? arquivo.name : "Escolher PDF"}
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void ler_pdf(file);
                  }}
                />
              </label>
              {lendo && <p className="text-sm text-texto-suave">Lendo o PDF…</p>}
              {preview?.aviso && (
                <p className="rounded-lg border border-aviso/40 bg-aviso/10 px-3 py-2 text-sm text-aviso">
                  {preview.aviso}
                </p>
              )}
            </>
          )}

          {etapa === "conferir" && (
            <>
              <p className="text-sm text-texto-suave">
                Desmarque o que não entra. Corrija descrição, data ou se é saída/entrada.
              </p>
              {preview?.aviso && (
                <p className="rounded-lg border border-aviso/40 bg-aviso/10 px-3 py-2 text-sm text-aviso">
                  {preview.aviso}
                </p>
              )}
              {linhas.length === 0 ? (
                <p className="text-sm text-texto-suave">Não encontrei lançamentos neste PDF.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {linhas.map((linha, indice) => (
                    <li
                      key={indice}
                      className="flex flex-col gap-2 rounded-xl border border-borda px-3 py-2 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={Boolean(linha.aceita && linha.destino)}
                          onChange={(e) =>
                            atualizar_linha(indice, { aceita: e.target.checked })
                          }
                          aria-label="Incluir lançamento"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <input
                            type="text"
                            value={linha.descricao}
                            onChange={(e) =>
                              atualizar_linha(indice, { descricao: e.target.value })
                            }
                            className="w-full rounded-lg border border-borda bg-superficie px-2 py-1 text-sm text-texto"
                            aria-label="Descrição"
                          />
                          <span className="flex flex-wrap items-center gap-2 text-xs text-texto-suave">
                            <input
                              type="date"
                              value={linha.ocorridoEm}
                              onChange={(e) => {
                                if (!e.target.value) return;
                                atualizar_linha(indice, { ocorridoEm: e.target.value });
                              }}
                              className="rounded-md border border-borda bg-superficie px-1.5 py-0.5 text-xs text-texto"
                              aria-label="Data"
                            />
                            <select
                              value={linha.tipo}
                              onChange={(e) =>
                                atualizar_linha(indice, {
                                  tipo: e.target.value === "receita" ? "receita" : "despesa",
                                })
                              }
                              className="rounded-md border border-borda bg-superficie px-1.5 py-0.5 text-xs text-texto"
                              aria-label="Tipo"
                            >
                              <option value="despesa">Saída</option>
                              <option value="receita">Entrada</option>
                            </select>
                            {linha.parcelamento ? (
                              <span>
                                {linha.parcelamento.numero}/{linha.parcelamento.total}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </div>
                      <span
                        className={
                          linha.tipo === "despesa"
                            ? "text-sm font-medium tabular-nums text-despesa"
                            : "text-sm font-medium tabular-nums text-receita"
                        }
                      >
                        {formatar_moeda(linha.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {erro && <p className="text-sm text-perigo">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-borda px-4 py-3">
          <Botao type="button" variante="fantasma" onClick={aoFechar}>
            Cancelar
          </Botao>
          {etapa === "conferir" && (
            <Botao
              type="button"
              onClick={() => void confirmar()}
              disabled={gravando || aceitas.length === 0}
            >
              {gravando ? "Gravando…" : `Confirmar (${aceitas.length})`}
            </Botao>
          )}
        </div>
      </div>
    </div>
  );
}
