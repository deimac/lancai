import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Building2,
  CheckCircle2,
  CreditCard,
  FolderKanban,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  Wallet,
  XCircle,
} from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useConfirmacao } from "../contexto/ContextoConfirmacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type ConexaoDetalhada,
  type ContaResumo,
  type DescritorFonte,
  type ProgressoImportacaoApi,
} from "../lib/api";
import { conectar_banco } from "../lib/conectar-banco";
import { formatar_moeda } from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { texto_ultimo_sync } from "../lib/observabilidade-sync";
import { unir_classes } from "../lib/unir-classes";
import {
  BarraProgressoImportacao,
  type ProgressoImportacaoUi,
} from "../componentes/BarraProgressoImportacao";
import { ModalContaCartao, type TipoCadastro } from "../componentes/ModalContaCartao";
import { ModalReconectar } from "../componentes/ModalReconectar";
import { PainelWorkspaces } from "../componentes/PainelWorkspaces";
import { Botao } from "../componentes/ui/Botao";
import { MenuAcoes, type AcaoMenu } from "../componentes/ui/MenuAcoes";
import { useContextoLayout } from "../layout/useContextoLayout";

type Aba = "contas" | "cartoes" | "bancos";

function para_numero(valor: string | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function badge_perfil(perfil: string | undefined) {
  const pj = perfil === "pj";
  return {
    rotulo: pj ? "Jurídica" : "Física",
    classe: pj
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };
}

function badge_origem(item: {
  sincronizada?: boolean;
  origem?: string;
  instituicao?: string | null;
  conexaoStatus?: string | null;
}) {
  const of = item.origem === "open_finance" || item.sincronizada;
  if (!of) {
    return {
      rotulo: "Manual",
      classe: "border-borda text-texto-suave",
    };
  }
  const banco = item.instituicao ? ` · ${item.instituicao}` : "";
  if (item.conexaoStatus === "precisa_atencao") {
    return {
      rotulo: `Precisa de atenção${banco}`,
      classe: "border-aviso/40 bg-aviso/10 text-aviso",
    };
  }
  if (item.conexaoStatus === "removida" || !item.sincronizada) {
    return {
      rotulo: `Desconectada${banco}`,
      classe: "border-aviso/40 bg-aviso/10 text-aviso",
    };
  }
  return {
    rotulo: item.conexaoStatus === "sincronizando" ? `Sincronizando${banco}` : `Ativa${banco}`,
    classe: "border-primaria/40 bg-primaria/10 text-primaria",
  };
}

function precisa_reconectar(item: {
  origem?: string;
  sincronizada?: boolean;
  conexaoStatus?: string | null;
  conexaoId?: string | null;
}) {
  const of = item.origem === "open_finance" || item.sincronizada;
  if (!of) return false;
  return (
    !item.conexaoId ||
    item.conexaoStatus === "removida" ||
    item.conexaoStatus === "precisa_atencao" ||
    !item.sincronizada
  );
}

function status_visual_conexao(status: string) {
  if (status === "ativa" || status === "sincronizando") {
    return {
      conectado: true,
      rotulo: status === "sincronizando" ? "Sincronizando" : "Conectado",
      Icone: CheckCircle2,
      iconeClasse: "text-emerald-500",
    };
  }
  return {
    conectado: false,
    rotulo: status === "precisa_atencao" ? "Precisa de atenção" : "Desconectado",
    Icone: XCircle,
    iconeClasse: "text-red-500",
  };
}

function aba_do_hash(hash: string): Aba {
  if (hash === "#cartoes") return "cartoes";
  if (hash === "#bancos" || hash === "#conexoes") return "bancos";
  return "contas";
}

export function TelaContasECartoes() {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const { confirmar } = useConfirmacao();
  const contexto = useContextoLayout();
  const location = useLocation();

  const [fonte, setFonte] = useState<DescritorFonte | null>(null);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [conexoes, setConexoes] = useState<ConexaoDetalhada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [painelWs, setPainelWs] = useState(false);
  const [aba, setAba] = useState<Aba>(() => aba_do_hash(window.location.hash));
  const [menuId, setMenuId] = useState<string | null>(null);

  const [modalAberto, setModalAberto] = useState(false);
  const [modalModo, setModalModo] = useState<"criar" | "editar">("criar");
  const [modalTipo, setModalTipo] = useState<TipoCadastro>("conta");
  const [modalAlvo, setModalAlvo] = useState<ContaResumo | CartaoResumo | null>(null);

  const [modalReconectar, setModalReconectar] = useState(false);
  const [conexaoReconectar, setConexaoReconectar] = useState<string | null>(null);
  const [alvoReconectar, setAlvoReconectar] = useState<{
    contaId?: string;
    cartaoId?: string;
  }>({});
  const [progressoImportacao, setProgressoImportacao] = useState<ProgressoImportacaoUi | null>(
    null,
  );

  const deps = chave_dependencia(contexto?.versoes, "contas", "cartoes", "conexoes");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [contasCarregadas, cartoesCarregados, fonteDesc, conexoesCarregadas] =
        await Promise.all([
          clienteApi.listar_contas(usuario.id, true),
          clienteApi.listar_cartoes(usuario.id, true),
          clienteApi.descrever_fonte().catch(() => ({ disponivel: false } as DescritorFonte)),
          clienteApi.listar_conexoes(usuario.id).catch(() => [] as ConexaoDetalhada[]),
        ]);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
      setFonte(fonteDesc);
      setConexoes(conexoesCarregadas);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar contas e cartões.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, deps]);

  useEffect(() => {
    setAba(aba_do_hash(location.hash));
  }, [location.hash]);

  useEffect(() => {
    function fechar_menu() {
      setMenuId(null);
    }
    window.addEventListener("click", fechar_menu);
    return () => window.removeEventListener("click", fechar_menu);
  }, []);

  function mudar_aba(proxima: Aba) {
    setAba(proxima);
    const hash =
      proxima === "cartoes" ? "#cartoes" : proxima === "bancos" ? "#bancos" : "#contas";
    window.history.replaceState(null, "", `${location.pathname}${hash}`);
  }

  function abrir_criar(tipo: TipoCadastro = "conta") {
    setModalModo("criar");
    setModalTipo(tipo);
    setModalAlvo(null);
    setModalAberto(true);
  }

  function abrir_editar_conta(conta: ContaResumo) {
    setModalModo("editar");
    setModalTipo("conta");
    setModalAlvo(conta);
    setModalAberto(true);
  }

  function abrir_editar_cartao(cartao: CartaoResumo) {
    setModalModo("editar");
    setModalTipo("cartao");
    setModalAlvo(cartao);
    setModalAberto(true);
  }

  function abrir_reconectar(entrada: {
    conexaoId?: string | null;
    contaId?: string;
    cartaoId?: string;
  }) {
    setConexaoReconectar(entrada.conexaoId ?? null);
    setAlvoReconectar({ contaId: entrada.contaId, cartaoId: entrada.cartaoId });
    setModalReconectar(true);
  }

  async function excluir_conta(conta: ContaResumo) {
    if (!usuario) return;
    const of = conta.origem === "open_finance" || conta.sincronizada;
    const ok = await confirmar({
      titulo: "Excluir conta?",
      mensagem: of
        ? `Apaga "${conta.nome}" e TODO o extrato (incluindo Open Finance). Irreversível. Se só mudou o itemId, use Reconectar.`
        : `Apaga a conta "${conta.nome}" e o extrato ligado. Irreversível.`,
      confirmarRotulo: "Excluir tudo",
    });
    if (!ok) return;
    try {
      await clienteApi.excluir_conta(conta.id, usuario.id);
      toast.sucesso("Conta e extrato excluídos.");
      await carregar();
      contexto?.invalidar("tudo");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível excluir a conta.");
    }
  }

  async function excluir_cartao(cartao: CartaoResumo) {
    if (!usuario) return;
    const of = cartao.origem === "open_finance" || cartao.sincronizada;
    const ok = await confirmar({
      titulo: "Excluir cartão?",
      mensagem: of
        ? `Apaga "${cartao.nome}" e TODO o extrato (incluindo Open Finance). Irreversível. Se só mudou o itemId, use Reconectar.`
        : `Apaga o cartão "${cartao.nome}" e o extrato ligado. Irreversível.`,
      confirmarRotulo: "Excluir tudo",
    });
    if (!ok) return;
    try {
      await clienteApi.excluir_cartao(cartao.id, usuario.id);
      toast.sucesso("Cartão e extrato excluídos.");
      await carregar();
      contexto?.invalidar("tudo");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível excluir o cartão.");
    }
  }

  function ao_conectar() {
    if (!usuario || !fonte) return;
    if (fonte.id === "duble") {
      void conectar_banco({
        usuarioId: usuario.id,
        fonte,
        aoOcupado: setOcupado,
        aoErro: (mensagem) => toast.erro(mensagem),
        aoSucesso: async () => {
          toast.sucesso("Banco conectado. Contas e cartões foram criados.");
          await carregar();
          contexto?.invalidar("tudo");
        },
      });
      return;
    }
    mudar_aba("bancos");
    abrir_reconectar({});
  }

  async function atualizar_conexao(conexaoId: string) {
    if (!usuario) return;
    setOcupado(true);
    setProgressoImportacao({ percentual: 2, mensagem: "Atualizando…" });
    try {
      await clienteApi.atualizar_conexao(conexaoId, usuario.id, (p: ProgressoImportacaoApi) => {
        setProgressoImportacao({
          percentual: p.percentual,
          mensagem: p.mensagem,
          criados: p.criados,
        });
      });
      toast.sucesso("Extrato atualizado.");
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes", "extrato", "dashboard");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Falha ao atualizar.");
    } finally {
      setOcupado(false);
      setProgressoImportacao(null);
    }
  }

  async function desconectar(conexaoId: string, nome: string) {
    if (!usuario) return;
    const ok = await confirmar({
      titulo: "Desconectar banco?",
      mensagem: `Encerra a sync de "${nome}". Contas, cartões e histórico ficam. Depois use Reconectar no mesmo banco.`,
      confirmarRotulo: "Desconectar",
    });
    if (!ok) return;
    try {
      await clienteApi.desconectar_conexao(conexaoId, usuario.id);
      toast.sucesso("Banco desconectado.");
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Falha ao desconectar.");
    }
  }

  async function reconectar_mesmo_item(conexao: ConexaoDetalhada) {
    abrir_reconectar({ conexaoId: conexao.id });
  }

  if (!usuario) return null;

  if (painelWs) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
        <PainelWorkspaces
          aoVoltar={() => setPainelWs(false)}
          aoMudar={() => {
            void carregar();
            contexto?.invalidar("tudo");
          }}
        />
      </div>
    );
  }

  const abas: { id: Aba; rotulo: string; icone: typeof Wallet }[] = [
    { id: "contas", rotulo: "Contas", icone: Wallet },
    { id: "cartoes", rotulo: "Cartões", icone: CreditCard },
    { id: "bancos", rotulo: "Bancos", icone: Building2 },
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-texto">Contas</h1>
        <p className="text-sm text-texto-suave">
          Contas, cartões e bancos do usuário. Workspace só agrupa filtros e relatórios.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Botao onClick={ao_conectar} disabled={ocupado || !fonte?.disponivel}>
          <Link2 size={14} />
          {ocupado ? "Conectando…" : "Conectar banco"}
        </Botao>
        <Botao variante="fantasma" onClick={() => abrir_criar(aba === "cartoes" ? "cartao" : "conta")}>
          <Plus size={14} />
          Adicionar
        </Botao>
        <Botao variante="fantasma" onClick={() => setPainelWs(true)}>
          <FolderKanban size={14} />
          Workspaces
        </Botao>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      <BarraProgressoImportacao progresso={progressoImportacao} />

      <div className="flex gap-1 border-b border-borda">
        {abas.map(({ id, rotulo, icone: Icone }) => (
          <button
            key={id}
            type="button"
            onClick={() => mudar_aba(id)}
            className={unir_classes(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
              aba === id
                ? "border-b-2 border-primaria text-primaria"
                : "text-texto-suave hover:text-texto",
            )}
          >
            <Icone size={14} />
            {rotulo}
            {id === "contas" && contas.length > 0 && (
              <span className="text-xs opacity-70">{contas.length}</span>
            )}
            {id === "cartoes" && cartoes.length > 0 && (
              <span className="text-xs opacity-70">{cartoes.length}</span>
            )}
            {id === "bancos" && conexoes.length > 0 && (
              <span className="text-xs opacity-70">{conexoes.length}</span>
            )}
          </button>
        ))}
      </div>

      {aba === "contas" && (
        <ListaDestinos
          carregando={carregando}
          vazia="Nenhuma conta. Conecte um banco ou cadastre manualmente."
          itens={contas.map((conta) => {
            const badge = badge_origem(conta);
            const perfilBadge = badge_perfil(conta.perfil);
            const saldo = para_numero(conta.saldoAtual);
            return {
              id: conta.id,
              titulo: conta.nome,
              subtitulo: undefined,
              badges: [perfilBadge, badge],
              valor: saldo,
              valorClasse: saldo < 0 ? "text-despesa" : "text-texto",
              menuAberto: menuId === conta.id,
              aoMenu: (e: MouseEvent) => {
                e.stopPropagation();
                setMenuId(menuId === conta.id ? null : conta.id);
              },
              aoFecharMenu: () => setMenuId(null),
              acoes: [
                { rotulo: "Editar", icone: Pencil, onClick: () => abrir_editar_conta(conta) },
                ...(precisa_reconectar(conta)
                  ? [
                      {
                        rotulo: "Reconectar",
                        icone: RefreshCw,
                        onClick: () =>
                          abrir_reconectar({
                            conexaoId: conta.conexaoId,
                            contaId: conta.id,
                          }),
                      },
                    ]
                  : []),
                {
                  rotulo: "Excluir",
                  icone: Trash2,
                  perigo: true,
                  onClick: () => void excluir_conta(conta),
                },
              ],
            };
          })}
        />
      )}

      {aba === "cartoes" && (
        <ListaDestinos
          carregando={carregando}
          vazia="Nenhum cartão. Conecte um banco ou cadastre manualmente."
          itens={cartoes.map((cartao) => {
            const badge = badge_origem(cartao);
            const perfilBadge = badge_perfil(cartao.perfil);
            const saldo = para_numero(cartao.saldo);
            const limite = para_numero(cartao.limite);
            const disponivel = limite - saldo;
            return {
              id: cartao.id,
              titulo: `${cartao.nome}${cartao.final4 ? ` ···· ${cartao.final4}` : ""}`,
              subtitulo: [
                `Limite: ${formatar_moeda(limite)}`,
                `Disponível: ${formatar_moeda(disponivel)}`,
                `Fechamento: ${
                  cartao.fechamento != null ? String(cartao.fechamento).padStart(2, "0") : "—"
                }`,
                `Vencimento: ${String(cartao.vencimento).padStart(2, "0")}`,
              ].join(" · "),
              badges: [perfilBadge, badge],
              valor: saldo,
              valorClasse: saldo > 0 ? "text-despesa" : "text-texto",
              menuAberto: menuId === cartao.id,
              aoMenu: (e: MouseEvent) => {
                e.stopPropagation();
                setMenuId(menuId === cartao.id ? null : cartao.id);
              },
              aoFecharMenu: () => setMenuId(null),
              acoes: [
                { rotulo: "Editar", icone: Pencil, onClick: () => abrir_editar_cartao(cartao) },
                ...(precisa_reconectar(cartao)
                  ? [
                      {
                        rotulo: "Reconectar",
                        icone: RefreshCw,
                        onClick: () =>
                          abrir_reconectar({
                            conexaoId: cartao.conexaoId,
                            cartaoId: cartao.id,
                          }),
                      },
                    ]
                  : []),
                {
                  rotulo: "Excluir",
                  icone: Trash2,
                  perigo: true,
                  onClick: () => void excluir_cartao(cartao),
                },
              ],
            };
          })}
        />
      )}

      {aba === "bancos" && (
        <section className="flex flex-col gap-3">
          {carregando && conexoes.length === 0 ? (
            <p className="text-sm text-texto-suave">Carregando…</p>
          ) : conexoes.length === 0 ? (
            <p className="rounded-2xl border border-borda bg-superficie/80 p-4 text-sm text-texto-suave">
              Nenhum banco conectado. Use Conectar banco e cole o itemId do Meu Pluggy.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {conexoes.map((conexao, i) => {
                const sync = texto_ultimo_sync(conexao.ultimoSyncEm);
                const visual = status_visual_conexao(conexao.status);
                const contasLigadas = contas.filter((c) => c.conexaoId === conexao.id);
                const cartoesLigados = cartoes.filter((c) => c.conexaoId === conexao.id);
                const nomeConfirmacao =
                  contasLigadas[0]?.nome ??
                  cartoesLigados[0]?.nome ??
                  "banco";
                return (
                  <motion.li
                    key={conexao.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="relative rounded-2xl border border-borda bg-superficie/80 p-4 shadow-sm shadow-black/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <visual.Icone
                          size={20}
                          className={unir_classes("shrink-0", visual.iconeClasse)}
                          aria-hidden
                        />
                        <p className="text-sm font-semibold text-texto">{visual.rotulo}</p>
                      </div>
                      <div className="relative shrink-0">
                        <Botao
                          variante="fantasma"
                          className="px-2"
                          disabled={ocupado}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuId(menuId === conexao.id ? null : conexao.id);
                          }}
                        >
                          <MoreHorizontal size={16} />
                        </Botao>
                        {menuId === conexao.id && (
                          <MenuAcoes
                            aoEscolher={() => setMenuId(null)}
                            acoes={[
                              ...(conexao.status !== "removida"
                                ? [
                                    {
                                      rotulo: "Sincronizar",
                                      icone: RefreshCw,
                                      onClick: () => void atualizar_conexao(conexao.id),
                                    },
                                  ]
                                : []),
                              ...(conexao.status === "precisa_atencao"
                                ? [
                                    {
                                      rotulo: "Atualizar login",
                                      icone: Link2,
                                      onClick: () => void reconectar_mesmo_item(conexao),
                                    },
                                  ]
                                : []),
                              {
                                rotulo: "Reconectar",
                                icone: RefreshCw,
                                onClick: () => abrir_reconectar({ conexaoId: conexao.id }),
                              },
                              ...(conexao.status !== "removida"
                                ? [
                                    {
                                      rotulo: "Desconectar",
                                      icone: Unplug,
                                      onClick: () =>
                                        void desconectar(conexao.id, nomeConfirmacao),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-1">
                      {contasLigadas.length === 0 && cartoesLigados.length === 0 ? (
                        <p className="text-sm text-texto-suave">
                          Nenhuma conta ou cartão associado
                        </p>
                      ) : (
                        <>
                          {contasLigadas.map((conta) => (
                            <p key={conta.id} className="text-sm text-texto">
                              <span className="text-texto-suave">Conta: </span>
                              <span className="font-semibold">{conta.nome}</span>
                            </p>
                          ))}
                          {cartoesLigados.map((cartao) => (
                            <p key={cartao.id} className="text-sm text-texto">
                              <span className="text-texto-suave">Cartão: </span>
                              <span className="font-semibold">{cartao.nome}</span>
                            </p>
                          ))}
                        </>
                      )}
                    </div>
                    <p
                      className={unir_classes(
                        "mt-3 text-xs",
                        sync.atrasado ? "text-aviso" : "text-texto-suave",
                      )}
                    >
                      {sync.linha}
                    </p>
                  </motion.li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-texto-suave">
            <strong className="font-medium text-texto">Conectar / Reconectar</strong> usa o
            itemId do Meu Pluggy — contas e cartões locais são religados, sem duplicar.{" "}
            <strong className="font-medium text-texto">Excluir</strong> na aba Contas/Cartões
            apaga o extrato de vez.
          </p>
        </section>
      )}

      <ModalContaCartao
        aberto={modalAberto}
        modo={modalModo}
        tipoInicial={modalTipo}
        alvo={modalAlvo}
        aoFechar={() => setModalAberto(false)}
        aoSalvar={() => {
          void carregar();
          contexto?.invalidar("contas", "cartoes", "dashboard");
        }}
      />

      <ModalReconectar
        aberto={modalReconectar}
        usuarioId={usuario.id}
        contas={contas}
        cartoes={cartoes}
        conexoes={conexoes}
        conexaoId={conexaoReconectar}
        alvoContaId={alvoReconectar.contaId}
        alvoCartaoId={alvoReconectar.cartaoId}
        aoFechar={() => setModalReconectar(false)}
        aoConcluir={() => {
          void carregar();
          contexto?.invalidar("tudo");
          mudar_aba("bancos");
        }}
      />
    </div>
  );
}

function ListaDestinos({
  carregando,
  vazia,
  itens,
}: {
  carregando: boolean;
  vazia: string;
  itens: Array<{
    id: string;
    titulo: string;
    subtitulo?: string;
    badges: Array<{ rotulo: string; classe: string }>;
    valor: number;
    valorClasse: string;
    menuAberto: boolean;
    aoMenu: (e: MouseEvent) => void;
    aoFecharMenu: () => void;
    acoes: AcaoMenu[];
  }>;
}) {
  if (carregando && itens.length === 0) {
    return <p className="text-sm text-texto-suave">Carregando…</p>;
  }
  if (itens.length === 0) {
    return (
      <p className="rounded-2xl border border-borda bg-superficie/80 p-4 text-sm text-texto-suave">
        {vazia}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {itens.map((item, i) => (
        <motion.li
          key={item.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.02 }}
          className="relative flex items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/80 px-4 py-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-texto">{item.titulo}</p>
              {item.badges.map((b) => (
                <span
                  key={b.rotulo}
                  className={unir_classes(
                    "rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    b.classe,
                  )}
                >
                  {b.rotulo}
                </span>
              ))}
            </div>
            {item.subtitulo && (
              <p className="mt-1 text-xs text-texto-suave">{item.subtitulo}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <p className={unir_classes("text-base font-semibold tabular-nums", item.valorClasse)}>
              {formatar_moeda(item.valor)}
            </p>
            <Botao variante="fantasma" className="px-2" onClick={item.aoMenu}>
              <MoreHorizontal size={16} />
            </Botao>
            {item.menuAberto && <MenuAcoes acoes={item.acoes} aoEscolher={item.aoFecharMenu} />}
          </div>
        </motion.li>
      ))}
    </ul>
  );
}
