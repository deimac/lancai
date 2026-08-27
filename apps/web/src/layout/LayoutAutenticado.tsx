import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarDays,
  Gauge,
  List,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Settings,
  Sun,
  Tags,
  Wallet,
  Workflow,
} from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi } from "../lib/api";
import {
  avancar,
  type AlvoInvalidacao,
  type VersoesDados,
  versao_inicial,
} from "../lib/invalidacao-dados";
import { MarcaLancai } from "../componentes/MarcaLancai";
import { Botao } from "../componentes/ui/Botao";
import { unir_classes } from "../lib/unir-classes";
import { search_sem_tipo_gasto } from "../lib/filtrar-extrato";
import {
  ler_sidebar_recolhida,
  salvar_sidebar_recolhida,
} from "../lib/preferencias-sidebar";
import {
  aplicar_tema,
  ler_tema,
  salvar_tema,
  type TemaLancai,
} from "../lib/preferencias-tema";
import { PainelAssistente } from "./PainelAssistente";
import { SeletorWorkspace } from "./SeletorWorkspace";
import {
  ler_painel_expandido,
  resolver_posicao_painel,
  salvar_painel_expandido,
  salvar_posicao_painel,
  type PosicaoPainel,
} from "../lib/preferencias-painel";

const LINKS = [
  { para: "/", rotulo: "Cockpit", icone: Gauge, fim: true },
  { para: "/extrato", rotulo: "Transações", icone: List },
  { para: "/agendadas", rotulo: "Agendadas", icone: CalendarDays },
  { para: "/recorrentes", rotulo: "Recorrentes", icone: Repeat },
  { para: "/contas", rotulo: "Contas", icone: Wallet },
  { para: "/categorias", rotulo: "Categorias", icone: Tags },
  { para: "/regras", rotulo: "Regras", icone: Workflow },
  { para: "/configuracoes", rotulo: "Configurações", icone: Settings },
] as const;

export type ContextoLayout = {
  versoes: VersoesDados;
  invalidar: (...alvos: AlvoInvalidacao[]) => void;
  posicaoPainel: PosicaoPainel;
  definirPosicaoPainel: (posicao: PosicaoPainel) => Promise<void>;
  tema: TemaLancai;
  /** Incrementa ao clicar Cockpit no menu — a tela volta o filtro para Todos. */
  geracaoCockpit: number;
};

