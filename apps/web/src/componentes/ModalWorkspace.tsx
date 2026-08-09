import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type ContaResumo,
  type CorWorkspace,
  type WorkspaceResumo,
} from "../lib/api";
import { classe_cor_workspace, CORES_WORKSPACE } from "../lib/cores-workspace";
import { Botao } from "./ui/Botao";
import { Campo } from "./ui/Campo";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  aberto: boolean;
  workspace?: WorkspaceResumo | null;
  aoFechar: () => void;
  aoSalvar: () => void;
};

export function ModalWorkspace({ aberto, workspace, aoFechar, aoSalvar }: Props) {
  const { usuario } = useAutenticacao();
  const editando = Boolean(workspace && !workspace.sintetico);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<CorWorkspace>("violet");
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [contaIds, setContaIds] = useState<Set<string>>(new Set());
  const [cartaoIds, setCartaoIds] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || !usuario) return;
    setErro(null);
    setNome(editando ? (workspace?.nome ?? "") : "");
    setCor((editando ? workspace?.cor : "violet") as CorWorkspace);
    setCarregando(true);
    void (async () => {
      try {
        const [todasContas, todosCartoes] = await Promise.all([
          clienteApi.listar_contas(usuario.id, true),
          clienteApi.listar_cartoes(usuario.id, true),
        ]);
        setContas(todasContas);
        setCartoes(todosCartoes);
        if (editando && workspace) {
          setContaIds(
            new Set(todasContas.filter((c) => c.workspaceId === workspace.id).map((c) => c.id)),
          );
          setCartaoIds(
            new Set(todosCartoes.filter((c) => c.workspaceId === workspace.id).map((c) => c.id)),
          );
        } else {
          setContaIds(new Set());
          setCartaoIds(new Set());
        }
      } catch (e) {
        setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar contas.");
      } finally {
        setCarregando(false);
      }
    })();
  }, [aberto, usuario, editando, workspace]);

  if (!aberto || !usuario) return null;

  function alternar(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const proximo = new Set(set);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    setter(proximo);
  }

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;
    if (contaIds.size + cartaoIds.size < 1) {
      setErro("Selecione ao menos uma conta ou cartão.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      let id = workspace?.id;
      if (editando && id) {
        await clienteApi.atualizar_workspace(id, {
          usuarioId: usuario.id,
          nome: nome.trim(),
          cor,
        });
      } else {
        const criado = await clienteApi.criar_workspace({
          usuarioId: usuario.id,
          nome: nome.trim(),
          cor,
        });
        id = criado.id;
      }
      await clienteApi.definir_membros_workspace(id!, {
        usuarioId: usuario.id,
        contaIds: [...contaIds],
        cartaoIds: [...cartaoIds],
      });
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar o workspace.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={(e) => void salvar(e)}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-borda bg-superficie shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-borda px-4 py-3">
          <h2 className="text-lg font-semibold text-texto">
            {editando ? "Editar workspace" : "Novo workspace"}
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1 text-texto-suave hover:bg-superficie-alta hover:text-texto"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Nome
            <Campo
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Pessoal"
              required
              autoFocus
            />
          </label>

          <div>
            <p className="mb-2 text-xs text-texto-suave">Cor</p>
            <div className="flex flex-wrap gap-2">
              {CORES_WORKSPACE.map((opcao) => (
                <button
                  key={opcao}
                  type="button"
                  title={opcao}
                  onClick={() => setCor(opcao)}
                  className={unir_classes(
                    "h-7 w-7 rounded-full transition",
                    classe_cor_workspace(opcao),
                    cor === opcao ? "ring-2 ring-primaria ring-offset-2 ring-offset-superficie scale-110" : "opacity-80 hover:opacity-100",
                  )}
                />
              ))}
            </div>
          </div>

          {carregando ? (
            <p className="text-sm text-texto-suave">Carregando contas...</p>
          ) : (
            <>
              <fieldset>
                <legend className="mb-2 text-xs text-texto-suave">Contas</legend>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-borda p-2">
                  {contas.length === 0 ? (
                    <li className="px-1 py-2 text-sm text-texto-suave">Nenhuma conta cadastrada.</li>
                  ) : (
                    contas.map((conta) => (
                      <li key={conta.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-superficie-alta">
                          <input
                            type="checkbox"
                            checked={contaIds.has(conta.id)}
                            onChange={() => alternar(contaIds, conta.id, setContaIds)}
                            className="accent-primaria"
                          />
                          <span className="flex-1 truncate text-texto">{conta.nome}</span>
                        </label>
                      </li>
                    ))
                  )}
                </ul>
                <p className="mt-1 text-xs text-texto-suave">{contaIds.size} selecionada(s)</p>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-xs text-texto-suave">Cartões</legend>
                <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-borda p-2">
                  {cartoes.length === 0 ? (
                    <li className="px-1 py-2 text-sm text-texto-suave">Nenhum cartão cadastrado.</li>
                  ) : (
                    cartoes.map((cartao) => (
                      <li key={cartao.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-superficie-alta">
                          <input
                            type="checkbox"
                            checked={cartaoIds.has(cartao.id)}
                            onChange={() => alternar(cartaoIds, cartao.id, setCartaoIds)}
                            className="accent-primaria"
                          />
                          <span className="flex-1 truncate text-texto">{cartao.nome}</span>
                        </label>
                      </li>
                    ))
                  )}
                </ul>
                <p className="mt-1 text-xs text-texto-suave">{cartaoIds.size} selecionada(s)</p>
              </fieldset>
            </>
          )}

          {erro && <p className="text-sm text-despesa">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-borda px-4 py-3">
          <Botao type="button" variante="fantasma" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            type="submit"
            disabled={salvando || carregando || !nome.trim()}
          >
            {salvando ? "Salvando..." : "Salvar"}
          </Botao>
        </div>
      </form>
    </div>
  );
}
