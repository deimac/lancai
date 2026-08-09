import { useCallback, useEffect, useState } from "react";
import { Folder, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type WorkspaceResumo } from "../lib/api";
import { classe_cor_workspace } from "../lib/cores-workspace";
import { Botao } from "./ui/Botao";
import { ModalWorkspace } from "./ModalWorkspace";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
  /** Abre direto o modal de criação (vindo do seletor). */
  criarAoAbrir?: boolean;
};

export function PainelWorkspaces({ aberto, aoFechar, aoMudar, criarAoAbrir }: Props) {
  const { usuario } = useAutenticacao();
  const [workspaces, setWorkspaces] = useState<WorkspaceResumo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<WorkspaceResumo | null>(null);
  const [criando, setCriando] = useState(false);
  const [induzirContas, setInduzirContas] = useState(false);

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const lista = await clienteApi.listar_workspaces(usuario.id);
      setWorkspaces(lista.filter((w) => !w.sintetico));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar workspaces.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    if (!aberto) return;
    void carregar();
  }, [aberto, carregar]);

  useEffect(() => {
    if (!aberto || !criarAoAbrir || !usuario) return;
    void (async () => {
      try {
        const [contas, cartoes] = await Promise.all([
          clienteApi.listar_contas(usuario.id, true),
          clienteApi.listar_cartoes(usuario.id, true),
        ]);
        if (contas.length + cartoes.length === 0) {
          setInduzirContas(true);
          setCriando(false);
        } else {
          setInduzirContas(false);
          setCriando(true);
        }
      } catch {
        setInduzirContas(true);
      }
    })();
  }, [aberto, criarAoAbrir, usuario]);

  if (!aberto) return null;

  async function excluir(item: WorkspaceResumo) {
    if (!usuario) return;
    if (!window.confirm(`Excluir o workspace "${item.nome}"? Contas vão para o Principal.`)) {
      return;
    }
    try {
      await clienteApi.excluir_workspace(item.id, usuario.id);
      await carregar();
      aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível excluir.");
    }
  }

  async function ao_novo() {
    if (!usuario) return;
    const [contas, cartoes] = await Promise.all([
      clienteApi.listar_contas(usuario.id, true),
      clienteApi.listar_cartoes(usuario.id, true),
    ]);
    if (contas.length + cartoes.length === 0) {
      setInduzirContas(true);
      return;
    }
    setEditando(null);
    setCriando(true);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
        <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-borda bg-superficie shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-borda px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-texto">Workspaces</h2>
              <p className="text-sm text-texto-suave">Agrupe suas contas e cartões</p>
            </div>
            <div className="flex items-center gap-2">
              <Botao onClick={() => void ao_novo()}>
                <Plus size={14} />
                Novo
              </Botao>
              <button
                type="button"
                onClick={aoFechar}
                className="rounded-lg p-1 text-texto-suave hover:bg-superficie-alta"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-3">
            {induzirContas && (
              <div className="mb-3 rounded-xl border border-aviso/40 bg-aviso/10 px-3 py-3 text-sm text-texto">
                <p>Para criar um workspace, conecte um banco ou cadastre uma conta primeiro.</p>
                <a
                  href="/contas"
                  className="mt-2 inline-block font-medium text-primaria hover:underline"
                  onClick={aoFechar}
                >
                  Ir para Contas
                </a>
              </div>
            )}

            {erro && (
              <p className="mb-2 px-1 text-sm text-despesa">{erro}</p>
            )}

            {carregando ? (
              <p className="px-2 py-4 text-sm text-texto-suave">Carregando...</p>
            ) : workspaces.length === 0 ? (
              <p className="px-2 py-4 text-sm text-texto-suave">Nenhum workspace além do Principal automático.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {workspaces.map((item) => {
                  const n = (item.quantidadeContas ?? 0) + (item.quantidadeCartoes ?? 0);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl border border-borda px-3 py-2.5"
                    >
                      <span
                        className={unir_classes(
                          "flex h-9 w-9 items-center justify-center rounded-lg text-white",
                          classe_cor_workspace(item.cor),
                        )}
                      >
                        <Folder size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-texto">{item.nome}</p>
                        <p className="text-xs text-texto-suave">
                          {n} {n === 1 ? "conta/cartão" : "contas/cartões"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-texto-suave hover:bg-superficie-alta hover:text-texto"
                        title="Editar"
                        onClick={() => {
                          setCriando(false);
                          setEditando(item);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-texto-suave hover:bg-superficie-alta hover:text-despesa"
                        title="Excluir"
                        onClick={() => void excluir(item)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <ModalWorkspace
        aberto={criando || Boolean(editando)}
        workspace={editando}
        aoFechar={() => {
          setCriando(false);
          setEditando(null);
        }}
        aoSalvar={() => {
          void carregar();
          aoMudar();
        }}
      />
    </>
  );
}
