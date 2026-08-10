import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatar_mes } from "../lib/formatar";
import { unir_classes } from "../lib/unir-classes";

const MESES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export function mes_de_hoje(): string {
  const agora = new Date();
  const y = agora.getFullYear();
  const m = String(agora.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Normaliza `YYYY-MM` ou `YYYY-MM-DD` → `YYYY-MM`. */
export function normalizar_mes(valor: string | null | undefined, fallback = mes_de_hoje()): string {
  if (!valor) return fallback;
  const match = /^(\d{4})-(\d{2})/.exec(valor);
  if (!match) return fallback;
  const mes = Number(match[2]);
  if (mes < 1 || mes > 12) return fallback;
  return `${match[1]}-${match[2]}`;
}

function deslocar_mes(yyyyMm: string, delta: number): string {
  const [anoS, mesS] = yyyyMm.split("-");
  const base = new Date(Number(anoS), Number(mesS) - 1 + delta, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

type Props = {
  mes: string;
  onChange: (mes: string) => void;
  className?: string;
};

/**
 * Navegador de competência (mês/ano). O extrato e o dashboard filtram por
 * `data_movimento` — parcelas de cartão devem pousar no mês da fatura.
 */
export function SeletorMes({ mes, onChange, className }: Props) {
  const mesNorm = normalizar_mes(mes);
  const [aberto, setAberto] = useState(false);
  const [anoPainel, setAnoPainel] = useState(() => Number(mesNorm.slice(0, 4)));
  const raiz = useRef<HTMLDivElement>(null);
  const painelId = useId();

  useEffect(() => {
    setAnoPainel(Number(mesNorm.slice(0, 4)));
  }, [mesNorm]);

  useEffect(() => {
    if (!aberto) return;
    function fechar(ev: MouseEvent) {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAberto(false);
    }
    function tecla(ev: KeyboardEvent) {
      if (ev.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fechar);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fechar);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const mesSelecionado = Number(mesNorm.slice(5, 7));

  return (
    <div ref={raiz} className={unir_classes("relative inline-flex items-center gap-1", className)}>
      <button
        type="button"
        aria-label="Mês anterior"
        className="rounded-lg border border-borda p-1.5 text-texto-suave hover:bg-superficie-alta hover:text-texto"
        onClick={() => onChange(deslocar_mes(mesNorm, -1))}
      >
        <ChevronLeft size={16} />
      </button>

      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={painelId}
        className="min-w-[10.5rem] rounded-lg border border-borda px-3 py-1.5 text-sm font-medium capitalize text-texto hover:bg-superficie-alta"
        onClick={() => setAberto((v) => !v)}
      >
        {formatar_mes(mesNorm)}
      </button>

      <button
        type="button"
        aria-label="Próximo mês"
        className="rounded-lg border border-borda p-1.5 text-texto-suave hover:bg-superficie-alta hover:text-texto"
        onClick={() => onChange(deslocar_mes(mesNorm, 1))}
      >
        <ChevronRight size={16} />
      </button>

      {aberto && (
        <div
          id={painelId}
          role="dialog"
          aria-label="Escolher mês"
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-borda bg-superficie p-3 shadow-lg shadow-black/40"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Ano anterior"
              className="rounded-md p-1 text-texto-suave hover:bg-superficie-alta hover:text-texto"
              onClick={() => setAnoPainel((a) => a - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold tabular-nums text-texto">{anoPainel}</span>
            <button
              type="button"
              aria-label="Próximo ano"
              className="rounded-md p-1 text-texto-suave hover:bg-superficie-alta hover:text-texto"
              onClick={() => setAnoPainel((a) => a + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MESES.map((rotulo, indice) => {
              const numero = indice + 1;
              const valor = `${anoPainel}-${String(numero).padStart(2, "0")}`;
              const ativo = anoPainel === Number(mesNorm.slice(0, 4)) && numero === mesSelecionado;
              return (
                <button
                  key={rotulo}
                  type="button"
                  className={unir_classes(
                    "rounded-lg px-2 py-2 text-sm transition-colors",
                    ativo
                      ? "bg-primaria font-medium text-white"
                      : "text-texto-suave hover:bg-superficie-alta hover:text-texto",
                  )}
                  onClick={() => {
                    onChange(valor);
                    setAberto(false);
                  }}
                >
                  {rotulo}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
