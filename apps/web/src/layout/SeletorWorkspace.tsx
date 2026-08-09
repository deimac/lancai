import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronsUpDown, Folder, Layers, Plus } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { ModalWorkspace } from "../componentes/ModalWorkspace";
import { clienteApi, ErroApi, type WorkspaceResumo } from "../lib/api";
import { classe_cor_workspace } from "../lib/cores-workspace";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  aoMudar: () => void;
};

function IconeWorkspace({ item }: { item: WorkspaceResumo }) {
  if (item.sintetico || item.id === "geral") {
    return <Layers size={14} className="shrink-0 text-primaria" aria-hidden />;
  }
  return (
    <span
      className={unir_classes(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded text-white",
        classe_cor_workspace(item.cor),
      )}
    >
      <Folder size={10} aria-hidden />
    </span>
  );
}

export function SeletorWorkspace({ aoMudar }: Props) {
  const { usuario } = useAutenticacao();
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState(false);
  const [modalCriar, setModalCriar] = useState(false);
  const [induzir, setInduzir] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      setWorkspaces(await clienteApi.listar_workspaces(usuario.id));
    } catch (e) {
      setWorkspaces([]);
      if (e instanceof ErroApi && e.status === 404) {
        setErro("A API em produção ainda não tem /workspaces. Faça redeploy da API.");
      } else {
        setErro(
          e instanceof ErroApi
            ? e.message
            : "Não foi possível carregar os workspaces.",
        );
      }
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const ativo = workspaces.find((item) => item.ativo) ?? workspaces[0];

  async function ativar(workspaceId: string) {
    if (!usuario || workspaceId === ativo?.id) {
      setAberto(false);
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      await clienteApi.definir_workspace_ativo(usuario.id, workspaceId);
      await carregar();
      setAberto(false);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível trocar o workspace.");
    } finally {
      setOcupado(false);
    }
  }

  async function ao_novo_workspace() {
    if (!usuario) return;
    setErro(null);
    try {
      const [contas, cartoes] = await Promise.all([
        clienteApi.listar_contas(usuario.id, true),
        clienteApi.listar_cartoes(usuario.id, true),
      ]);
      if (contas.length + cartoes.length === 0) {
        setInduzir(true);
        setModalCriar(false);
        return;
      }
      setInduzir(false);
      setAberto(false);
      setModalCriar(true);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível verificar suas contas.");
    }
  }

  if (!usuario) return null;

  if (carregando && !ativo) {
    return (
      <div className="px-3 pb-2">
        <div className="rounded-lg border border-borda bg-superficie px-3 py-2 text-xs text-texto-suave">
          Carregando workspace...
        </div>
      </div>
    );
  }

  if (!ativo) {
    return (
      <div className="px-3 pb-2">
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-xs text-texto">
          {erro ?? "Nenhum workspace disponível."}
          <button
            type="button"
            className="mt-1 block text-primaria hover:underline"
            onClick={() => void carregar()}
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative px-3 pb-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setInduzir(false);
            setAberto((v) => !v);
          }}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-borda bg-superficie px-3 py-2 text-left text-sm transition hover:border-primaria/50"
          title={ativo.descricao ?? "Trocar workspace"}
        >
          <span className="flex min-w-0 items-center gap-2">
            <IconeWorkspace item={ativo} />
            <span className="min-w-0">
              <span className="block truncate font-medium text-texto">{ativo.nome}</span>
              {ativo.descricao ? (
                <span className="block truncate text-[11px] text-texto-suave">{ativo.descricao}</span>
              ) : null}
            </span>
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-texto-suave" aria-hidden />
        </button>

        {aberto && (
          <div className="absolute left-3 right-3 z-30 mt-1 rounded-xl border border-borda bg-superficie p-2 shadow-lg">
            <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {workspaces.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => void ativar(item.id)}
                    title={item.descricao ?? undefined}
                    className={unir_classes(
                      "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                      item.ativo
                        ? "bg-primaria/15 text-primaria"
                        : "text-texto-suave hover:bg-superficie-alta hover:text-texto",
                    )}
                  >
                    <span className="mt-0.5">
                      <IconeWorkspace item={item} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{item.nome}</span>
                      {item.descricao ? (
                        <span className="block truncate text-[11px] opacity-80">{item.descricao}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => void ao_novo_workspace()}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-texto-suave hover:bg-superficie-alta hover:text-texto"
            >
              <Plus size={14} />
              Novo workspace
            </button>

            {induzir && (
              <div className="mt-2 rounded-lg border border-aviso/40 bg-aviso/10 px-2 py-2 text-xs text-texto">
                <p>Para criar um workspace, conecte um banco ou cadastre uma conta primeiro.</p>
                <button
                  type="button"
                  className="mt-1 font-medium text-primaria hover:underline"
                  onClick={() => {
                    setAberto(false);
                    setInduzir(false);
                    navigate("/contas");
                  }}
                >
                  Ir para Contas
                </button>
              </div>
            )}

            {erro && <p className="mt-2 px-1 text-xs text-despesa">{erro}</p>}
          </div>
        )}
      </div>

      <ModalWorkspace
        aberto={modalCriar}
        aoFechar={() => setModalCriar(false)}
        aoSalvar={() => {
          void carregar();
          aoMudar();
        }}
      />
    </>
  );
}
