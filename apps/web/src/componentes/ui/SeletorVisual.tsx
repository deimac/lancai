import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { IconeCategoria } from "../IconeCategoria";
import { unir_classes } from "../../lib/unir-classes";

export type OpcaoSeletorVisual = {
  valor: string;
  rotulo: string;
  icone?: LucideIcon;
  iconeCategoria?: string | null;
  cor?: string | null;
  grupo?: string;
};

type Props = {
  valor: string;
  opcoes: OpcaoSeletorVisual[];
  onChange: (valor: string) => void;
  ariaLabel: string;
  className?: string;
  compacto?: boolean;
};

function MarcaOpcao({ opcao, tamanho = 14 }: { opcao: OpcaoSeletorVisual; tamanho?: number }) {
  if (opcao.iconeCategoria !== undefined || opcao.cor != null) {
    return (
      <IconeCategoria
        icone={opcao.iconeCategoria}
        cor={opcao.cor}
        tamanho={tamanho}
        compacto
      />
    );
  }
  if (opcao.icone) {
    const Icone = opcao.icone;
    return <Icone size={tamanho} className="shrink-0 text-texto-suave" />;
  }
  return null;
}

/**
 * Campo de escolha com ícone/cor — não é `<select>` nativo.
 * A lista vai para o `body` para não ser recortada por overflow.
 */
export function SeletorVisual({
  valor,
  opcoes,
  onChange,
  ariaLabel,
  className,
  compacto = false,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxH: number } | null>(
    null,
  );

  const escolhida = opcoes.find((opcao) => opcao.valor === valor) ?? opcoes[0];

  const posicionar = useCallback(() => {
    const gatilho = gatilhoRef.current;
    if (!gatilho) return;
    const rect = gatilho.getBoundingClientRect();
    const largura = Math.max(rect.width, compacto ? 120 : 180);
    const espacoAbaixo = window.innerHeight - rect.bottom - 8;
    const espacoAcima = rect.top - 8;
    const abrirAcima = espacoAbaixo < 180 && espacoAcima > espacoAbaixo;
    const maxH = Math.max(120, Math.min(320, abrirAcima ? espacoAcima : espacoAbaixo));
    const alturaLista = listaRef.current?.offsetHeight ?? Math.min(240, maxH);
    const top = abrirAcima ? rect.top - Math.min(alturaLista, maxH) - 4 : rect.bottom + 4;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - largura - 8);
    setCoords({ top, left, width: largura, maxH });
  }, [compacto]);

  useLayoutEffect(() => {
    if (!aberto) return;
    posicionar();
  }, [aberto, posicionar, opcoes.length]);

  useEffect(() => {
    if (!aberto) return;
    function fora(evento: MouseEvent) {
      const alvo = evento.target as Node;
      if (gatilhoRef.current?.contains(alvo)) return;
      if (listaRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    window.addEventListener("keydown", tecla);
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto, posicionar]);

  const grupos: Array<{ nome: string | null; itens: OpcaoSeletorVisual[] }> = [];
  for (const opcao of opcoes) {
    const nome = opcao.grupo ?? null;
    const ultimo = grupos[grupos.length - 1];
    if (!ultimo || ultimo.nome !== nome) grupos.push({ nome, itens: [opcao] });
    else ultimo.itens.push(opcao);
  }

  const lista: ReactNode = aberto
    ? createPortal(
        <div
          ref={listaRef}
          role="listbox"
          aria-label={ariaLabel}
          className={unir_classes(
            "fixed z-[90] overflow-y-auto rounded-xl border border-borda bg-superficie py-1 shadow-lg",
            coords ? "visible" : "invisible",
          )}
          style={{
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            width: coords?.width ?? 180,
            maxHeight: coords?.maxH ?? 320,
          }}
        >
          {grupos.map((grupo) => (
            <div key={grupo.nome ?? "__"}>
              {grupo.nome ? (
                <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-texto-suave">
                  {grupo.nome}
                </p>
              ) : null}
              {grupo.itens.map((opcao) => {
                const ativo = opcao.valor === valor;
                return (
                  <button
                    key={opcao.valor}
                    type="button"
                    role="option"
                    aria-selected={ativo}
                    className={unir_classes(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-fundo",
                      ativo ? "text-primaria" : "text-texto",
                    )}
                    onClick={() => {
                      onChange(opcao.valor);
                      setAberto(false);
                    }}
                  >
                    <MarcaOpcao opcao={opcao} />
                    <span className="min-w-0 flex-1 truncate">{opcao.rotulo}</span>
                    {ativo ? <Check size={14} className="shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={gatilhoRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className={unir_classes(
          "inline-flex items-center gap-2 rounded-lg border border-borda bg-superficie text-left text-texto outline-none transition hover:border-primaria/50 focus-visible:border-primaria",
          compacto ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
          className,
        )}
      >
        {escolhida ? <MarcaOpcao opcao={escolhida} tamanho={compacto ? 12 : 14} /> : null}
        <span className="min-w-0 flex-1 truncate">{escolhida?.rotulo ?? ""}</span>
        <ChevronDown size={compacto ? 12 : 14} className="shrink-0 text-texto-suave" />
      </button>
      {lista}
    </>
  );
}
