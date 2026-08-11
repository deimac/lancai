import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { unir_classes } from "../../lib/unir-classes";

type Props = {
  aberto: boolean;
  titulo: string;
  subtitulo?: string;
  aoFechar: () => void;
  children: ReactNode;
  cabecalhoExtra?: ReactNode;
  labelledBy?: string;
};

/** Painel lateral direito sobre o conteúdo (overlay + ESC + clique fora). */
export function Drawer({
  aberto,
  titulo,
  subtitulo,
  aoFechar,
  children,
  cabecalhoExtra,
  labelledBy = "drawer-titulo",
}: Props) {
  useEffect(() => {
    if (!aberto) return;
    function onKey(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFechar();
    }
    window.addEventListener("keydown", onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = anterior;
    };
  }, [aberto, aoFechar]);

  return (
    <AnimatePresence>
      {aberto ? (
        <div className="fixed inset-0 z-[80]" role="presentation">
          <motion.button
            type="button"
            aria-label="Fechar painel"
            className="absolute inset-0 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={aoFechar}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className={unir_classes(
              "absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-borda bg-superficie shadow-2xl",
              "sm:max-w-[460px]",
            )}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-borda px-5 py-4">
              <div className="min-w-0">
                {cabecalhoExtra}
                <h2 id={labelledBy} className="text-lg font-semibold tracking-tight text-texto">
                  {titulo}
                </h2>
                {subtitulo ? (
                  <p className="mt-0.5 text-sm text-texto-suave">{subtitulo}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={aoFechar}
                className="rounded-lg p-1.5 text-texto-suave transition hover:bg-superficie-alta hover:text-texto"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
