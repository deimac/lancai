import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { MoreHorizontal, Pencil, Plus, Tags } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CategoriaResumo,
  type TipoCategoria,
} from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { formatar_moeda } from "../lib/formatar";
import {
  ICONES_CATEGORIA,
  PALETA_CATEGORIA,
  ROTULO_COR_CATEGORIA,
  ROTULO_ICONE_CATEGORIA,
  classe_cor_categoria,
} from "../lib/visual-categoria";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { MenuAcoes } from "../componentes/ui/MenuAcoes";
import { IconeCategoria } from "../componentes/IconeCategoria";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

const ROTULO_TIPO: Record<TipoCategoria, string> = {
  despesa: "Despesa",
  receita: "Receita",
  ambos: "Ambos",
};

type FormCategoria = {
  id?: string;
  nome: string;
  tipo: TipoCategoria;
  icone: string;
  cor: string;
  limite: string;
};

const FORM_VAZIO: FormCategoria = {
  nome: "",
  tipo: "despesa",
  icone: "geral",
  cor: "neutro",
  limite: "",
};

export function TelaCategorias() {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const contexto = useContextoLayout();
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<FormCategoria | null>(null);
  const [filtroIcone, setFiltroIcone] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const depsDados = chave_dependencia(contexto?.versoes, "categorias");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      setCategorias(await clienteApi.listar_categorias(usuario.id));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar as categorias.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  const iconesFiltrados = useMemo(() => {
    const busca = filtroIcone.trim().toLocaleLowerCase("pt-BR");
    if (!busca) return ICONES_CATEGORIA;
    return ICONES_CATEGORIA.filter((icone) =>
      ROTULO_ICONE_CATEGORIA[icone].toLocaleLowerCase("pt-BR").includes(busca),
    );
  }, [filtroIcone]);

  const ordenadas = useMemo(
    () =>
      [...categorias].sort((a, b) => {
        if (Boolean(a.sistema) !== Boolean(b.sistema)) return a.sistema ? -1 : 1;
        return a.nome.localeCompare(b.nome, "pt-BR");
      }),
    [categorias],
  );

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !form || !form.nome.trim()) return;
    setSalvando(true);
    setErro(null);
    const limite = form.limite.trim() === "" ? null : Number(form.limite.replace(",", "."));
    try {
      if (form.id) {
        await clienteApi.atualizar_categoria(form.id, {
          usuarioId: usuario.id,
          nome: form.nome.trim(),
          tipo: form.tipo,
          icone: form.icone,
          cor: form.cor,
          limite: Number.isFinite(limite) ? limite : null,
        });
        toast.sucesso("Categoria atualizada.");
      } else {
        await clienteApi.criar_categoria({
          usuarioId: usuario.id,
          nome: form.nome.trim(),
          tipo: form.tipo,
          icone: form.icone,
          cor: form.cor,
          limite: Number.isFinite(limite) ? limite : null,
        });
        toast.sucesso("Categoria criada.");
      }
      setForm(null);
      await carregar();
      contexto?.invalidar("categorias", "extrato", "regras", "dashboard");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível salvar a categoria.");
    } finally {
      setSalvando(false);
    }
  }

  function abrirForm(proximo: FormCategoria) {
    setFiltroIcone("");
    setForm(proximo);
  }

  if (!usuario) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Categorias</h1>
          <p className="text-sm text-texto-suave">
            Ícone, cor e limite mensal — as mesmas categorias nos dois workspaces
          </p>
        </div>
        <Botao onClick={() => abrirForm({ ...FORM_VAZIO })}>
          <Plus size={14} />
          Nova categoria
        </Botao>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {carregando && categorias.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie/80">
          <table className="min-w-[48rem] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-borda text-left text-[11px] uppercase tracking-wide text-texto-suave">
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Categoria</th>
                <th className="px-4 py-2 font-medium">Limite</th>
                <th className="px-4 py-2 font-medium">No mês</th>
                <th className="px-4 py-2 font-medium">Orçamento</th>
                <th className="px-4 py-2 font-medium">Movs.</th>
                <th className="w-12 px-2 py-2"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((categoria) => {
                const limite = categoria.limite ?? null;
                const gasto = categoria.gastoMes ?? 0;
                const pct = categoria.percentual;
                const estourou = pct != null && pct >= 100;
                return (
                  <tr key={categoria.id} className="border-b border-borda/70 last:border-0">
                    <td className="px-4 py-3 text-texto-suave">{ROTULO_TIPO[categoria.tipo]}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <IconeCategoria icone={categoria.icone} cor={categoria.cor} />
                        <span className="font-medium text-texto">{categoria.nome}</span>
                        {categoria.sistema && (
                          <span className="rounded-md border border-aviso/40 bg-aviso/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-aviso">
                            Sistema
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-texto-suave">
                      {limite == null ? "Sem limite" : formatar_moeda(limite)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-texto">{formatar_moeda(gasto)}</td>
                    <td className="min-w-[10rem] px-4 py-3">
                      {limite == null ? (
                        <span className="text-xs text-texto-suave">—</span>
                      ) : (
                        <div>
                          <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-borda">
                            <div
                              className={unir_classes(
                                "h-full rounded-full",
                                estourou ? "bg-despesa" : "bg-primaria",
                              )}
                              style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                            />
                          </div>
                          <p className={unir_classes("text-[11px]", estourou ? "text-despesa" : "text-texto-suave")}>
                            {Math.round(pct ?? 0)}%
                            {estourou
                              ? ` · ${formatar_moeda(gasto - limite)} acima`
                              : ` · resta ${formatar_moeda(Math.max(limite - gasto, 0))}`}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-texto-suave">
                      {categoria.movimentosMes ?? 0}
                    </td>
                    <td className="relative px-2 py-3">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-texto-suave hover:bg-fundo hover:text-texto"
                        onClick={() => setMenuId(menuId === categoria.id ? null : categoria.id)}
                        aria-label="Ações"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuId === categoria.id && (
                        <MenuAcoes
                          aoEscolher={() => setMenuId(null)}
                          acoes={[
                            {
                              rotulo: "Editar",
                              icone: Pencil,
                              onClick: () =>
                                abrirForm({
                                  id: categoria.id,
                                  nome: categoria.nome,
                                  tipo: categoria.tipo,
                                  icone: categoria.icone ?? "geral",
                                  cor: categoria.cor ?? "neutro",
                                  limite: categoria.limite != null ? String(categoria.limite) : "",
                                }),
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={(e) => void salvar(e)}
            className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border border-borda bg-superficie p-5 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <Tags size={16} className="text-primaria" />
              <h2 className="text-lg font-semibold text-texto">
                {form.id ? "Editar categoria" : "Nova categoria"}
              </h2>
            </div>
            <Campo
              placeholder="Nome"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
              autoFocus
            />
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Tipo
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoCategoria })}
                className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
              >
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
                <option value="ambos">Ambos</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Limite mensal (opcional)
              <Campo
                inputMode="decimal"
                placeholder="Sem limite"
                value={form.limite}
                onChange={(e) => setForm({ ...form, limite: e.target.value })}
              />
            </label>
            <div>
              <p className="mb-2 text-xs text-texto-suave">Cor</p>
              <div className="flex flex-wrap gap-2">
                {PALETA_CATEGORIA.map((cor) => (
                  <button
                    key={cor}
                    type="button"
                    title={ROTULO_COR_CATEGORIA[cor]}
                    onClick={() => setForm({ ...form, cor })}
                    className={unir_classes(
                      "h-7 w-7 rounded-full",
                      classe_cor_categoria(cor),
                      form.cor === cor ? "ring-2 ring-primaria ring-offset-2 ring-offset-superficie" : "",
                    )}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs text-texto-suave">Ícone</p>
              <Campo
                placeholder="Buscar ícone"
                value={filtroIcone}
                onChange={(e) => setFiltroIcone(e.target.value)}
              />
              <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-borda p-1.5">
                {iconesFiltrados.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-texto-suave">Nenhum ícone com esse nome.</p>
                ) : (
                  <div className="grid grid-cols-8 gap-1">
                    {iconesFiltrados.map((icone) => (
                      <button
                        key={icone}
                        type="button"
                        title={ROTULO_ICONE_CATEGORIA[icone]}
                        onClick={() => setForm({ ...form, icone })}
                        className={unir_classes(
                          "flex items-center justify-center rounded-lg p-1.5",
                          form.icone === icone ? "bg-primaria/15 ring-1 ring-primaria" : "hover:bg-fundo",
                        )}
                      >
                        <IconeCategoria icone={icone} variante="padrao" tamanho={16} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Botao type="button" variante="fantasma" onClick={() => setForm(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" disabled={salvando || !form.nome.trim()}>
                {salvando ? "Salvando..." : form.id ? "Salvar" : "Criar"}
              </Botao>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
