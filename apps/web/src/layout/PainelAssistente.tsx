import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  PanelBottom,
  PanelRight,
  Sparkles,
} from "lucide-react";
import { JanelaChat } from "../componentes/JanelaChat";
import type { JanelaChatHandle } from "../componentes/JanelaChat";
import { Botao } from "../componentes/ui/Botao";
import type { PosicaoPainel } from "../lib/preferencias-painel";
import { unir_classes } from "../lib/unir-classes";

interface PropsPainelAssistente {
  usuarioId: string;
  temContas: boolean;
  posicao: PosicaoPainel;
  expandido: boolean;
  aoMudarPosicao: (posicao: PosicaoPainel) => void;
  aoMudarExpandido: (expandido: boolean) => void;
  aoMudarDados?: () => void;
}

export function PainelAssistente({
  usuarioId,
  temContas,
  posicao,
  expandido,
  aoMudarPosicao,
  aoMudarExpandido,
  aoMudarDados,
}: PropsPainelAssistente) {
  const chatRef = useRef<JanelaChatHandle>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const estavaExpandido = useRef(expandido);

  useEffect(() => {
    if (expandido && !estavaExpandido.current) {
      const id = window.setTimeout(() => chatRef.current?.focar(), 50);
      estavaExpandido.current = true;
      return () => window.clearTimeout(id);
    }
    if (!expandido && estavaExpandido.current) {
      fabRef.current?.focus();
      estavaExpandido.current = false;
    }
  }, [expandido]);

  useEffect(() => {
    if (!expandido) return;
    function noTeclado(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        evento.preventDefault();
        aoMudarExpandido(false);
      }
    }
    window.addEventListener("keydown", noTeclado);
    return () => window.removeEventListener("keydown", noTeclado);
  }, [expandido, aoMudarExpandido]);

  const barraControles = (
    <div className="flex items-center justify-between gap-2 border-b border-borda px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium text-texto">
        <Sparkles size={16} className="text-primaria" aria-hidden />
        Assistente
      </div>
      <div className="flex items-center gap-1">
        <Botao
          variante="fantasma"
          className="h-8 px-2"
          title={posicao === "lateral" ? "Mover para baixo" : "Mover para o lado"}
          aria-label={posicao === "lateral" ? "Mover assistente para baixo" : "Mover assistente para o lado"}
          onClick={() => aoMudarPosicao(posicao === "lateral" ? "inferior" : "lateral")}
        >
          {posicao === "lateral" ? (
            <PanelBottom size={14} aria-hidden />
          ) : (
            <PanelRight size={14} aria-hidden />
          )}
        </Botao>
        <Botao
          variante="fantasma"
          className="h-8 px-2"
          title="Recolher"
          aria-label="Recolher assistente"
          onClick={() => aoMudarExpandido(false)}
        >
          {posicao === "inferior" ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronUp size={14} aria-hidden />
          )}
        </Botao>
      </div>
    </div>
  );

  if (!expandido) {
    return (
      <motion.button
        ref={fabRef}
        type="button"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => aoMudarExpandido(true)}
        aria-label="Abrir assistente"
        aria-expanded={false}
        aria-controls="painel-assistente"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-borda bg-superficie px-4 py-2.5 text-sm font-medium text-texto shadow-lg shadow-black/30 transition hover:border-primaria/40 hover:text-primaria"
      >
        <MessageSquare size={16} aria-hidden />
        Assistente
      </motion.button>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.aside
        key={posicao}
        id="painel-assistente"
        role="complementary"
        aria-label="Assistente"
        initial={{ opacity: 0, y: posicao === "inferior" ? 24 : 0, x: posicao === "lateral" ? 24 : 0 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className={unir_classes(
          "flex flex-col border-borda bg-superficie/95 backdrop-blur-md",
          posicao === "lateral"
            ? "h-full w-full border-l md:w-[380px] md:min-w-[380px]"
            : "h-[42vh] min-h-[280px] w-full border-t",
        )}
      >
        {barraControles}
        <div className="min-h-0 flex-1">
          <JanelaChat
            ref={chatRef}
            usuarioId={usuarioId}
            temContas={temContas}
            aoRegistrarOuCorrigirMovimento={aoMudarDados}
          />
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
