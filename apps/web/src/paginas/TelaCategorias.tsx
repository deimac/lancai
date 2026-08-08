import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Plus, RefreshCw, Tags } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import {
  clienteApi,
  ErroApi,
  type CategoriaResumo,
  type TipoCategoria,
} from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { useContextoLayout } from "../layout/useContextoLayout";

const ROTULO_TIPO: Record<TipoCategoria, string> = {
  despesa: "Despesa",
  receita: "Receita",
  ambos: "Ambos",
};

const ORDEM_GRUPOS: TipoCategoria[] = ["despesa", "receita", "ambos"];

function eh_nao_classificado(nome: string): boolean {
  return nome.toLocaleLowerCase("pt-BR") === "não classificado";
}

export function TelaCategorias() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoCategoria>("despesa");
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

  const grupos = useMemo(() => {
    const mapa = new Map<TipoCategoria, CategoriaResumo[]>();
    for (const tipoGrupo of ORDEM_GRUPOS) mapa.set(tipoGrupo, []);
    for (const categoria of categorias) {
      const lista = mapa.get(categoria.tipo) ?? [];
      lista.push(categoria);
      mapa.set(categoria.tipo, lista);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    }
    return mapa;
  }, [categorias]);

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;
    if (eh_nao_classificado(nome.trim())) {
      setErro('"Não classificado" é reservada pelo sistema — escolha outro nome.');
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      await clienteApi.criar_categoria({
        usuarioId: usuario.id,
        nome: nome.trim(),
        tipo,
      });
      setNome("");
      setTipo("despesa");
      setMostrandoForm(false);
      await carregar();
      contexto?.invalidar("categorias", "extrato", "regras");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar a categoria.");
    } finally {
      setSalvando(false);
    }
  }

  if (!usuario) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Categorias</h1>
          <p className="text-sm text-texto-suave">
            Usadas por regras e pela IA — “Não classificado” é a fila do que ainda falta
          </p>
        </div>
        <div className="flex gap-2">
          <Botao variante="fantasma" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw size={14} className={carregando ? "animate-spin" : undefined} />
            Atualizar
          </Botao>
          <Botao onClick={() => setMostrandoForm((v) => !v)}>
            <Plus size={14} />
            Nova categoria
          </Botao>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-borda bg-superficie/80 p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-texto-suave">
            <Tags size={16} className="text-primaria" />
            <span className="text-xs uppercase tracking-wide">Total</span>
          </div>
          <p className="text-xl font-semibold tracking-tight text-texto">{categorias.length}</p>
        </div>
      </motion.div>

      {mostrandoForm && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => void criar(e)}
          className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <p className="text-sm font-medium text-texto">Nova categoria</p>
          <Campo
            placeholder="Nome (ex.: Pet)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
          />
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Tipo
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoCategoria)}
              className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
            >
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
              <option value="ambos">Ambos</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setMostrandoForm(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={salvando || !nome.trim()}>
              {salvando ? "Salvando..." : "Criar categoria"}
            </Botao>
          </div>
        </motion.form>
      )}

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {carregando && categorias.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : (
        <div className="flex flex-col gap-5">
          {ORDEM_GRUPOS.map((tipoGrupo) => {
            const itens = grupos.get(tipoGrupo) ?? [];
            if (itens.length === 0) return null;
            return (
              <section key={tipoGrupo} className="flex flex-col gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-texto-suave">
                  {ROTULO_TIPO[tipoGrupo]} · {itens.length}
                </h2>
                <ul className="flex flex-col gap-2">
                  {itens.map((categoria, indice) => {
                    const especial = eh_nao_classificado(categoria.nome);
                    return (
                      <motion.li
                        key={categoria.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: indice * 0.02 }}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/80 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-medium text-texto">{categoria.nome}</p>
                            {especial && (
                              <span
                                className="rounded-md border border-aviso/40 bg-aviso/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-aviso"
                                title="Fila do que ainda não foi classificado — não é 'Outros'"
                              >
                                Sistema
                              </span>
                            )}
                          </div>
                          {especial && (
                            <p className="mt-1 text-xs text-texto-suave">
                              Lançamentos do banco pousam aqui até regra, IA ou você classificar
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave">
                          {ROTULO_TIPO[categoria.tipo]}
                        </span>
                      </motion.li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
