import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  ListFilter,
  MoreHorizontal,
  Repeat,
  Search,
  Tags,
  Trash2,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useConfirmacao } from "../contexto/ContextoConfirmacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type CategoriaResumo,
  type ContaResumo,
  type MovimentoResumo,
} from "../lib/api";
import { sugerir_pagamento_fatura, selo_fatura_ciclo, type Perfil, hora_visivel_do_fato } from "@lancai/tipos";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Campo } from "../componentes/ui/Campo";
import { Cartao } from "../componentes/ui/Cartao";
import { MenuAcoes } from "../componentes/ui/MenuAcoes";
import { ModalPagamentoFatura } from "../componentes/ui/ModalPagamentoFatura";
import { SeletorVisual } from "../componentes/ui/SeletorVisual";
import { DrawerFiltrosExtrato } from "../componentes/DrawerFiltrosExtrato";
import { IconeCategoria } from "../componentes/IconeCategoria";
import { Paginador } from "../componentes/Paginador";
import { SeletorTipoGasto } from "../componentes/SeletorTipoGasto";
import { Dica } from "../componentes/ui/Dica";
import { mes_de_hoje, normalizar_mes, SeletorMes } from "../componentes/SeletorMes";
import { useContextoLayout } from "../layout/useContextoLayout";
import {
  eh_categoria_pagamento_fatura,
  eh_nao_classificado,
  precisa_revisao,
  rotulo_classificado_por,
} from "../lib/fila-revisao";
import {
  competencia_default_fatura,
  modo_convite_pagamento_fatura,
  mostra_acao_pagamento_fatura,
  mostra_check_pagamento_fatura,
} from "../lib/extrato-pagamento-fatura";
import {
  dispensar_convite_fatura,
  ler_faturas_dispensadas,
} from "../lib/preferencias-fatura-dispensada";
import { formatar_moeda } from "../lib/formatar";
import {
  classificacao_da_query,
  fila_da_query,
  filtrar_extrato,
  nome_origem_movimento,
  origem_da_query,
  origem_para_query,
  ordenar_categorias_por_uso,
  paginar,
  papel_da_query,
  papel_para_query,
  quantidade_filtros_drawer,
  resumir_extrato,
  tamanho_pagina_da_query,
  tipo_gasto_da_query,
  tipo_gasto_para_query,
  TAMANHO_PAGINA_PADRAO,
  type ClassificacaoExtrato,
  type FilaExtrato,
  type OrigemExtrato,
  type PapelExtrato,
  type TipoGastoExtrato,
} from "../lib/filtrar-extrato";
import {
  pode_excluir_movimento,
  rotulo_natureza,
} from "../lib/natureza-extrato";
import { unir_classes } from "../lib/unir-classes";

function formatar_data(valor: string): string {
  const [ano, mes, dia] = valor.split("-");
  if (!ano || !mes || !dia) return valor;
  return `${dia}/${mes}/${ano}`;
}

