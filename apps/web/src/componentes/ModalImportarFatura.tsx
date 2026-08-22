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
  type TipoDestinoPdf,
} from "../lib/api";
import { formatar_data_curta, formatar_moeda } from "../lib/formatar";
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

function chave_destino(destino: DestinoPdf): string {
  return `${destino.tipo}:${destino.id}`;
}

function aplicar_segundo(linhas: LinhaPreviewPdf[], segundo: DestinoPdf): LinhaPreviewPdf[] {
  return linhas.map((linha) => {
    if (linha.destino) return linha;
    if (linha.destinoSugerido === segundo.tipo) {
      return { ...linha, destino: segundo, aceita: true };
    }
    return linha;
  });
}

export function ModalImportarFatura({
  aberto,
  usuarioId,
  origem,
  contas,
  cartoes,
  aoFechar,
  aoConcluir,
}: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<"arquivo" | "conferir">("arquivo");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewImportacaoPdf | null>(null);
  const [linhas, setLinhas] = useState<LinhaPreviewPdf[]>([]);
  const [segundoId, setSegundoId] = useState("");
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) {
      setEtapa("arquivo");
      setArquivo(null);
      setPreview(null);
      setLinhas([]);
      setSegundoId("");
      setLendo(false);
      setGravando(false);
      setErro(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [aberto]);

  if (!aberto || !origem) return null;
  const destino = origem;

  const destinosManuais: DestinoPdf[] = [
    ...contas
      .filter((conta) => !conta.sincronizada && conta.origem !== "open_finance")
      .map((conta) => ({ tipo: "conta" as const, id: conta.id, nome: conta.nome })),
    ...cartoes
      .filter((cartao) => !cartao.sincronizada && cartao.origem !== "open_finance")
      .map((cartao) => ({ tipo: "cartao" as const, id: cartao.id, nome: cartao.nome })),
  ];

  async function ler_pdf(file: File) {
    setErro(null);
    setLendo(true);
    setArquivo(file);
    setPreview(null);
    setLinhas([]);
    setSegundoId("");
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
      if (!resultado.precisaSegundoDestino) setEtapa("conferir");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível ler o PDF.");
    } finally {
      setLendo(false);
    }
  }

  function continuar_com_par() {
    if (!preview) return;
    const escolhido = preview.candidatosPar.find((item) => chave_destino(item) === segundoId);
    if (!escolhido) {
      setErro("Escolha o segundo destino para as linhas do outro tipo.");
      return;
    }
    setErro(null);
    setLinhas(aplicar_segundo(linhas, escolhido));
    setEtapa("conferir");
  }

  function atualizar_linha(indice: number, patch: Partial<LinhaPreviewPdf>) {
    setLinhas((atual) => atual.map((linha, i) => (i === indice ? { ...linha, ...patch } : linha)));
  }

  function escolher_destino(indice: number, chave: string) {
    const destino = destinosManuais.find((item) => chave_destino(item) === chave) ?? null;
    atualizar_linha(indice, {
      destino,
      aceita: destino != null,
    });
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
          destinoSugerido: linha.destinoSugerido,
          destino: linha.destino!,
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
            Destino: <span className="font-medium text-texto">{destino.nome}</span>
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
              {preview?.precisaSegundoDestino && (
                <label className="flex flex-col gap-1 text-xs text-texto-suave">
                  O PDF tem linhas de {destino.tipo === "conta" ? "cartão" : "conta"}. Qual destino?
                  <select
                    value={segundoId}
                    onChange={(e) => setSegundoId(e.target.value)}
                    className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto"
                  >
                    <option value="">Escolher…</option>
                    {preview.candidatosPar.map((item) => (
                      <option key={chave_destino(item)} value={chave_destino(item)}>
                        {item.tipo === "cartao" ? "Cartão" : "Conta"} · {item.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {etapa === "conferir" && (
            <>
              <p className="text-sm text-texto-suave">
                Desmarque o que não entra. Corrija o destino se a linha for do outro tipo.
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
                      key={`${linha.ocorridoEm}-${linha.descricao}-${indice}`}
                      className="flex flex-col gap-2 rounded-xl border border-borda px-3 py-2 sm:flex-row sm:items-center"
                    >
                      <label className="flex min-w-0 flex-1 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={linha.aceita && Boolean(linha.destino)}
                          disabled={!linha.destino}
                          onChange={(e) =>
                            atualizar_linha(indice, { aceita: e.target.checked })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-texto">{linha.descricao}</span>
                          <span className="text-xs text-texto-suave">
                            {formatar_data_curta(linha.ocorridoEm)} ·{" "}
                            {linha.tipo === "despesa" ? "Saída" : "Entrada"}
                            {linha.parcelamento
                              ? ` · ${linha.parcelamento.numero}/${linha.parcelamento.total}`
                              : ""}
                          </span>
                        </span>
                      </label>
                      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                        <span
                          className={
                            linha.tipo === "despesa"
                              ? "text-sm font-medium tabular-nums text-despesa"
                              : "text-sm font-medium tabular-nums text-receita"
                          }
                        >
                          {formatar_moeda(linha.valor)}
                        </span>
                        <select
                          value={linha.destino ? chave_destino(linha.destino) : ""}
                          onChange={(e) => escolher_destino(indice, e.target.value)}
                          className="max-w-[11rem] rounded-lg border border-borda bg-superficie px-2 py-1 text-xs text-texto"
                        >
                          <option value="">Pular</option>
                          {destinosManuais.map((item) => (
                            <option key={chave_destino(item)} value={chave_destino(item)}>
                              {rotulo_tipo(item.tipo)} · {item.nome}
                            </option>
                          ))}
                        </select>
                      </div>
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
          {etapa === "arquivo" && preview?.precisaSegundoDestino && (
            <Botao type="button" onClick={continuar_com_par} disabled={lendo || !segundoId}>
              Ver linhas
            </Botao>
          )}
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

function rotulo_tipo(tipo: TipoDestinoPdf): string {
  return tipo === "cartao" ? "Cartão" : "Conta";
}
