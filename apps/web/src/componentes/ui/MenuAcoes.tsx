import { useEffect, useRef, useState, type ReactNode } from "react";
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

export function MenuAcoes({ acoes, aoEscolher, alinhar = "direita" }: Props) {
  const [submenuAberto, setSubmenuAberto] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fora(evento: MouseEvent) {
      if (!ref.current?.contains(evento.target as Node)) {
        aoEscolher?.();
      }
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aoEscolher]);

  return (
    <div
      ref={ref}
      className={unir_classes(
        "absolute top-full z-30 mt-1 min-w-[13rem] rounded-xl border border-borda bg-superficie py-1 shadow-lg",
        alinhar === "direita" ? "right-0" : "left-0",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {acoes.map((acao) => {
        const temSubmenu = Boolean(acao.submenu && acao.submenu.length > 0);
        const aberto = submenuAberto === acao.rotulo;
        return (
          <div key={acao.rotulo} className="relative">
            <button
              type="button"
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
              <div className="absolute right-full top-0 z-40 mr-1 max-h-64 min-w-[12rem] overflow-y-auto rounded-xl border border-borda bg-superficie py-1 shadow-lg">
                {acao.submenu!.map((item) => (
                  <button
                    key={item.rotulo}
                    type="button"
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
}
