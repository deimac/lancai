import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { AvisoSistema } from "../../contexto/ContextoToast";
import { unir_classes } from "../../lib/unir-classes";

const DURACAO_MS = 4200;

const estilos: Record<
  AvisoSistema["tipo"],
  { caixa: string; icone: typeof CheckCircle2 }
> = {
  sucesso: {
    caixa: "border-primaria/40 bg-superficie text-texto",
    icone: CheckCircle2,
  },
  erro: {
    caixa: "border-perigo/40 bg-superficie text-texto",
    icone: XCircle,
  },
  info: {
    caixa: "border-borda bg-superficie text-texto",
    icone: Info,
  },
};

const corIcone: Record<AvisoSistema["tipo"], string> = {
  sucesso: "text-primaria",
  erro: "text-despesa",
  info: "text-texto-suave",
};

type Props = {
  avisos: AvisoSistema[];
  aoDispensar: (id: string) => void;
};

function ItemToast({
  aviso,
  aoDispensar,
}: {
  aviso: AvisoSistema;
  aoDispensar: (id: string) => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(() => aoDispensar(aviso.id), DURACAO_MS);
    return () => window.clearTimeout(t);
  }, [aviso.id, aoDispensar]);

  const estilo = estilos[aviso.tipo];
  const Icone = estilo.icone;

  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={unir_classes(
        "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-lg",
        estilo.caixa,
      )}
    >
      <Icone size={18} className={unir_classes("mt-0.5 shrink-0", corIcone[aviso.tipo])} />
      <p className="min-w-0 flex-1 text-sm leading-snug">{aviso.mensagem}</p>
      <button
        type="button"
        onClick={() => aoDispensar(aviso.id)}
        className="shrink-0 rounded-md p-0.5 text-texto-suave hover:bg-superficie-alta hover:text-texto"
        aria-label="Fechar aviso"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

export function ToastSistema({ avisos, aoDispensar }: Props) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      aria-live="polite"
      aria-relevant="additions"
    >
      <AnimatePresence mode="popLayout">
        {avisos.map((aviso) => (
          <ItemToast key={aviso.id} aviso={aviso} aoDispensar={aoDispensar} />
        ))}
      </AnimatePresence>
    </div>
  );
}
