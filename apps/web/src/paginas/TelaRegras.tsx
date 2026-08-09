import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Pencil, Plus, Sparkles, Workflow } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type AcaoRegraApi,
  type CampoCondicaoRegra,
  type CategoriaResumo,
  type CondicaoRegraApi,
  type OperadorCondicaoRegra,
  type RegraResumo,
} from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { ModalRegra } from "../componentes/ModalRegra";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

const ROTULO_ORIGEM: Record<RegraResumo["origem"], string> = {
  manual: "Manual",
  aprendizado_conversa: "Aprendizado",
};

const ROTULO_CAMPO: Record<CampoCondicaoRegra, string> = {
  descricao: "Descrição",
  valor: "Valor",
  data: "Data",
  tipo: "Tipo",
  conta: "Conta",
  cartao: "Cartão",
};

const ROTULO_OPERADOR: Record<OperadorCondicaoRegra, string> = {
  comeca_com: "começa com",
  contem: "contém",
  nao_contem: "não contém",
  igual: "é igual a",
  diferente: "é diferente de",
  termina_com: "termina com",
  regex: "regex",
};

function resumir_condicao(condicao: CondicaoRegraApi): string {
  const campo = ROTULO_CAMPO[condicao.campo] ?? condicao.campo;
  const operador = ROTULO_OPERADOR[condicao.operador] ?? condicao.operador;
  return `${campo} ${operador} "${condicao.valor}"`;
}

function resumir_condicoes(regra: RegraResumo): string {
  const juntor = regra.logicaCondicoes === "e" ? " E " : " OU ";
  return regra.condicoes.map(resumir_condicao).join(juntor);
}

function badges_acoes(acoes: AcaoRegraApi[], categoriaNome: string | null): string[] {
  const badges: string[] = [];
  for (const acao of acoes) {
    if (acao.tipo === "definir_categoria") {
      badges.push(categoriaNome ?? "Categoria");
    } else if (acao.tipo === "definir_beneficiario") {
      badges.push("Beneficiário");
    } else if (acao.tipo === "adicionar_tags_notas") {
      badges.push("Tags/notas");
    } else if (acao.tipo === "ignorar_transacao") {
      badges.push("Ignorar");
    } else if (acao.tipo === "definir_perfil") {
      badges.push(acao.perfil.toUpperCase());
    }
  }
  return badges;
}

export function TelaRegras() {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const contexto = useContextoLayout();
  const [regras, setRegras] = useState<RegraResumo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [regraEditando, setRegraEditando] = useState<RegraResumo | null>(null);
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
      setCategorias(
        categoriasCarregadas.filter(
          (c) => c.nome.toLocaleLowerCase("pt-BR") !== "não classificado",
        ),
      );
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar as regras.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  function abrir_nova() {
    setRegraEditando(null);
    setModalAberto(true);
  }

  function abrir_edicao(regra: RegraResumo) {
    setRegraEditando(regra);
    setModalAberto(true);
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
      toast.sucesso(atualizada.ativa ? "Regra ativada." : "Regra desativada.");
      contexto?.invalidar("regras", "extrato");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível atualizar a regra.");
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
            Regras gerais do usuário: valem em todos os workspaces quando casam
          </p>
        </div>
        <Botao onClick={abrir_nova}>
          <Plus size={14} />
          Nova regra
        </Botao>
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

      {categorias.length === 0 && (
        <p className="text-sm text-texto-suave">
          Cadastre categorias antes de criar regras de classificação.{" "}
          <Link to="/categorias" className="text-primaria hover:underline">
            Ir para Categorias
          </Link>
        </p>
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
            <Botao onClick={abrir_nova}>
              <Plus size={14} />
              Nova regra
            </Botao>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {regras.map((regra, indice) => {
            const acoes = badges_acoes(regra.acoes, regra.categoriaNome);
            return (
              <motion.li
                key={regra.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: indice * 0.02 }}
                className={unir_classes(
                  "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3",
                  regra.ativa
                    ? "border-borda bg-superficie/80"
                    : "border-borda/60 bg-superficie/40 opacity-70",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-texto">{regra.nome}</p>
                    <span className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave">
                      {ROTULO_ORIGEM[regra.origem]}
                    </span>
                    {regra.origem === "aprendizado_conversa" && (
                      <Sparkles size={12} className="text-primaria" />
                    )}
                    {acoes.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-md border border-primaria/30 bg-primaria/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primaria"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-texto-suave">{resumir_condicoes(regra)}</p>
                  <p className="mt-0.5 text-[11px] text-texto-suave">
                    {regra.ativa ? "ativa" : "pausada"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Botao
                    variante="fantasma"
                    className="px-3"
                    onClick={() => abrir_edicao(regra)}
                    aria-label="Editar regra"
                  >
                    <Pencil size={14} />
                    Editar
                  </Botao>
                  <Botao variante="fantasma" onClick={() => void alternar_ativa(regra)}>
                    {regra.ativa ? "Pausar" : "Ativar"}
                  </Botao>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      <ModalRegra
        aberto={modalAberto}
        regra={regraEditando}
        categorias={categorias}
        aoFechar={() => {
          setModalAberto(false);
          setRegraEditando(null);
        }}
        aoSalvar={() => {
          void carregar();
          contexto?.invalidar("regras", "extrato");
        }}
      />
    </div>
  );
}