function formatar_moeda_br(valor: number | string): string {
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (Number.isNaN(numero)) return String(valor);
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mensagem_classificacao(parcelas: number, iguais: number): string {
  if (iguais > 0 && parcelas > 0) {
    return `Classifiquei as ${parcelas + 1} parcelas desta compra e mais ${iguais} lançamento${iguais === 1 ? "" : "s"} igual${iguais === 1 ? "" : "is"}.`;
  }
  if (iguais > 0) {
    return iguais === 1
      ? "Classifiquei este e mais 1 lançamento igual."
      : `Classifiquei este e mais ${iguais} lançamentos iguais.`;
  }
  if (parcelas > 0) {
    return `Classifiquei as ${parcelas + 1} parcelas desta compra.`;
  }
  return "Movimento classificado.";
}

function formatar_valor(tipo: string, valor: string): string {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return valor;
  const absoluto = formatar_moeda_br(numero);
  if (tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte") {
    return `+ ${absoluto}`;
  }
  if (tipo === "despesa" || tipo === "retirada") {
    return `− ${absoluto}`;
  }
  return absoluto;
}

function formatar_mes_competencia(dataISO: string): string {
  const [ano, mes] = dataISO.split("-");
  if (!ano || !mes) return dataISO;
  const rotulos = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  const indice = Number(mes) - 1;
  return `${rotulos[indice] ?? mes}/${ano.slice(2)}`;
}

type ParcelasIrmasResposta = Awaited<ReturnType<typeof clienteApi.listar_parcelas_irmas>>;

function cor_valor(tipo: string, status: MovimentoResumo["status"]): string {
  if (status === "cancelado") return "text-texto-suave line-through";
  if (tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte") {
    return "text-primaria";
  }
  if (tipo === "despesa" || tipo === "retirada") return "text-texto";
  return "text-texto-suave";
}

function perfil_origem_movimento(
  movimento: Pick<MovimentoResumo, "contaId" | "cartaoId">,
  contas: ContaResumo[],
  cartoes: CartaoResumo[],
): Perfil | null {
  if (movimento.contaId) {
    return contas.find((c) => c.id === movimento.contaId)?.perfil ?? null;
  }
  if (movimento.cartaoId) {
    return cartoes.find((c) => c.id === movimento.cartaoId)?.perfil ?? null;
  }
  return null;
}

function rotulo_tipo_gasto(tipo: Perfil | null | undefined): string {
  if (tipo === "pj") return "Empresa";
  if (tipo === "pf") return "Pessoal";
  return "";
}

function IconeProximaFatura({ dica, tamanho = 14 }: { dica?: string; tamanho?: number }) {
  const icone = (
    <CalendarClock size={tamanho} className="shrink-0 text-aviso" aria-hidden />
  );
  if (!dica) return icone;
  return (
    <Dica texto={dica}>
      <span className="inline-flex cursor-default" role="img" aria-label={dica}>
        {icone}
      </span>
    </Dica>
  );
}

function ChipFiltro({ rotulo, onLimpar }: { rotulo: string; onLimpar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-borda bg-superficie-alta px-2.5 py-0.5 text-xs text-texto">
      {rotulo}
      <button
        type="button"
        onClick={onLimpar}
        className="rounded-full p-0.5 text-texto-suave hover:text-texto"
        aria-label={`Remover filtro ${rotulo}`}
      >
        <X size={12} />
      </button>
    </span>
  );
}

function PainelResumo({
  titulo,
  valor,
  detalhe,
  icone: Icone,
  tom,
}: {
  titulo: string;
  valor: string;
  detalhe: string;
  icone: ComponentType<{ size?: number; className?: string }>;
  tom: "receita" | "despesa";
}) {
  return (
    <div className="rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/20">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">{titulo}</span>
        <Icone size={16} className={tom === "receita" ? "text-receita" : "text-despesa"} />
      </div>
      <p
        className={unir_classes(
          "text-2xl font-semibold tracking-tight tabular-nums",
          tom === "receita" ? "text-receita" : "text-despesa",
        )}
      >
        {valor}
      </p>
      <p className="mt-1 text-xs text-texto-suave">{detalhe}</p>
    </div>
  );
}

export function TelaExtrato() {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const { confirmar } = useConfirmacao();
  const contexto = useContextoLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const mes = normalizar_mes(searchParams.get("mes"), mes_de_hoje());
  const filtro = fila_da_query(searchParams.get("fila") ?? searchParams.get("filtro"));
  const busca = searchParams.get("q") ?? "";
  const categoriaId = searchParams.get("categoria");
  const classificacao = classificacao_da_query(searchParams.get("classificacao"));
  const origem = origem_da_query(searchParams.get("origem"));
  const tipoGasto = tipo_gasto_da_query(searchParams.get("tipoGasto"));
  const papel = papel_da_query(searchParams.get("papel"));
  const porPagina = tamanho_pagina_da_query(searchParams.get("porPagina"));
  const [pagina, setPagina] = useState(1);
  const [movimentos, setMovimentos] = useState<MovimentoResumo[]>([]);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [cartoesTodos, setCartoesTodos] = useState<CartaoResumo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [visaoGeral, setVisaoGeral] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [parcelasExpandidasId, setParcelasExpandidasId] = useState<string | null>(null);
  const [parcelasPorMovimento, setParcelasPorMovimento] = useState<
    Record<string, ParcelasIrmasResposta>
  >({});
  const [carregandoParcelasId, setCarregandoParcelasId] = useState<string | null>(null);
  const [ofertaRegra, setOfertaRegra] = useState<{
    movimentoId: string;
    trecho: string;
  } | null>(null);
  const [faturasDispensadas, setFaturasDispensadas] = useState<Set<string>>(
    () => (usuario ? ler_faturas_dispensadas(usuario.id) : new Set()),
  );
  const [pedidoFatura, setPedidoFatura] = useState<{
    movimento: MovimentoResumo;
    cartaoId: string | null;
    competencia: string;
  } | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
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
        cartoesTodosCarregados,
        categoriasCarregadas,
        workspaces,
      ] = await Promise.all([
        clienteApi.listar_movimentos(usuario.id),
        clienteApi.listar_contas(usuario.id),
        clienteApi.listar_cartoes(usuario.id),
        clienteApi.listar_cartoes(usuario.id, true),
        clienteApi.listar_categorias(usuario.id),
        clienteApi.listar_workspaces(usuario.id).catch(() => []),
      ]);
      setMovimentos(movimentosCarregados);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
      setCartoesTodos(cartoesTodosCarregados);
      setCategorias(categoriasCarregadas);
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
    if (!usuario) return;
    setFaturasDispensadas(ler_faturas_dispensadas(usuario.id));
  }, [usuario?.id]);

  function sincronizar_params(entrada: {
    filtro?: FilaExtrato;
    mes?: string;
    busca?: string;
    categoriaId?: string | null;
    classificacao?: ClassificacaoExtrato;
    origem?: OrigemExtrato;
    tipoGasto?: TipoGastoExtrato;
    papel?: PapelExtrato;
    porPagina?: number;
  }) {
    const proximoFiltro = entrada.filtro ?? filtro;
    const proximoMes = entrada.mes ?? mes;
    const proximaBusca = entrada.busca ?? busca;
    const proximaCategoria =
      entrada.categoriaId === undefined ? categoriaId : entrada.categoriaId;
    const proximaClassificacao = entrada.classificacao ?? classificacao;
    const proximaOrigem = entrada.origem ?? origem;
    const proximoTipoGasto = entrada.tipoGasto ?? tipoGasto;
    const proximoPapel = entrada.papel ?? papel;
    const proximoPorPagina = entrada.porPagina ?? porPagina;
    const params = new URLSearchParams();
    if (proximoFiltro !== "todas") params.set("fila", proximoFiltro);
    if (proximoMes !== mes_de_hoje()) params.set("mes", proximoMes);
    if (proximaBusca.trim()) params.set("q", proximaBusca);
    if (proximaCategoria) params.set("categoria", proximaCategoria);
    if (proximaClassificacao !== "todas") params.set("classificacao", proximaClassificacao);
    const origemQuery = origem_para_query(proximaOrigem);
    if (origemQuery) params.set("origem", origemQuery);
    const tipoGastoQuery = tipo_gasto_para_query(proximoTipoGasto);
    if (tipoGastoQuery) params.set("tipoGasto", tipoGastoQuery);
    const papelQuery = papel_para_query(proximoPapel);
    if (papelQuery) params.set("papel", papelQuery);
    if (proximoPorPagina !== TAMANHO_PAGINA_PADRAO) {
      params.set("porPagina", String(proximoPorPagina));
    }
    setSearchParams(params, { replace: true });
    setPagina(1);
  }

  function escolher_filtro(proximo: FilaExtrato) {
    sincronizar_params({ filtro: proximo });
  }

  function escolher_mes(proximo: string) {
    sincronizar_params({ mes: proximo });
  }

  async function alternar_parcelas(movimentoId: string) {
    if (!usuario) return;
    if (parcelasExpandidasId === movimentoId) {
      setParcelasExpandidasId(null);
      return;
    }
    setParcelasExpandidasId(movimentoId);
    if (parcelasPorMovimento[movimentoId]) return;
    setCarregandoParcelasId(movimentoId);
    try {
      const resposta = await clienteApi.listar_parcelas_irmas(movimentoId, usuario.id);
      setParcelasPorMovimento((atual) => ({ ...atual, [movimentoId]: resposta }));
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível carregar as parcelas.");
      setParcelasExpandidasId(null);
    } finally {
      setCarregandoParcelasId(null);
    }
  }

  const categoriasParaClassificar = useMemo(
    () =>
      ordenar_categorias_por_uso(
        categorias.filter(
          (c) => !eh_nao_classificado(c.nome) && !eh_categoria_pagamento_fatura(c.nome),
        ),
        movimentos,
      ),
    [categorias, movimentos],
  );

  const visiveis = useMemo(
    () =>
      filtrar_extrato(movimentos, contas, cartoes, {
        mes,
        fila: filtro,
        busca,
        categoriaId,
        classificacao,
        origem,
        tipoGasto,
        papel,
      }),
    [movimentos, contas, cartoes, mes, filtro, busca, categoriaId, classificacao, origem, tipoGasto, papel],
  );

  const paginaAtual = useMemo(
    () => paginar(visiveis, pagina, porPagina),
    [visiveis, pagina, porPagina],
  );

  const resumo = useMemo(
    () => resumir_extrato(visiveis, { mes, cartoes: cartoesTodos }),
    [visiveis, mes, cartoesTodos],
  );

  const filtrosDrawer = quantidade_filtros_drawer({
    categoriaId,
    classificacao,
    papel,
    fila: filtro,
  });

  const filtrosAtivos =
    busca.trim() !== "" ||
    Boolean(categoriaId) ||
    classificacao !== "todas" ||
    origem.tipo !== "todas" ||
    tipoGasto !== "todas" ||
    papel !== "todas";

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
                tipoGasto: atualizado.tipoGasto,
                ignoradoEmRelatorio: atualizado.ignoradoEmRelatorio,
                papel: atualizado.papel,
                cartaoFaturaId: atualizado.cartaoFaturaId,
                competenciaFatura: atualizado.competenciaFatura,
              }
            : item,
        ),
      );
      contexto?.invalidar("extrato", "dashboard");
      toast.sucesso(
        mensagem_classificacao(atualizado.parcelasAtualizadas ?? 0, atualizado.iguaisAtualizados ?? 0),
      );
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível classificar.");
    } finally {
      setSalvandoId(null);
    }
  }

  async function alterar_tipo_gasto(movimentoId: string, proximo: Perfil) {
    if (!usuario) return;
    setSalvandoId(movimentoId);
    setErro(null);
    try {
      const atualizado = await clienteApi.atualizar_conhecimento({
        usuarioId: usuario.id,
        movimentoId,
        tipoGasto: proximo,
      });
      setMovimentos((atual) =>
        atual.map((item) =>
          item.id === movimentoId ? { ...item, tipoGasto: atualizado.tipoGasto } : item,
        ),
      );
      contexto?.invalidar("extrato", "dashboard");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível atualizar o tipo de gasto.");
    } finally {
      setSalvandoId(null);
    }
  }

  function aplicar_conhecimento_local(
    movimentoId: string,
    atualizado: Awaited<ReturnType<typeof clienteApi.atualizar_conhecimento>>,
  ) {
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
              tipoGasto: atualizado.tipoGasto,
              ignoradoEmRelatorio: atualizado.ignoradoEmRelatorio,
              papel: atualizado.papel,
              cartaoFaturaId: atualizado.cartaoFaturaId,
              competenciaFatura: atualizado.competenciaFatura,
            }
          : item,
      ),
    );
  }

  async function marcar_pagamento_fatura(
    movimento: MovimentoResumo,
    marcado: boolean,
    cartaoFaturaId?: string | null,
    competenciaFatura?: string | null,
  ): Promise<boolean> {
    if (!usuario) return false;
    if (marcado && (!cartaoFaturaId || !competenciaFatura)) return false;
    setSalvandoId(movimento.id);
    setErro(null);
    try {
      const atualizado = await clienteApi.atualizar_conhecimento({
        usuarioId: usuario.id,
        movimentoId: movimento.id,
        papel: marcado ? "pagamento_fatura" : "gasto",
        ...(marcado
          ? { cartaoFaturaId, competenciaFatura }
          : {}),
      });
      aplicar_conhecimento_local(movimento.id, atualizado);
      contexto?.invalidar("extrato", "dashboard");
      if (marcado && movimento.papel !== "pagamento_fatura") {
        toast.sucesso("Pagamento de fatura — não entra nos totais.");
        if (atualizado.propostaRegra) {
          setOfertaRegra({
            movimentoId: movimento.id,
            trecho: atualizado.propostaRegra.trecho,
          });
        }
      } else if (!marcado) {
        setOfertaRegra((atual) => (atual?.movimentoId === movimento.id ? null : atual));
        setFaturasDispensadas((atuais) =>
          dispensar_convite_fatura(usuario.id, movimento.id, atuais),
        );
      }
      return true;
    } catch (e) {
      toast.erro(
        e instanceof ErroApi ? e.message : "Não foi possível marcar o pagamento de fatura.",
      );
      return false;
    } finally {
      setSalvandoId(null);
    }
  }

  function abrir_modal_fatura(movimento: MovimentoResumo) {
    const sugestao = sugerir_pagamento_fatura(movimento, cartoesTodos, movimentos);
    const cartaoId =
      movimento.cartaoFaturaId ?? sugestao?.cartaoId ?? movimento.cartaoId ?? null;
    const cartao = cartoesTodos.find((item) => item.id === cartaoId);
    setPedidoFatura({
      movimento,
      cartaoId,
      competencia:
        movimento.competenciaFatura ??
        sugestao?.competencia ??
        competencia_default_fatura(movimento, cartao),
    });
  }

  async function criar_regra_do_pagamento(movimentoId: string) {
    if (!usuario) return;
    setSalvandoId(movimentoId);
    try {
      const resultado = await clienteApi.criar_regra_de_correcao({
        usuarioId: usuario.id,
        movimentoId,
      });
      setOfertaRegra(null);
      if (resultado.criada && resultado.proposta) {
        toast.sucesso(
          `Regra criada: "${resultado.proposta.trecho} → ${resultado.proposta.categoriaNome}".`,
        );
        contexto?.invalidar("regras", "extrato");
      } else if (resultado.motivo === "ja_existe") {
        toast.info("Essa regra já existia.");
      } else {
        toast.info("Não deu para criar a regra com este trecho.");
      }
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível criar a regra.");
    } finally {
      setSalvandoId(null);
    }
  }

  async function excluir_movimento(movimento: MovimentoResumo) {
    if (!usuario || !pode_excluir_movimento(movimento.fonte)) return;
    const ok = await confirmar({
      titulo: "Excluir lançamento?",
      mensagem: `“${movimento.descricao}” será cancelado. Lançamentos do banco não podem ser apagados.`,
      confirmarRotulo: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setSalvandoId(movimento.id);
    try {
      await clienteApi.excluir_movimento(movimento.id, usuario.id);
      setMovimentos((atual) =>
        atual.map((item) =>
          item.id === movimento.id ? { ...item, status: "cancelado" } : item,
        ),
      );
      contexto?.invalidar("extrato", "dashboard");
      toast.sucesso("Lançamento excluído.");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível excluir.");
    } finally {
      setSalvandoId(null);
      setMenuId(null);
    }
  }

  if (!usuario) {
    return (
      <div className="flex h-full items-center justify-center text-texto-suave">Carregando...</div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Transações</h1>
          <p className="text-sm text-texto-suave">
            {visaoGeral
              ? "Todos os workspaces — classifique e revise o que veio do banco ou do assistente"
              : "Classifique e revise o que veio do banco ou do assistente"}
          </p>
        </div>
        <SeletorMes mes={mes} onChange={escolher_mes} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Buscar lançamento</span>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-suave"
            />
            <Campo
              value={busca}
              onChange={(e) => sincronizar_params({ busca: e.target.value })}
              placeholder="Buscar por descrição, banco ou conta"
              className="pl-9"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <SeletorVisual
              className="min-w-[10rem] flex-1 sm:w-52 sm:flex-none"
              ariaLabel="Filtrar por origem"
              valor={origem_para_query(origem) ?? ""}
              opcoes={[
                { valor: "", rotulo: "Todas as origens" },
                { valor: "contas", rotulo: "Só contas", icone: Wallet, grupo: "Tipo" },
                { valor: "cartoes", rotulo: "Só cartões", icone: CreditCard, grupo: "Tipo" },
                ...contas.map((conta) => ({
                  valor: `conta:${conta.id}`,
                  rotulo: conta.nome,
                  icone: Wallet,
                  grupo: "Contas",
                })),
                ...cartoes.map((cartao) => ({
                  valor: `cartao:${cartao.id}`,
                  rotulo: cartao.nome,
                  icone: CreditCard,
                  grupo: "Cartões",
                })),
              ]}
              onChange={(v) => sincronizar_params({ origem: origem_da_query(v || null) })}
            />
            <SeletorTipoGasto
              valor={tipoGasto}
              onChange={(proximo) => sincronizar_params({ tipoGasto: proximo })}
            />
            <button
              type="button"
              onClick={() => setFiltrosAbertos(true)}
              className={unir_classes(
                "relative shrink-0 rounded-lg border border-borda p-2 text-texto-suave transition hover:border-primaria/50 hover:text-texto",
                filtrosDrawer > 0 && "border-primaria/40 text-primaria",
              )}
              aria-label="Mais filtros"
            >
              <ListFilter size={16} />
              {filtrosDrawer > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primaria px-1 text-[10px] font-semibold text-fundo">
                  {filtrosDrawer}
                </span>
              ) : null}
            </button>
          </div>
        </div>
        {filtrosDrawer > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {categoriaId ? (
              <ChipFiltro
                rotulo={categorias.find((c) => c.id === categoriaId)?.nome ?? "Categoria"}
                onLimpar={() => sincronizar_params({ categoriaId: null })}
              />
            ) : null}
            {classificacao !== "todas" ? (
              <ChipFiltro
                rotulo={
                  classificacao === "usuario"
                    ? "Você"
                    : classificacao === "regra"
                      ? "Regra"
                      : classificacao === "ia"
                        ? "IA"
                        : "Sem classificar"
                }
                onLimpar={() => sincronizar_params({ classificacao: "todas" })}
              />
            ) : null}
            {papel !== "todas" ? (
              <ChipFiltro
                rotulo={papel === "gastos" ? "Só gastos" : "Pagamentos de fatura"}
                onLimpar={() => sincronizar_params({ papel: "todas" })}
              />
            ) : null}
            {filtro !== "todas" ? (
              <ChipFiltro
                rotulo={
                  filtro === "banco" ? "Do banco" : filtro === "manual" ? "Manuais" : "Para revisar"
                }
                onLimpar={() => escolher_filtro("todas")}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <DrawerFiltrosExtrato
        aberto={filtrosAbertos}
        aoFechar={() => setFiltrosAbertos(false)}
        quantidade={visiveis.length}
        categorias={categorias}
        categoriaId={categoriaId}
        classificacao={classificacao}
        papel={papel}
        fila={filtro}
        onCategoria={(id) => sincronizar_params({ categoriaId: id })}
        onClassificacao={(valor) => sincronizar_params({ classificacao: valor })}
        onPapel={(valor) => sincronizar_params({ papel: valor })}
        onFila={(valor) => escolher_filtro(valor)}
        onLimpar={() =>
          sincronizar_params({
            categoriaId: null,
            classificacao: "todas",
            papel: "todas",
            filtro: "todas",
          })
        }
      />

      {!(carregando && movimentos.length === 0) ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PainelResumo
            titulo="Entradas"
            valor={formatar_moeda(resumo.entradas)}
            detalhe="sem pagamento de fatura"
            icone={ArrowDownLeft}
            tom="receita"
          />
          <PainelResumo
            titulo="Saídas"
            valor={formatar_moeda(resumo.saidas)}
            detalhe="sem pagamento de fatura"
            icone={ArrowUpRight}
            tom="despesa"
          />
          <PainelResumo
            titulo="Resultado"
            valor={`${resumo.resultado >= 0 ? "" : "−"}${formatar_moeda(Math.abs(resumo.resultado))}`}
            detalhe={`${visiveis.length} lançamento${visiveis.length === 1 ? "" : "s"}`}
            icone={resumo.resultado >= 0 ? ArrowDownLeft : ArrowUpRight}
            tom={resumo.resultado >= 0 ? "receita" : "despesa"}
          />
          <button
            type="button"
            onClick={() => escolher_filtro("revisar")}
            className={unir_classes(
              "rounded-2xl border bg-superficie/80 p-4 text-left shadow-sm shadow-black/20 transition",
              filtro === "revisar" ? "border-aviso/50" : "border-borda hover:border-aviso/40",
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-texto-suave">
                Para revisar
              </span>
              <AlertTriangle size={16} className="text-aviso" />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-texto tabular-nums">
              {resumo.revisarQuantidade}
            </p>
            <p className="mt-1 text-xs text-texto-suave tabular-nums">
              {formatar_moeda(resumo.revisarTotal)} sem classificação
            </p>
          </button>
        </div>
      ) : null}

      {resumo.proximaFatura > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-aviso">
          <IconeProximaFatura />
          {formatar_moeda(resumo.proximaFatura)} na próxima fatura
        </p>
      ) : null}

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
            {filtrosAtivos
              ? "Tente limpar a busca ou os filtros."
              : filtro === "banco"
                ? "Conecte um banco em Contas e associe as contas para o extrato aparecer."
                : filtro === "revisar"
                  ? "Quando um lançamento ainda não tiver categoria, o item aparece aqui."
                  : "Lance pelo assistente ou conecte um banco para começar."}
          </p>
          {filtro === "banco" && !filtrosAtivos && (
            <Link to="/contas" className="mt-3 inline-block text-sm text-primaria hover:underline">
              Ir para Contas
            </Link>
          )}
        </Cartao>
      ) : (
        <>
        <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie/80">
          <table className="min-w-[56rem] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-borda text-left text-[11px] uppercase tracking-wide text-texto-suave">
                <th className="w-10 px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Descrição</th>
                <th className="px-3 py-2 font-medium">Natureza</th>
                <th className="px-3 py-2 font-medium">Conta</th>
                <th className="px-3 py-2 font-medium">Categoria</th>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="w-12 px-2 py-2 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {paginaAtual.itens.map((movimento) => {
                const revisao = precisa_revisao(movimento);
                const entrada = ["receita", "reembolso", "estorno", "aporte"].includes(movimento.tipo);
                const origemPerfil = perfil_origem_movimento(movimento, contas, cartoes);
                const ehGasto = movimento.tipo === "despesa" || movimento.tipo === "retirada";
                const categoriaAtual = categorias.find((c) => c.id === movimento.categoriaId);
                const cartaoMovimento = movimento.cartaoId
                  ? cartoesTodos.find((item) => item.id === movimento.cartaoId)
                  : undefined;
                const seloFatura = selo_fatura_ciclo({
                  dataMovimento: movimento.dataMovimento,
                  cartaoId: movimento.cartaoId,
                  fechamento: cartaoMovimento?.fechamento,
                  vencimento: cartaoMovimento?.vencimento,
                  status: movimento.status,
                  tipo: movimento.tipo,
                  papel: movimento.papel,
                });
                return (
                  <tr
                    key={movimento.id}
                    className={unir_classes(
                      "border-b border-borda/70 last:border-0",
                      revisao ? "bg-aviso/5" : "hover:bg-fundo/40",
                      movimento.status === "cancelado" && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <span
                        className={unir_classes(
                          "inline-flex h-7 w-7 items-center justify-center rounded-lg",
                          entrada ? "bg-receita/15 text-receita" : "bg-despesa/15 text-despesa",
                        )}
                      >
                        {entrada ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                      </span>
                    </td>
                    <td className="max-w-[16rem] px-3 py-2.5">
                      <Dica texto={movimento.descricao}>
                        <p className="truncate font-medium text-texto">{movimento.descricao}</p>
                      </Dica>
                      <p className="truncate text-[11px] text-texto-suave">
                        {rotulo_classificado_por(movimento.classificadoPor, movimento.confiancaIa)}
                        {rotulo_tipo_gasto(movimento.tipoGasto)
                          ? ` · ${rotulo_tipo_gasto(movimento.tipoGasto)}`
                          : ""}
                      </p>
                      {mostra_check_pagamento_fatura(movimento) && (
                        <BannerFatura
                          movimento={movimento}
                          cartoes={cartoesTodos}
                          movimentos={movimentos}
                          salvando={salvandoId === movimento.id}
                          dispensou={faturasDispensadas.has(movimento.id)}
                          ofertaRegra={
                            ofertaRegra?.movimentoId === movimento.id ? ofertaRegra : null
                          }
                          onPedirConfirmacao={() => abrir_modal_fatura(movimento)}
                          onDispensar={() => {
                            if (!usuario) return;
                            setFaturasDispensadas((atuais) =>
                              dispensar_convite_fatura(usuario.id, movimento.id, atuais),
                            );
                          }}
                          onCriarRegra={() => void criar_regra_do_pagamento(movimento.id)}
                          onDispensarRegra={() => setOfertaRegra(null)}
                        />
                      )}
                      {parcelasExpandidasId === movimento.id && (
                        <div className="mt-2 rounded-lg border border-borda bg-fundo/40 px-2 py-1.5">
                          {carregandoParcelasId === movimento.id ? (
                            <p className="text-[11px] text-texto-suave">Carregando parcelas…</p>
                          ) : (parcelasPorMovimento[movimento.id]?.parcelas.length ?? 0) === 0 ? (
                            <p className="text-[11px] text-texto-suave">Não encontrei as outras parcelas.</p>
                          ) : (
                            <ul className="flex flex-col gap-0.5">
                              {parcelasPorMovimento[movimento.id]!.parcelas.map((parcela) => (
                                <li
                                  key={parcela.id}
                                  className={unir_classes(
                                    "flex justify-between gap-2 text-[11px]",
                                    parcela.id === movimento.id ? "font-medium text-texto" : "text-texto-suave",
                                  )}
                                >
                                  <span>
                                    {parcela.parcelaNumero}/{parcela.parcelaTotal} ·{" "}
                                    {formatar_mes_competencia(parcela.dataMovimento)}
                                  </span>
                                  <span className="tabular-nums">{formatar_moeda_br(parcela.valor)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-texto-suave">
                      {rotulo_natureza(movimento)}
                    </td>
                    <td className="max-w-[9rem] truncate px-3 py-2.5 text-texto-suave">
                      {nome_origem_movimento(movimento, contas, cartoes)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex max-w-[10rem] items-center gap-1.5">
                        <IconeCategoria icone={categoriaAtual?.icone} cor={categoriaAtual?.cor} tamanho={14} />
                        <span className="truncate text-texto">
                          {movimento.categoriaNome ?? "Não classificado"}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-texto-suave">
                      <span className="inline-flex items-center gap-1.5">
                        {formatar_data(movimento.dataMovimento)}
                        {seloFatura ? <IconeProximaFatura dica={seloFatura.dica} /> : null}
                      </span>
                    </td>
                    <td
                      className={unir_classes(
                        "whitespace-nowrap px-3 py-2.5",
                        cor_valor(movimento.tipo, movimento.status),
                      )}
                    >
                      <p className="text-right font-medium tabular-nums">
                        {formatar_valor(movimento.tipo, movimento.valor)}
                      </p>
                      <p className="text-right text-[11px] tabular-nums text-texto-suave">
                        {hora_visivel_do_fato(movimento.dataMovimento, movimento.ocorridoEmInstante) ||
                          "00:00"}
                      </p>
                    </td>
                    <td className="relative px-2 py-2.5">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-texto-suave hover:bg-fundo hover:text-texto"
                        aria-label="Ações"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuId(menuId === movimento.id ? null : movimento.id);
                        }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuId === movimento.id && (
                        <MenuAcoes
                          aoEscolher={() => setMenuId(null)}
                          acoes={[
                            {
                              rotulo: "Categoria",
                              icone: Tags,
                              submenu: categoriasParaClassificar.map((categoria) => ({
                                rotulo: categoria.nome,
                                iconeCategoria: categoria.icone ?? null,
                                cor: categoria.cor ?? null,
                                ativo: categoria.id === movimento.categoriaId,
                                onClick: () => void classificar(movimento.id, categoria.id),
                              })),
                            },
                            ...(origemPerfil && ehGasto
                              ? [
                                  {
                                    rotulo:
                                      origemPerfil === "pj"
                                        ? movimento.tipoGasto === "pf"
                                          ? "Marcar como empresa"
                                          : "Marcar como pessoal"
                                        : movimento.tipoGasto === "pj"
                                          ? "Marcar como pessoal"
                                          : "Marcar como empresa",
                                    icone: UserRound,
                                    onClick: () => {
                                      const cruzado =
                                        origemPerfil === "pj"
                                          ? movimento.tipoGasto === "pf"
                                          : movimento.tipoGasto === "pj";
                                      const proximo: Perfil = cruzado
                                        ? origemPerfil
                                        : origemPerfil === "pj"
                                          ? "pf"
                                          : "pj";
                                      void alterar_tipo_gasto(movimento.id, proximo);
                                    },
                                  },
                                ]
                              : []),
                            ...(mostra_acao_pagamento_fatura(movimento)
                              ? [
                                  {
                                    rotulo:
                                      movimento.papel === "pagamento_fatura"
                                        ? "Desmarcar pagamento de fatura"
                                        : "Marcar pagamento de fatura",
                                    icone: Repeat,
                                    onClick: () => {
                                      if (movimento.papel === "pagamento_fatura") {
                                        void marcar_pagamento_fatura(movimento, false);
                                        return;
                                      }
                                      abrir_modal_fatura(movimento);
                                    },
                                  },
                                ]
                              : []),
                            ...(movimento.parcelaNumero &&
                            movimento.parcelaTotal &&
                            movimento.parcelaTotal >= 2
                              ? [
                                  {
                                    rotulo:
                                      parcelasExpandidasId === movimento.id
                                        ? "Ocultar parcelas"
                                        : "Ver parcelas",
                                    icone: Repeat,
                                    onClick: () => void alternar_parcelas(movimento.id),
                                  },
                                ]
                              : []),
                            ...(pode_excluir_movimento(movimento.fonte)
                              ? [
                                  {
                                    rotulo: "Excluir",
                                    icone: Trash2,
                                    perigo: true,
                                    onClick: () => void excluir_movimento(movimento),
                                  },
                                ]
                              : []),
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
        <Paginador
          pagina={paginaAtual.pagina}
          paginas={paginaAtual.paginas}
          total={paginaAtual.total}
          porPagina={paginaAtual.porPagina}
          de={paginaAtual.de}
          ate={paginaAtual.ate}
          onPagina={setPagina}
          onPorPagina={(n) => sincronizar_params({ porPagina: n })}
        />
        </>
      )}

      {categoriasParaClassificar.length === 0 && !carregando && (
        <p className="text-xs text-texto-suave">
          Sem categorias úteis.{" "}
          <Link to="/categorias" className="text-primaria hover:underline">
            Cadastre em Categorias
          </Link>
          .
        </p>
      )}
      <ModalPagamentoFatura
        aberto={Boolean(pedidoFatura)}
        cartoes={cartoesTodos}
        cartaoIdInicial={pedidoFatura?.cartaoId ?? null}
        competenciaInicial={pedidoFatura?.competencia ?? mes}
        confirmando={salvandoId === pedidoFatura?.movimento.id}
        aoCancelar={() => setPedidoFatura(null)}
        aoConfirmar={(cartaoId, competencia) => {
          const movimento = pedidoFatura?.movimento;
          if (!movimento) return;
          void marcar_pagamento_fatura(movimento, true, cartaoId, competencia).then((ok) => {
            if (ok) setPedidoFatura(null);
          });
        }}
      />
    </div>
  );
}

function BannerFatura({
  movimento,
  cartoes,
  movimentos,
  salvando,
  dispensou,
  ofertaRegra,
  onPedirConfirmacao,
  onDispensar,
  onCriarRegra,
  onDispensarRegra,
}: {
  movimento: MovimentoResumo;
  cartoes: CartaoResumo[];
  movimentos: MovimentoResumo[];
  salvando: boolean;
  dispensou: boolean;
  ofertaRegra: { movimentoId: string; trecho: string } | null;
  onPedirConfirmacao: () => void;
  onDispensar: () => void;
  onCriarRegra: () => void;
  onDispensarRegra: () => void;
}) {
  const sugestao =
    movimento.papel === "pagamento_fatura"
      ? null
      : sugerir_pagamento_fatura(movimento, cartoes, movimentos);
  const modo = modo_convite_pagamento_fatura({
    movimento,
    temSugestao: Boolean(sugestao),
    dispensou,
  });

  if (modo === "nada" && !ofertaRegra) return null;

  return (
    <div className="mt-1 flex flex-col gap-1">
      {modo === "banner" && sugestao ? (
        <div className="relative rounded-lg border border-primaria/30 bg-primaria/5 px-2 py-1.5 pr-7">
          <button
            type="button"
            disabled={salvando}
            onClick={onDispensar}
            aria-label="Não é pagamento de fatura"
            className="absolute right-1 top-1 rounded p-0.5 text-texto-suave hover:text-texto"
          >
            <X size={12} />
          </button>
          <p className="text-[11px] text-texto">É pagamento de fatura?</p>
          <button
            type="button"
            disabled={salvando}
            onClick={onPedirConfirmacao}
            className="text-[11px] font-medium text-primaria hover:underline"
          >
            Confirmar
          </button>
        </div>
      ) : null}
      {ofertaRegra ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-texto">
          <span>Criar regra para «{ofertaRegra.trecho}»?</span>
          <button
            type="button"
            disabled={salvando}
            onClick={onCriarRegra}
            className="font-medium text-primaria hover:underline"
          >
            Criar
          </button>
          <button type="button" disabled={salvando} onClick={onDispensarRegra} className="text-texto-suave">
            Agora não
          </button>
        </div>
      ) : null}
    </div>
  );
}

