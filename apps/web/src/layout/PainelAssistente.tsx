import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as EventoTeclado, PointerEvent as EventoPonteiro, RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelBottom,
  PanelRight,
  Sparkles,
} from "lucide-react";
import { JanelaChat } from "../componentes/JanelaChat";
import type { JanelaChatHandle } from "../componentes/JanelaChat";
import { Botao } from "../componentes/ui/Botao";
import {
  ALTURA_PAINEL_MIN,
  LARGURA_PAINEL_MIN,
  ler_altura_painel,
  ler_largura_painel,
  ler_painel_maximizado,
  limitar_altura_painel,
  limitar_largura_painel,
  salvar_altura_painel,
  salvar_largura_painel,
  salvar_painel_maximizado,
  type PosicaoPainel,
} from "../lib/preferencias-painel";
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
  const asideRef = useRef<HTMLElement>(null);
  const estavaExpandido = useRef(expandido);
  const tamanho = useTamanhoPainel(posicao, expandido, asideRef);

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
    function noTeclado(evento: globalThis.KeyboardEvent) {
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
          title={tamanho.maximizado ? "Restaurar tamanho" : "Maximizar"}
          aria-label={tamanho.maximizado ? "Restaurar tamanho do assistente" : "Maximizar assistente"}
          aria-pressed={tamanho.maximizado}
          onClick={() => tamanho.definirMaximizado(!tamanho.maximizado)}
        >
          {tamanho.maximizado ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
        </Botao>
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
        title="Assistente"
        className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-borda bg-superficie text-texto shadow-lg shadow-black/30 transition hover:border-primaria/40 hover:text-primaria"
      >
        <MessageSquare size={18} aria-hidden />
      </motion.button>
    );
  }

  const lateral = posicao === "lateral";

  return (
    <AnimatePresence mode="wait">
      <motion.aside
        key={posicao}
        ref={asideRef}
        id="painel-assistente"
        role="complementary"
        aria-label="Assistente"
        initial={{ opacity: 0, y: posicao === "inferior" ? 24 : 0, x: posicao === "lateral" ? 24 : 0 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        style={
          lateral
            ? { width: tamanho.larguraAplicada, minWidth: tamanho.larguraAplicada }
            : { height: tamanho.alturaAplicada, minHeight: tamanho.alturaAplicada }
        }
        className={unir_classes(
          "relative flex shrink-0 flex-col overflow-hidden border-borda bg-superficie/95 backdrop-blur-md",
          lateral ? "h-full border-l" : "w-full border-t",
        )}
      >
        <AlcaRedimensionar
          lateral={lateral}
          valor={lateral ? tamanho.larguraAplicada : tamanho.alturaAplicada}
          minimo={lateral ? LARGURA_PAINEL_MIN : ALTURA_PAINEL_MIN}
          maximo={lateral ? tamanho.larguraMax : tamanho.alturaMax}
          aoPointerDown={tamanho.aoPointerDown}
          aoPointerMove={tamanho.aoPointerMove}
          aoPointerUp={tamanho.aoPointerUp}
          aoTeclado={tamanho.aoTecladoAlca}
          aoDuploClique={() => tamanho.definirMaximizado(!tamanho.maximizado)}
        />
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

function AlcaRedimensionar({
  lateral,
  valor,
  minimo,
  maximo,
  aoPointerDown,
  aoPointerMove,
  aoPointerUp,
  aoTeclado,
  aoDuploClique,
}: {
  lateral: boolean;
  valor: number;
  minimo: number;
  maximo: number;
  aoPointerDown: (evento: EventoPonteiro<HTMLDivElement>) => void;
  aoPointerMove: (evento: EventoPonteiro<HTMLDivElement>) => void;
  aoPointerUp: (evento: EventoPonteiro<HTMLDivElement>) => void;
  aoTeclado: (evento: EventoTeclado<HTMLDivElement>) => void;
  aoDuploClique: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation={lateral ? "vertical" : "horizontal"}
      aria-label={
        lateral
          ? "Redimensionar assistente. Arraste para o lado ou use as setas."
          : "Redimensionar assistente. Arraste para cima ou use as setas."
      }
      aria-valuemin={minimo}
      aria-valuemax={maximo}
      aria-valuenow={valor}
      title="Arraste para redimensionar"
      tabIndex={0}
      onPointerDown={aoPointerDown}
      onPointerMove={aoPointerMove}
      onPointerUp={aoPointerUp}
      onPointerCancel={aoPointerUp}
      onLostPointerCapture={aoPointerUp}
      onKeyDown={aoTeclado}
      onDoubleClick={aoDuploClique}
      className={unir_classes(
        "absolute z-10 flex touch-none items-center justify-center hover:bg-primaria/25 focus-visible:bg-primaria/25 focus-visible:outline-none",
        lateral ? "inset-y-0 left-0 w-3 cursor-col-resize" : "inset-x-0 top-0 h-3 cursor-row-resize",
      )}
    >
      <span
        aria-hidden
        className={unir_classes(
          "pointer-events-none rounded-full bg-borda",
          lateral ? "h-10 w-0.5" : "h-0.5 w-10",
        )}
      />
    </div>
  );
}

function limparEstiloArraste() {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function useTamanhoPainel(
  posicao: PosicaoPainel,
  expandido: boolean,
  asideRef: RefObject<HTMLElement | null>,
) {
  const arrastando = useRef(false);
  const [largura, setLargura] = useState(() => ler_largura_painel());
  const [altura, setAltura] = useState(() => ler_altura_painel());
  const [maximizado, setMaximizado] = useState(() => ler_painel_maximizado());
  const [disponivel, setDisponivel] = useState(() => ({
    w: typeof window === "undefined" ? 960 : window.innerWidth,
    h: typeof window === "undefined" ? 720 : window.innerHeight,
  }));

  useLayoutEffect(() => {
    if (!expandido) return;
    const parent = asideRef.current?.parentElement;
    if (!parent) return;
    const medir = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      setDisponivel((atual) => (atual.w === w && atual.h === h ? atual : { w, h }));
    };
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [expandido, posicao, asideRef]);

  useEffect(() => () => limparEstiloArraste(), []);

  const lateral = posicao === "lateral";
  const larguraMax = limitar_largura_painel(Number.POSITIVE_INFINITY, disponivel.w);
  const alturaMax = limitar_altura_painel(Number.POSITIVE_INFINITY, disponivel.h);
  const larguraAplicada = maximizado ? larguraMax : limitar_largura_painel(largura, disponivel.w);
  const alturaAplicada = maximizado ? alturaMax : limitar_altura_painel(altura, disponivel.h);

  function persistir(proximaLargura: number, proximaAltura: number) {
    salvar_largura_painel(proximaLargura);
    salvar_altura_painel(proximaAltura);
  }

  function definirMaximizado(proximo: boolean) {
    setMaximizado(proximo);
    salvar_painel_maximizado(proximo);
  }

  function aplicarPonteiro(clienteX: number, clienteY: number): number | null {
    const aside = asideRef.current;
    if (!aside) return null;
    const box = aside.getBoundingClientRect();
    if (lateral) {
      const proxima = limitar_largura_painel(box.right - clienteX, disponivel.w);
      setLargura(proxima);
      return proxima;
    }
    const proxima = limitar_altura_painel(box.bottom - clienteY, disponivel.h);
    setAltura(proxima);
    return proxima;
  }

  function iniciarArraste() {
    arrastando.current = true;
    document.body.style.cursor = lateral ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    if (maximizado) definirMaximizado(false);
  }

  function encerrarArraste() {
    if (!arrastando.current) return;
    arrastando.current = false;
    limparEstiloArraste();
  }

  function aoPointerDown(evento: EventoPonteiro<HTMLDivElement>) {
    evento.preventDefault();
    iniciarArraste();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    aplicarPonteiro(evento.clientX, evento.clientY);
  }

  function aoPointerMove(evento: EventoPonteiro<HTMLDivElement>) {
    if (!arrastando.current) return;
    aplicarPonteiro(evento.clientX, evento.clientY);
  }

  function aoPointerUp(evento: EventoPonteiro<HTMLDivElement>) {
    if (!arrastando.current) return;
    const aplicado = aplicarPonteiro(evento.clientX, evento.clientY);
    encerrarArraste();
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
    if (aplicado == null) return;
    if (lateral) persistir(aplicado, altura);
    else persistir(largura, aplicado);
  }

  function aoTecladoAlca(evento: EventoTeclado<HTMLDivElement>) {
    const passo = evento.shiftKey ? 48 : 16;
    if (evento.key === "Home") {
      evento.preventDefault();
      definirMaximizado(false);
      if (lateral) {
        const proxima = limitar_largura_painel(LARGURA_PAINEL_MIN, disponivel.w);
        setLargura(proxima);
        persistir(proxima, altura);
      } else {
        const proxima = limitar_altura_painel(ALTURA_PAINEL_MIN, disponivel.h);
        setAltura(proxima);
        persistir(largura, proxima);
      }
      return;
    }
    if (evento.key === "End") {
      evento.preventDefault();
      definirMaximizado(true);
      return;
    }
    if (lateral) {
      if (evento.key === "ArrowLeft") {
        evento.preventDefault();
        definirMaximizado(false);
        const proxima = limitar_largura_painel(larguraAplicada + passo, disponivel.w);
        setLargura(proxima);
        persistir(proxima, altura);
      }
      if (evento.key === "ArrowRight") {
        evento.preventDefault();
        definirMaximizado(false);
        const proxima = limitar_largura_painel(larguraAplicada - passo, disponivel.w);
        setLargura(proxima);
        persistir(proxima, altura);
      }
      return;
    }
    if (evento.key === "ArrowUp") {
      evento.preventDefault();
      definirMaximizado(false);
      const proxima = limitar_altura_painel(alturaAplicada + passo, disponivel.h);
      setAltura(proxima);
      persistir(largura, proxima);
    }
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      definirMaximizado(false);
      const proxima = limitar_altura_painel(alturaAplicada - passo, disponivel.h);
      setAltura(proxima);
      persistir(largura, proxima);
    }
  }

  return {
    larguraAplicada,
    alturaAplicada,
    larguraMax,
    alturaMax,
    maximizado,
    definirMaximizado,
    aoPointerDown,
    aoPointerMove,
    aoPointerUp,
    aoTecladoAlca,
  };
}
