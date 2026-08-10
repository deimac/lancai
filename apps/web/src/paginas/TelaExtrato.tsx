import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Building2, PenLine } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type CategoriaResumo,
  type ContaResumo,
  type MovimentoResumo,
} from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { Cartao } from "../componentes/ui/Cartao";
import { useContextoLayout } from "../layout/useContextoLayout";
import {
  eh_nao_classificado,
  precisa_revisao,
  explicacao_classificacao,
  rotulo_classificado_por,
} from "../lib/fila-revisao";
import { unir_classes } from "../lib/unir-classes";

type FiltroExtrato = "todas" | "banco" | "manual" | "revisar";

function formatar_data(valor: string): string {
  const [ano, mes, dia] = valor.split("-");
  if (!ano || !mes || !dia) return valor;
  return `${dia}/${mes}/${ano}`;
}

function formatar_valor(tipo: string, valor: string): string {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return valor;
  const absoluto = numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte") {
    return `+ ${absoluto}`;
  }
  if (tipo === "despesa" || tipo === "retirada") {
    return `− ${absoluto}`;
  }
  return absoluto;
}

function cor_valor(tipo: string, status: MovimentoResumo["status"]): string {
  if (status === "cancelado") return "text-texto-suave line-through";
  if (tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte") {
    return "text-primaria";
  }
  if (tipo === "despesa" || tipo === "retirada") return "text-texto";
  return "text-texto-suave";
}

function nome_origem(
  movimento: MovimentoResumo,
  contas: ContaResumo[],
  cartoes: CartaoResumo[],
): string {
  if (movimento.contaId) {
    return contas.find((c) => c.id === movimento.contaId)?.nome ?? "Conta";
  }
  if (movimento.cartaoId) {
    return cartoes.find((c) => c.id === movimento.cartaoId)?.nome ?? "Cartão";
  }
  return "Sem origem";
}

function filtro_da_query(valor: string | null): FiltroExtrato {
  if (valor === "banco" || valor === "manual" || valor === "revisar" || valor === "todas") {
    return valor;
  }
  return "todas";
}

