import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, RefreshCw, Sparkles, Workflow } from "lucide-react";
import type { Perfil } from "@lancai/tipos";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import {
  clienteApi,
  ErroApi,
  type CategoriaResumo,
  type RegraResumo,
} from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

const ROTULO_ORIGEM: Record<RegraResumo["origem"], string> = {
  manual: "Manual",
  aprendizado_conversa: "Aprendizado",
};

export function TelaRegras() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [regras, setRegras] = useState<RegraResumo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [trecho, setTrecho] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [perfil, setPerfil] = useState<"" | Perfil>("");
  const depsDados = chave_dependencia(contexto?.versoes, "regras", "categorias");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [regrasCarregadas, categoriasCarregadas] = await Promise.all([
        clienteApi.listar_regras(usuario.id),
        clienteApi.listar_categorias(usuario.id),
      ]);
      setRegras(regrasCarregadas);
      const elegiveis = categoriasCarregadas.filter(
        (c) => c.nome.toLocaleLowerCase("pt-BR") !== "não classificado",
      );
      setCategorias(elegiveis);
      setCategoriaId((atual) => atual || elegiveis[0]?.id || "");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar as regras.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !trecho.trim() || !categoriaId) return;
    setSalvando(true);
    setErro(null);
    try {
      await clienteApi.criar_regra({
        usuarioId: usuario.id,
        condicaoValor: trecho.trim(),
        categoriaId,
        ...(perfil ? { perfil } : {}),
      });
      setTrecho("");
      setPerfil("");
      setMostrandoForm(false);
      await carregar();
      contexto?.invalidar("regras", "extrato");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar a regra.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternar_ativa(regra: RegraResumo) {
    if (!usuario) return;
    setErro(null);
    try {
      const atualizada = await clienteApi.definir_ativa_regra({
        regraId: regra.id,
        usuarioId: usuario.id,
        ativa: !regra.ativa,
      });
      setRegras((atual) => atual.map((item) => (item.id === atualizada.id ? atualizada : item)));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível atualizar a regra.");
    }
  }

  if (!usuario) return null;

  const ativas = regras.filter((r) => r.ativa).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Regras</h1>
          <p className="text-sm text-texto-suave">
            Se a descrição contém o trecho, classifica sem chamar modelo
          </p>
        </div>
        <div className="flex gap-2">
          <Botao variante="fantasma" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw size={14} className={carregando ? "animate-spin" : undefined} />
            Atualizar
          </Botao>
          <Botao onClick={() => setMostrandoForm((v) => !v)}>
            <Plus size={14} />
            Nova regra
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
            <Workflow size={16} className="text-primaria" />
            <span className="text-xs uppercase tracking-wide">Ativas</span>
          </div>
          <p className="text-xl font-semibold tracking-tight text-texto">
            {ativas}
            <span className="text-sm font-normal text-texto-suave"> / {regras.length}</span>
          </p>
        </div>
      </motion.div>

      {mostrandoForm && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => void criar(e)}
          className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <p className="text-sm font-medium text-texto">Nova regra</p>
          <p className="text-xs text-texto-suave">
            Ex.: trecho <span className="text-texto">IFOOD</span> → categoria Restaurantes. Também
            dá para ensinar pelo assistente (“virar regra?”).
          </p>
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Descrição contém
            <Campo
              placeholder="IFOOD"
              value={trecho}
              onChange={(e) => setTrecho(e.target.value)}
              required
              minLength={2}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Categoria
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              required
              className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
            >
              {categorias.length === 0 && <option value="">Cadastre uma categoria primeiro</option>}
              {categorias.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Perfil (opcional)
            <select
              value={perfil}
              onChange={(e) => setPerfil(e.target.value as "" | Perfil)}
              className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
            >
              <option value="">Não definir</option>
              <option value="pf">Pessoal (PF)</option>
              <option value="pj">Empresa (PJ)</option>
            </select>
          </label>
          {categorias.length === 0 && (
            <Link to="/categorias" className="text-sm text-primaria hover:underline">
              Ir para Categorias
            </Link>
          )}
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setMostrandoForm(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={salvando || !trecho.trim() || !categoriaId}>
              {salvando ? "Salvando..." : "Criar regra"}
            </Botao>
          </div>
        </motion.form>
      )}

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {carregando && regras.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : regras.length === 0 ? (
        <div className="rounded-2xl border border-borda bg-superficie/80 p-6 text-center">
          <p className="text-sm text-texto">Nenhuma regra ainda.</p>
          <p className="mt-1 text-xs text-texto-suave">
            Crie uma regra ou classifique no assistente e aceite “virar regra?”.
          </p>
          <div className="mt-4 flex justify-center">
            <Botao onClick={() => setMostrandoForm(true)}>
              <Plus size={14} />
              Nova regra
            </Botao>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {regras.map((regra, indice) => (
            <motion.li
              key={regra.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: indice * 0.02 }}
              className={unir_classes(
                "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3",
                regra.ativa
                  ? "border-borda bg-superficie/80"
                  : "border-borda/60 bg-superficie/40 opacity-70",
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-texto">
                    <span className="text-primaria">“{regra.condicaoValor}”</span>
                    <span className="text-texto-suave"> → </span>
                    {regra.categoriaNome}
                  </p>
                  <span className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave">
                    {ROTULO_ORIGEM[regra.origem]}
                  </span>
                  {regra.origem === "aprendizado_conversa" && (
                    <Sparkles size={12} className="text-primaria" />
                  )}
                  {regra.perfil && (
                    <span className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave">
                      {regra.perfil}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-texto-suave">
                  descrição contém · {regra.ativa ? "ativa" : "pausada"}
                </p>
              </div>
              <Botao
                variante="fantasma"
                className="shrink-0"
                onClick={() => void alternar_ativa(regra)}
              >
                {regra.ativa ? "Pausar" : "Ativar"}
              </Botao>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
