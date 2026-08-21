import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { unir_classes } from "../../lib/unir-classes";

export type ItemSubmenu = {
  rotulo: string;
  onClick: () => void;
  ativo?: boolean;
};

export type AcaoMenu = {
  rotulo: string;
  icone?: LucideIcon;
  onClick?: () => void;
  perigo?: boolean;
  desabilitado?: boolean;
  submenu?: ItemSubmenu[];
  extra?: ReactNode;
};

type Props = {
  acoes: AcaoMenu[];
  aoEscolher?: () => void;
  alinhar?: "direita" | "esquerda";
};

const LARGURA_MENU = 208;
const LARGURA_SUB = 192;

/**
 * Portal no body com posição `fixed` para não ser recortado por overflow da
 * tabela/card. Abre para cima quando não cabe abaixo da âncora.
 */
export function MenuAcoes({ acoes, aoEscolher, alinhar = "direita" }: Props) {
  const [submenuAberto, setSubmenuAberto] = useState<string | null>(null);
  const marcaRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    maxH: number;
    submenuEsquerda: boolean;
  } | null>(null);

  const posicionar = useCallback(() => {
    const ancora = marcaRef.current?.parentElement;
    if (!ancora) return;
    const rect = ancora.getBoundingClientRect();
    const alturaMenu = menuRef.current?.offsetHeight ?? 220;
    const espacoAbaixo = window.innerHeight - rect.bottom - 8;
    const espacoAcima = rect.top - 8;
    const abrirAcima = espacoAbaixo < Math.min(alturaMenu, 180) && espacoAcima > espacoAbaixo;
    const maxH = Math.max(120, Math.min(320, abrirAcima ? espacoAcima : espacoAbaixo));
    const alturaUsada = Math.min(alturaMenu, maxH);
    const top = abrirAcima ? rect.top - alturaUsada - 4 : rect.bottom + 4;
    const leftPreferido = alinhar === "direita" ? rect.right - LARGURA_MENU : rect.left;
    const left = Math.min(Math.max(8, leftPreferido), window.innerWidth - LARGURA_MENU - 8);
    const submenuEsquerda = left > LARGURA_SUB + 16;
    setCoords((atual) => {
      if (
        atual &&
        atual.top === top &&
        atual.left === left &&
        atual.maxH === maxH &&
        atual.submenuEsquerda === submenuEsquerda
      ) {
        return atual;
      }
      return { top, left, maxH, submenuEsquerda };
    });
  }, [alinhar]);

  useLayoutEffect(() => {
    posicionar();
  }, [posicionar, submenuAberto, acoes.length]);

  useEffect(() => {
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [posicionar]);

  useEffect(() => {
    function fora(evento: MouseEvent) {
      const alvo = evento.target as Node;
      if (menuRef.current?.contains(alvo)) return;
      if (marcaRef.current?.parentElement?.contains(alvo)) return;
      aoEscolher?.();
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aoEscolher]);

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      className={unir_classes(
        "fixed z-50 min-w-[13rem] overflow-y-auto rounded-xl border border-borda bg-superficie py-1 shadow-lg",
        coords ? "visible" : "invisible",
      )}
      style={{
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        maxHeight: coords?.maxH ?? 320,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {acoes.map((acao) => {
        const temSubmenu = Boolean(acao.submenu && acao.submenu.length > 0);
        const aberto = submenuAberto === acao.rotulo;
        return (
          <div key={acao.rotulo} className="relative">
            <button
              type="button"
              role="menuitem"
              disabled={acao.desabilitado}
              className={unir_classes(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-fundo disabled:cursor-not-allowed disabled:opacity-50",
                acao.perigo ? "text-despesa" : "text-texto",
              )}
              onClick={() => {
                if (acao.desabilitado) return;
                if (temSubmenu) {
                  setSubmenuAberto(aberto ? null : acao.rotulo);
                  return;
                }
                acao.onClick?.();
                aoEscolher?.();
              }}
            >
              {acao.icone ? <acao.icone size={14} className="shrink-0" /> : null}
              <span className="flex-1 truncate">{acao.rotulo}</span>
              {temSubmenu ? <ChevronRight size={14} className="shrink-0 text-texto-suave" /> : null}
            </button>
            {temSubmenu && aberto && (
              <div
                className={unir_classes(
                  "absolute top-0 z-50 max-h-64 min-w-[12rem] overflow-y-auto rounded-xl border border-borda bg-superficie py-1 shadow-lg",
                  (coords?.submenuEsquerda ?? true) ? "right-full mr-1" : "left-full ml-1",
                )}
              >
                {acao.submenu!.map((item) => (
                  <button
                    key={item.rotulo}
                    type="button"
                    role="menuitem"
                    className={unir_classes(
                      "flex w-full items-center px-3 py-2 text-left text-sm hover:bg-fundo",
                      item.ativo ? "text-primaria" : "text-texto",
                    )}
                    onClick={() => {
                      item.onClick();
                      aoEscolher?.();
                    }}
                  >
                    {item.rotulo}
                  </button>
                ))}
              </div>
            )}
            {acao.extra}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <span ref={marcaRef} className="pointer-events-none absolute right-0 top-0 h-0 w-0" aria-hidden />
      {createPortal(menu, document.body)}
    </>
  );
}