export function LayoutAutenticado() {
  const { usuario, sair, definir_usuario } = useAutenticacao();
  const [temContas, setTemContas] = useState(false);
  const [versoes, setVersoes] = useState<VersoesDados>(versao_inicial);
  const [posicao, setPosicao] = useState<PosicaoPainel>(() =>
    resolver_posicao_painel(undefined),
  );
  const [expandido, setExpandido] = useState(() => ler_painel_expandido());
  const [recolhida, setRecolhida] = useState(() => ler_sidebar_recolhida());
  const [tema, setTema] = useState<TemaLancai>(() => ler_tema());
  const [geracaoCockpit, setGeracaoCockpit] = useState(0);
  const location = useLocation();

  useEffect(() => {
    aplicar_tema(tema);
  }, [tema]);

  useEffect(() => {
    if (!usuario) return;
    const doServidor = resolver_posicao_painel(usuario.posicaoPainel);
    setPosicao(doServidor);
    salvar_posicao_painel(doServidor);
  }, [usuario?.id, usuario?.posicaoPainel]);

  const definir_posicao = useCallback(
    async (nova: PosicaoPainel) => {
      setPosicao(nova);
      salvar_posicao_painel(nova);
      if (!usuario) return;
      try {
        const atualizado = await clienteApi.atualizar_usuario(usuario.id, {
          posicaoPainel: nova,
        });
        definir_usuario(atualizado);
      } catch {
        /* cache local já reflete a escolha; próximo login pode reaplicar o servidor */
      }
    },
    [usuario, definir_usuario],
  );

  const definir_expandido = useCallback((novo: boolean) => {
    setExpandido(novo);
    salvar_painel_expandido(novo);
  }, []);

  const alternar_sidebar = useCallback(() => {
    setRecolhida((atual) => {
      const proximo = !atual;
      salvar_sidebar_recolhida(proximo);
      return proximo;
    });
  }, []);

  const alternar_tema = useCallback(() => {
    setTema((atual) => {
      const proximo = atual === "escuro" ? "claro" : "escuro";
      salvar_tema(proximo);
      return proximo;
    });
  }, []);

  const invalidar = useCallback((...alvos: AlvoInvalidacao[]) => {
    setVersoes((atual) =>
      alvos.length > 0 ? avancar(atual, ...alvos) : avancar(atual, "tudo"),
    );
  }, []);

  const recarregar_contexto = useCallback(async () => {
    if (!usuario) return;
    try {
      const contas = await clienteApi.listar_contas(usuario.id, true);
      setTemContas(contas.length > 0);
    } catch {
      /* painel ainda funciona sem isso */
    }
  }, [usuario]);

  useEffect(() => {
    void recarregar_contexto();
  }, [recarregar_contexto, versoes.contas]);

  if (!usuario) {
    return (
      <div className="flex min-h-screen items-center justify-center text-texto-suave">
        Carregando...
      </div>
    );
  }

  const aoMudarWorkspace = () => {
    invalidar("tudo");
    void recarregar_contexto();
  };

  return (
    <div className="flex h-screen bg-fundo text-texto">
      <aside
        className={unir_classes(
          "hidden shrink-0 flex-col border-r border-borda bg-superficie/60 transition-[width] duration-200 md:flex",
          recolhida ? "w-[4.25rem]" : "w-56",
        )}
      >
        <div className={unir_classes("border-b border-borda py-5", recolhida ? "px-2" : "px-4")}>
          <MarcaLancai compacto={recolhida} className={recolhida ? "justify-center" : undefined} />
          {recolhida ? null : (
            <p className="mt-1 truncate text-xs text-texto-suave">{usuario.nome}</p>
          )}
        </div>
        <SeletorWorkspace compacto={recolhida} aoMudar={aoMudarWorkspace} />
        <nav className={unir_classes("flex flex-1 flex-col gap-1", recolhida ? "p-2" : "p-3")} aria-label="Principal">
          {LINKS.map((link) => (
            <NavLink
              key={link.para}
              to={
                link.para === "/"
                  ? { pathname: "/", search: search_sem_tipo_gasto(location.search) }
                  : link.para
              }
              end={"fim" in link ? link.fim : false}
              title={link.rotulo}
              onClick={() => {
                if (link.para === "/") setGeracaoCockpit((n) => n + 1);
              }}
              className={({ isActive }) =>
                unir_classes(
                  "flex items-center rounded-lg text-sm transition",
                  recolhida ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
                  isActive
                    ? "bg-primaria/15 text-primaria"
                    : "text-texto-suave hover:bg-superficie-alta hover:text-texto",
                )
              }
            >
              <link.icone size={16} aria-hidden />
              {recolhida ? <span className="sr-only">{link.rotulo}</span> : link.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className={unir_classes("flex flex-col gap-1 border-t border-borda", recolhida ? "p-2" : "p-3")}>
          <Botao
            variante="fantasma"
            className={unir_classes("w-full", recolhida ? "justify-center px-2" : "justify-start")}
            onClick={alternar_tema}
            title={tema === "escuro" ? "Tema claro" : "Tema escuro"}
          >
            {tema === "escuro" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
            {recolhida ? <span className="sr-only">Tema</span> : tema === "escuro" ? "Tema claro" : "Tema escuro"}
          </Botao>
          <Botao
            variante="fantasma"
            className={unir_classes("w-full", recolhida ? "justify-center px-2" : "justify-start")}
            onClick={alternar_sidebar}
            title={recolhida ? "Expandir menu" : "Minimizar"}
          >
            {recolhida ? (
              <PanelLeftOpen size={14} aria-hidden />
            ) : (
              <PanelLeftClose size={14} aria-hidden />
            )}
            {recolhida ? <span className="sr-only">Expandir</span> : "Minimizar"}
          </Botao>
          <Botao
            variante="fantasma"
            className={unir_classes("w-full", recolhida ? "justify-center px-2" : "justify-start")}
            onClick={sair}
            title="Sair"
          >
            <LogOut size={14} aria-hidden />
            {recolhida ? <span className="sr-only">Sair</span> : "Sair"}
          </Botao>
        </div>
      </aside>

      <div
        className={unir_classes(
          "flex min-w-0 flex-1",
          posicao === "inferior" && expandido ? "flex-col" : "flex-row",
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex flex-col gap-1 border-b border-borda px-1 py-2 md:hidden">
            <div className="flex items-center justify-between gap-2 px-2">
              <MarcaLancai tamanho="sm" />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={alternar_tema}
                  className="rounded-lg p-2 text-texto-suave"
                  aria-label={tema === "escuro" ? "Tema claro" : "Tema escuro"}
                >
                  {tema === "escuro" ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                <nav className="flex gap-1 overflow-x-auto" aria-label="Principal">
                  {LINKS.map((link) => (
                    <NavLink
                      key={link.para}
                      to={
                        link.para === "/"
                          ? { pathname: "/", search: search_sem_tipo_gasto(location.search) }
                          : link.para
                      }
                      end={"fim" in link ? link.fim : false}
                      aria-label={link.rotulo}
                      onClick={() => {
                        if (link.para === "/") setGeracaoCockpit((n) => n + 1);
                      }}
                      className={({ isActive }) =>
                        unir_classes(
                          "rounded-lg p-2",
                          isActive ? "bg-primaria/15 text-primaria" : "text-texto-suave",
                        )
                      }
                    >
                      <link.icone size={18} aria-hidden />
                    </NavLink>
                  ))}
                </nav>
              </div>
            </div>
            <SeletorWorkspace aoMudar={aoMudarWorkspace} />
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet
              context={
                {
                  versoes,
                  invalidar,
                  posicaoPainel: posicao,
                  definirPosicaoPainel: definir_posicao,
                  tema,
                  geracaoCockpit,
                } satisfies ContextoLayout
              }
            />
          </main>
        </div>

        <PainelAssistente
          usuarioId={usuario.id}
          temContas={temContas}
          posicao={posicao}
          expandido={expandido}
          aoMudarPosicao={definir_posicao}
          aoMudarExpandido={definir_expandido}
          aoMudarDados={() => {
            invalidar("tudo");
            void recarregar_contexto();
          }}
        />
      </div>
    </div>
  );
}
