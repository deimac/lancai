import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Folder, Pencil, Plus, Trash2 } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useConfirmacao } from "../contexto/ContextoConfirmacao";
import { useToast } from "../contexto/ContextoToast";
import { clienteApi, ErroApi, type WorkspaceResumo } from "../lib/api";
import { classe_cor_workspace } from "../lib/cores-workspace";
import { Botao } from "./ui/Botao";
import { ModalWorkspace } from "./ModalWorkspace";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  aoVoltar: () => void;
  aoMudar: () => void;
};

export function PainelWorkspaces({ aoVoltar, aoMudar }: Props) {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const { confirmar } = useConfirmacao();
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
    void carregar();
  }, [carregar]);

  if (!usuario) return null;

  async function excluir(item: WorkspaceResumo) {
    if (!usuario) return;
    const ok = await confirmar({
      titulo: "Excluir workspace?",
      mensagem:
        `Esta ação é irreversível. O workspace "${item.nome}" será removido e as contas ` +
        "vinculadas voltam para o Principal.",
      confirmarRotulo: "Excluir",
    });
    if (!ok) return;
    try {
      await clienteApi.excluir_workspace(item.id, usuario.id);
      toast.sucesso("Workspace excluído.");
      await carregar();
      aoMudar();
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível excluir.");
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
    setInduzirContas(false);
    setEditando(null);
    setCriando(true);
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={aoVoltar}
              className="mb-2 flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
            >
              <ArrowLeft size={14} />
              Voltar para Contas
            </button>
            <h1 className="text-2xl font-semibold tracking-tight text-texto">Workspaces</h1>
            <p className="text-sm text-texto-suave">Agrupe suas contas e cartões</p>
          </div>
          <Botao onClick={() => void ao_novo()}>
            <Plus size={14} />
            Novo workspace
          </Botao>
        </div>

        {induzirContas && (
          <div className="rounded-xl border border-aviso/40 bg-aviso/10 px-3 py-3 text-sm text-texto">
            <p>Para criar um workspace, conecte um banco ou cadastre uma conta primeiro.</p>
            <button
              type="button"
              className="mt-2 font-medium text-primaria hover:underline"
              onClick={aoVoltar}
            >
              Voltar e cadastrar conta
            </button>
          </div>
        )}

        {erro && (
          <p className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
            {erro}
          </p>
        )}

        {carregando ? (
          <p className="text-sm text-texto-suave">Carregando...</p>
        ) : workspaces.length === 0 ? (
          <p className="rounded-2xl border border-borda bg-superficie/80 p-4 text-sm text-texto-suave">
            Nenhum workspace ainda. Crie um para organizar suas contas.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {workspaces.map((item) => {
              const nContas = item.quantidadeContas ?? 0;
              const nCartoes = item.quantidadeCartoes ?? 0;
              const partes: string[] = [];
              if (nContas > 0) {
                partes.push(`${nContas} ${nContas === 1 ? "conta" : "contas"}`);
              }
              if (nCartoes > 0) {
                partes.push(`${nCartoes} ${nCartoes === 1 ? "cartão" : "cartões"}`);
              }
              const resumo = partes.length > 0 ? partes.join(" · ") : "Nenhuma conta ou cartão";
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-borda bg-superficie/80 px-4 py-3"
                >
                  <span
                    className={unir_classes(
                      "flex h-10 w-10 items-center justify-center rounded-lg text-white",
                      classe_cor_workspace(item.cor),
                    )}
                  >
                    <Folder size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-texto">{item.nome}</p>
                    <p className="text-xs text-texto-suave">{resumo}</p>
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
