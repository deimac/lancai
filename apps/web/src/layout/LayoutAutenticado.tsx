import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CreditCard,
  Home,
  Link2,
  List,
  LogOut,
  Settings,
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
import { Botao } from "../componentes/ui/Botao";
import { unir_classes } from "../lib/unir-classes";
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
  { para: "/", rotulo: "Início", icone: Home, fim: true },
  { para: "/contas", rotulo: "Contas", icone: Wallet, fim: false },
  { para: "/cartoes", rotulo: "Cartões", icone: CreditCard, fim: false },
  { para: "/categorias", rotulo: "Categorias", icone: Tags, fim: false },
  { para: "/regras", rotulo: "Regras", icone: Workflow, fim: false },
  { para: "/extrato", rotulo: "Extrato", icone: List, fim: false },
  { para: "/conexoes", rotulo: "Bancos", icone: Link2, fim: false },
  { para: "/configuracoes", rotulo: "Configurações", icone: Settings, fim: false },
] as const;

export type ContextoLayout = {
  versoes: VersoesDados;
  invalidar: (...alvos: AlvoInvalidacao[]) => void;
  posicaoPainel: PosicaoPainel;
  definirPosicaoPainel: (posicao: PosicaoPainel) => Promise<void>;
};

export function LayoutAutenticado() {
  const { usuario, sair, definir_usuario } = useAutenticacao();
  const [temContas, setTemContas] = useState(false);
  const [versoes, setVersoes] = useState<VersoesDados>(versao_inicial);
  const [posicao, setPosicao] = useState<PosicaoPainel>(() =>
    resolver_posicao_painel(undefined),
  );
  const [expandido, setExpandido] = useState(() => ler_painel_expandido());

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

  const invalidar = useCallback((...alvos: AlvoInvalidacao[]) => {
    setVersoes((atual) =>
      alvos.length > 0 ? avancar(atual, ...alvos) : avancar(atual, "tudo"),
    );
  }, []);

  const recarregar_contexto = useCallback(async () => {
    if (!usuario) return;
    try {
      const contas = await clienteApi.listar_contas(usuario.id);
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

  return (
    <div className="flex h-screen bg-fundo text-texto">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-borda bg-superficie/60 md:flex">
        <div className="border-b border-borda px-4 py-5">
          <p className="text-lg font-semibold tracking-tight text-texto">LançAI</p>
          <p className="truncate text-xs text-texto-suave">{usuario.nome}</p>
        </div>
        <SeletorWorkspace
          aoMudar={() => {
            invalidar("tudo");
            void recarregar_contexto();
          }}
        />
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Principal">
          {LINKS.map((link) => (
            <NavLink
              key={link.para}
              to={link.para}
              end={link.fim}
              className={({ isActive }) =>
                unir_classes(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-primaria/15 text-primaria"
                    : "text-texto-suave hover:bg-superficie-alta hover:text-texto",
                )
              }
            >
              <link.icone size={16} aria-hidden />
              {link.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-borda p-3">
          <Botao variante="fantasma" className="w-full justify-start" onClick={sair}>
            <LogOut size={14} aria-hidden />
            Sair
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
              <p className="font-semibold">LançAI</p>
              <nav className="flex gap-1" aria-label="Principal">
                {LINKS.map((link) => (
                  <NavLink
                    key={link.para}
                    to={link.para}
                    end={link.fim}
                    aria-label={link.rotulo}
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
            <SeletorWorkspace
              aoMudar={() => {
                invalidar("tudo");
                void recarregar_contexto();
              }}
            />
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet
              context={
                {
                  versoes,
                  invalidar,
                  posicaoPainel: posicao,
                  definirPosicaoPainel: definir_posicao,
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
