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

type Coords = { top: number; left: number; maxH: number };

/**
 * Portal no body com posição `fixed` para não ser recortado por overflow da
 * tabela/card. Submenu (Categoria) também vai para o body — o overflow do
 * painel principal não pode recortá-lo.
 */
export function MenuAcoes({ acoes, aoEscolher, alinhar = "direita" }: Props) {
  const [submenuAberto, setSubmenuAberto] = useState<string | null>(null);
  const marcaRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const gatilhoSubmenuRef = useRef<HTMLButtonElement | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [coordsSub, setCoordsSub] = useState<Coords | null>(null);

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
    setCoords((atual) =>
      atual && atual.top === top && atual.left === left && atual.maxH === maxH
        ? atual
        : { top, left, maxH },
    );

    const gatilho = gatilhoSubmenuRef.current;
    const menu = menuRef.current;
    if (!gatilho || !menu) {
      setCoordsSub(null);
      return;
    }
    const gatilhoRect = gatilho.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const alturaSub = submenuRef.current?.offsetHeight ?? 256;
    const maxHSub = Math.max(120, Math.min(256, window.innerHeight - 16));
    const alturaUsadaSub = Math.min(alturaSub, maxHSub);
    let topSub = gatilhoRect.top;
    if (topSub + alturaUsadaSub > window.innerHeight - 8) {
      topSub = Math.max(8, window.innerHeight - 8 - alturaUsadaSub);
    }
    const abrirEsquerda = menuRect.left > LARGURA_SUB + 16;
    const leftSubBruto = abrirEsquerda ? menuRect.left - LARGURA_SUB - 4 : menuRect.right + 4;
    const leftSub = Math.min(Math.max(8, leftSubBruto), window.innerWidth - LARGURA_SUB - 8);
    setCoordsSub((atual) =>
      atual && atual.top === topSub && atual.left === leftSub && atual.maxH === maxHSub
        ? atual
        : { top: topSub, left: leftSub, maxH: maxHSub },
    );
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
      if (submenuRef.current?.contains(alvo)) return;
      if (marcaRef.current?.parentElement?.contains(alvo)) return;
      aoEscolher?.();
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aoEscolher]);

  const acaoSub = acoes.find((acao) => acao.rotulo === submenuAberto && acao.submenu?.length);

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
          <div key={acao.rotulo}>
            <button
              type="button"
              role="menuitem"
              disabled={acao.desabilitado}
              ref={aberto ? (el) => { gatilhoSubmenuRef.current = el; } : undefined}
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
            {acao.extra}
          </div>
        );
      })}
    </div>
  );

  const submenu = acaoSub ? (
    <div
      ref={submenuRef}
      role="menu"
      className={unir_classes(
        "fixed z-[60] min-w-[12rem] overflow-y-auto rounded-xl border border-borda bg-superficie py-1 shadow-lg",
        coordsSub ? "visible" : "invisible",
      )}
      style={{
        top: coordsSub?.top ?? 0,
        left: coordsSub?.left ?? 0,
        maxHeight: coordsSub?.maxH ?? 256,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {acaoSub.submenu!.map((item) => (
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
  ) : null;

  return (
    <>
      <span ref={marcaRef} className="pointer-events-none absolute right-0 top-0 h-0 w-0" aria-hidden />
      {createPortal(menu, document.body)}
      {submenu ? createPortal(submenu, document.body) : null}
    </>
  );
}