export function TelaExtrato() {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const contexto = useContextoLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const [movimentos, setMovimentos] = useState<MovimentoResumo[]>([]);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [visaoGeral, setVisaoGeral] = useState(false);
  const [filtro, setFiltro] = useState<FiltroExtrato>(() =>
    filtro_da_query(searchParams.get("fila") ?? searchParams.get("filtro")),
  );
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const depsDados = chave_dependencia(
    contexto?.versoes,
    "extrato",
    "categorias",
    "contas",
    "cartoes",
  );

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [
        movimentosCarregados,
        contasCarregadas,
        cartoesCarregados,
        categoriasCarregadas,
        workspaces,
      ] = await Promise.all([
        clienteApi.listar_movimentos(usuario.id),
        clienteApi.listar_contas(usuario.id),
        clienteApi.listar_cartoes(usuario.id),
        clienteApi.listar_categorias(usuario.id),
        clienteApi.listar_workspaces(usuario.id).catch(() => []),
      ]);
      setMovimentos(movimentosCarregados);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
      setCategorias(
        categoriasCarregadas.filter((c) => !eh_nao_classificado(c.nome)),
      );
      const ativo = workspaces.find((w) => w.ativo);
      setVisaoGeral(ativo?.id === "geral" || Boolean(ativo?.sintetico));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o extrato.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  useEffect(() => {
    const daUrl = filtro_da_query(searchParams.get("fila") ?? searchParams.get("filtro"));
    setFiltro(daUrl);
  }, [searchParams]);

  function escolher_filtro(proximo: FiltroExtrato) {
    setFiltro(proximo);
    if (proximo === "todas") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ fila: proximo }, { replace: true });
    }
  }

  const quantidadeRevisar = useMemo(
    () => movimentos.filter(precisa_revisao).length,
    [movimentos],
  );

  const visiveis = useMemo(() => {
    return movimentos.filter((movimento) => {
      if (filtro === "banco") return movimento.fonte === "open_finance";
      if (filtro === "manual") return movimento.fonte !== "open_finance";
      if (filtro === "revisar") return precisa_revisao(movimento);
      return true;
    });
  }, [movimentos, filtro]);

  async function classificar(movimentoId: string, categoriaId: string) {
    if (!usuario || !categoriaId) return;
    setSalvandoId(movimentoId);
    setErro(null);
    try {
      const atualizado = await clienteApi.atualizar_conhecimento({
        usuarioId: usuario.id,
        movimentoId,
        categoriaId,
      });
      setMovimentos((atual) =>
        atual.map((item) =>
          item.id === movimentoId
            ? {
                ...item,
                categoriaId: atualizado.categoriaId,
                categoriaNome: atualizado.categoriaNome,
                classificadoPor: atualizado.classificadoPor,
                regraId: atualizado.regraId,
                regraTrecho: null,
                classificadoEm: atualizado.classificadoEm,
                confiancaIa: atualizado.confiancaIa,
                perfil: atualizado.perfil,
              }
            : item,
        ),
      );
      contexto?.invalidar("extrato", "dashboard");
      toast.sucesso("Movimento classificado.");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível classificar.");
    } finally {
      setSalvandoId(null);
    }
  }

  if (!usuario) {
    return (
      <div className="flex h-full items-center justify-center text-texto-suave">Carregando...</div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-texto">Extrato</h1>
        <p className="text-sm text-texto-suave">
          {visaoGeral
            ? "Todos os workspaces — classifique e revise o que veio do banco ou do assistente"
            : "Classifique e revise o que veio do banco ou do assistente"}
        </p>
      </div>

      {quantidadeRevisar > 0 && filtro !== "revisar" && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => escolher_filtro("revisar")}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-aviso/40 bg-aviso/10 px-4 py-3 text-left transition hover:bg-aviso/15"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-aviso" />
            <p className="text-sm text-texto">
              {quantidadeRevisar} para revisar
              <span className="text-texto-suave"> — sem categoria ou IA insegura</span>
            </p>
          </div>
          <span className="text-sm font-medium text-primaria">Abrir fila</span>
        </motion.button>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["todas", "Todas"],
            ["banco", "Do banco"],
            ["manual", "Manuais"],
            ["revisar", `Revisar${quantidadeRevisar ? ` (${quantidadeRevisar})` : ""}`],
          ] as const
        ).map(([valor, rotulo]) => (
          <Botao
            key={valor}
            variante={filtro === valor ? "primaria" : "fantasma"}
            onClick={() => escolher_filtro(valor)}
          >
            {valor === "revisar" && <AlertTriangle size={14} />}
            {rotulo}
          </Botao>
        ))}
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {carregando && movimentos.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : visiveis.length === 0 ? (
        <Cartao>
          <p className="text-sm text-texto">
            {filtro === "revisar"
              ? "Fila limpa — nada para revisar."
              : "Nenhum lançamento por aqui."}
          </p>
          <p className="mt-1 text-xs text-texto-suave">
            {filtro === "banco"
              ? "Conecte um banco em Contas e associe as contas para o extrato aparecer."
              : filtro === "revisar"
                ? "Quando a IA classificar com pouca certeza, o item aparece aqui."
                : "Lance pelo assistente ou conecte um banco para começar."}
          </p>
          {filtro === "banco" && (
            <Link to="/contas" className="mt-3 inline-block text-sm text-primaria hover:underline">
              Ir para Contas
            </Link>
          )}
        </Cartao>
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((movimento, indice) => {
            const doBanco = movimento.fonte === "open_finance";
            const revisao = precisa_revisao(movimento);
            return (
              <motion.li
                key={movimento.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(indice, 12) * 0.015 }}
              >
                <div
                  className={unir_classes(
                    "rounded-2xl border px-4 py-3",
                    revisao
                      ? "border-aviso/35 bg-aviso/5"
                      : "border-borda bg-superficie/80",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-texto">
                          {movimento.descricao}
                        </p>
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave"
                          title={
                            doBanco
                              ? movimento.descricaoFonte
                              : "Lançamento criado manualmente"
                          }
                        >
                          {doBanco ? <Building2 size={10} /> : <PenLine size={10} />}
                          {doBanco ? "Banco" : "Manual"}
                        </span>
                        <span
                          className={unir_classes(
                            "rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                            revisao
                              ? "border-aviso/40 text-aviso"
                              : "border-borda text-texto-suave",
                          )}
                          title={explicacao_classificacao(movimento)}
                        >
                          {rotulo_classificado_por(
                            movimento.classificadoPor,
                            movimento.confiancaIa,
                          )}
                        </span>
                        {movimento.status === "previsto" && (
                          <span className="text-[10px] uppercase text-texto-suave">Pendente</span>
                        )}
                        {movimento.status === "cancelado" && (
                          <span className="text-[10px] uppercase text-texto-suave">Cancelado</span>
                        )}
                        {movimento.parcelaNumero && movimento.parcelaTotal && (
                          <span
                            className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] text-texto-suave"
                            title="Parcela da compra no cartão"
                          >
                            Parcela {movimento.parcelaNumero}/{movimento.parcelaTotal}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-texto-suave">
                        {formatar_data(movimento.dataMovimento)} ·{" "}
                        {nome_origem(movimento, contas, cartoes)}
                        {movimento.perfil ? ` · ${movimento.perfil.toUpperCase()}` : ""}
                      </p>
                      {!eh_nao_classificado(movimento.categoriaNome) && (
                        <p className="mt-0.5 text-xs text-texto-suave">
                          {explicacao_classificacao(movimento)}
                        </p>
                      )}
                    </div>
                    <p
                      className={`shrink-0 text-sm font-medium tabular-nums ${cor_valor(movimento.tipo, movimento.status)}`}
                    >
                      {formatar_valor(movimento.tipo, movimento.valor)}
                    </p>
                  </div>

                  {movimento.status !== "cancelado" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-texto-suave">
                        Categoria
                        <select
                          value={
                            eh_nao_classificado(movimento.categoriaNome)
                              ? ""
                              : movimento.categoriaId
                          }
                          disabled={salvandoId === movimento.id || categorias.length === 0}
                          onChange={(e) => {
                            if (e.target.value) void classificar(movimento.id, e.target.value);
                          }}
                          className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm normal-case tracking-normal text-texto outline-none focus:border-primaria disabled:opacity-60"
                        >
                          <option value="">
                            {eh_nao_classificado(movimento.categoriaNome)
                              ? "Escolher categoria..."
                              : movimento.categoriaNome}
                          </option>
                          {categorias.map((categoria) => (
                            <option key={categoria.id} value={categoria.id}>
                              {categoria.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                      {salvandoId === movimento.id && (
                        <span className="text-xs text-texto-suave">Salvando...</span>
                      )}
                    </div>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      {categorias.length === 0 && !carregando && (
        <p className="text-xs text-texto-suave">
          Sem categorias úteis.{" "}
          <Link to="/categorias" className="text-primaria hover:underline">
            Cadastre em Categorias
          </Link>
          .
        </p>
      )}
    </div>
  );
}
