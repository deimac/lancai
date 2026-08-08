import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building2, ChevronsUpDown, Plus, User } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type TipoWorkspace, type WorkspaceResumo } from "../lib/api";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  aoMudar: () => void;
};

export function SeletorWorkspace({ aoMudar }: Props) {
  const { usuario } = useAutenticacao();
  const [workspaces, setWorkspaces] = useState<WorkspaceResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoWorkspace>("empresa");
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
      setErro(
        e instanceof ErroApi
          ? e.message
          : "Não foi possível carregar os workspaces. Confira se a API está atualizada e a migration 0017 aplicada.",
      );
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

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;
    setOcupado(true);
    setErro(null);
    try {
      await clienteApi.criar_workspace({
        usuarioId: usuario.id,
        nome: nome.trim(),
        tipo,
      });
      setNome("");
      setTipo("empresa");
      setCriando(false);
      await carregar();
      setAberto(false);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar o workspace.");
    } finally {
      setOcupado(false);
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
    <div className="relative px-3 pb-2">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-borda bg-superficie px-3 py-2 text-left text-sm transition hover:border-primaria/50"
        title="Trocar workspace"
      >
        <span className="flex min-w-0 items-center gap-2">
          {ativo.tipo === "empresa" ? (
            <Building2 size={14} className="shrink-0 text-primaria" aria-hidden />
          ) : (
            <User size={14} className="shrink-0 text-primaria" aria-hidden />
          )}
          <span className="truncate font-medium text-texto">{ativo.nome}</span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-texto-suave" aria-hidden />
      </button>

      {aberto && (
        <div className="absolute left-3 right-3 z-30 mt-1 rounded-xl border border-borda bg-superficie p-2 shadow-lg">
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {workspaces.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => void ativar(item.id)}
                  className={unir_classes(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                    item.ativo
                      ? "bg-primaria/15 text-primaria"
                      : "text-texto-suave hover:bg-superficie-alta hover:text-texto",
                  )}
                >
                  {item.tipo === "empresa" ? <Building2 size={14} /> : <User size={14} />}
                  <span className="truncate">{item.nome}</span>
                </button>
              </li>
            ))}
          </ul>

          {criando ? (
            <form onSubmit={(e) => void criar(e)} className="mt-2 flex flex-col gap-2 border-t border-borda pt-2">
              <Campo
                placeholder="Nome (ex.: Empresa)"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                autoFocus
              />
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoWorkspace)}
                className="rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm text-texto"
              >
                <option value="pessoal">Pessoal</option>
                <option value="empresa">Empresa</option>
              </select>
              <div className="flex gap-1">
                <Botao type="button" variante="fantasma" className="flex-1" onClick={() => setCriando(false)}>
                  Cancelar
                </Botao>
                <Botao type="submit" className="flex-1" disabled={ocupado || !nome.trim()}>
                  Criar
                </Botao>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCriando(true)}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-texto-suave hover:bg-superficie-alta hover:text-texto"
            >
              <Plus size={14} />
              Novo workspace
            </button>
          )}

          {erro && <p className="mt-2 px-1 text-xs text-despesa">{erro}</p>}
        </div>
      )}
    </div>
  );
}
