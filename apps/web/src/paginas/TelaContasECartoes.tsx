import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CreditCard, FolderKanban, Link2, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import type { WidgetAberto } from "@lancai/open-finance/web";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useConfirmacao } from "../contexto/ContextoConfirmacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type ContaResumo,
  type DescritorFonte,
  type ProgressoImportacaoApi,
} from "../lib/api";
import { conectar_banco } from "../lib/conectar-banco";
import { formatar_moeda } from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import {
  BarraProgressoImportacao,
  type ProgressoImportacaoUi,
} from "../componentes/BarraProgressoImportacao";
import { Botao } from "../componentes/ui/Botao";
import { Cartao } from "../componentes/ui/Cartao";
import { ModalContaCartao, type TipoCadastro } from "../componentes/ModalContaCartao";
import { PainelWorkspaces } from "../componentes/PainelWorkspaces";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

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
      : "border-borda bg-fundo/60 text-texto-suave",
  };
}

function badge_origem(item: {
  sincronizada?: boolean;
  origem?: string;
  instituicao?: string | null;
}) {
  const of = item.origem === "open_finance" || item.sincronizada;
  if (of) {
    return {
      rotulo: item.instituicao
        ? `Sincronizada · ${item.instituicao}`
        : "Sincronizada via banco",
      classe: "border-primaria/40 bg-primaria/10 text-primaria",
    };
  }
  return {
    rotulo: "Cadastro manual",
    classe: "border-borda text-texto-suave",
  };
}

export function TelaContasECartoes() {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const { confirmar } = useConfirmacao();
  const contexto = useContextoLayout();
  const widgetRef = useRef<WidgetAberto | null>(null);
  const [fonte, setFonte] = useState<DescritorFonte | null>(null);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [painelWs, setPainelWs] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalModo, setModalModo] = useState<"criar" | "editar">("criar");
  const [modalTipo, setModalTipo] = useState<TipoCadastro>("conta");
  const [modalAlvo, setModalAlvo] = useState<ContaResumo | CartaoResumo | null>(null);
  const [itemIdManual, setItemIdManual] = useState("");
  const [progressoImportacao, setProgressoImportacao] = useState<ProgressoImportacaoUi | null>(
    null,
  );

  const deps = chave_dependencia(contexto?.versoes, "contas", "cartoes", "conexoes");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [contasCarregadas, cartoesCarregados, fonteDesc] = await Promise.all([
        clienteApi.listar_contas(usuario.id),
        clienteApi.listar_cartoes(usuario.id),
        clienteApi.descrever_fonte().catch(() => ({ disponivel: false } as DescritorFonte)),
      ]);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
      setFonte(fonteDesc);
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
    return () => widgetRef.current?.fechar();
  }, []);

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

  async function excluir_conta(conta: ContaResumo) {
    if (!usuario) return;
    const sincronizada = conta.origem === "open_finance" || conta.sincronizada;
    const ok = await confirmar({
      titulo: sincronizada ? "Excluir conexão e limpar?" : "Excluir conta?",
      mensagem: sincronizada
        ? `Isso apaga a conexão, contas/cartões sincronizados dela (incluindo "${conta.nome}") ` +
          "e o extrato ligado. Depois você pode registrar o itemId de novo."
        : `Apaga a conta "${conta.nome}" e o extrato ligado a ela. Irreversível.`,
      confirmarRotulo: "Excluir tudo",
    });
    if (!ok) return;
    try {
      await clienteApi.excluir_conta(conta.id, usuario.id);
      toast.sucesso(sincronizada ? "Conexão e extrato limpos." : "Conta e extrato excluídos.");
      await carregar();
      contexto?.invalidar("tudo");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível excluir a conta.");
    }
  }

  async function excluir_cartao(cartao: CartaoResumo) {
    if (!usuario) return;
    const sincronizada = cartao.origem === "open_finance" || cartao.sincronizada;
    const ok = await confirmar({
      titulo: sincronizada ? "Excluir conexão e limpar?" : "Excluir cartão?",
      mensagem: sincronizada
        ? `Isso apaga a conexão, contas/cartões sincronizados dela (incluindo "${cartao.nome}") ` +
          "e o extrato ligado. Depois você pode registrar o itemId de novo."
        : `Apaga o cartão "${cartao.nome}" e o extrato ligado a ele. Irreversível.`,
      confirmarRotulo: "Excluir tudo",
    });
    if (!ok) return;
    try {
      await clienteApi.excluir_cartao(cartao.id, usuario.id);
      toast.sucesso(sincronizada ? "Conexão e extrato limpos." : "Cartão e extrato excluídos.");
      await carregar();
      contexto?.invalidar("tudo");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível excluir o cartão.");
    }
  }

  function ao_conectar() {
    if (!usuario || !fonte) return;
    void conectar_banco({
      usuarioId: usuario.id,
      fonte,
      widgetRef,
      aoOcupado: setOcupado,
      aoErro: (mensagem) => toast.erro(mensagem),
      aoSucesso: async () => {
        toast.sucesso("Banco conectado. Contas e cartões foram criados neste workspace.");
        await carregar();
        contexto?.invalidar("tudo");
      },
    });
  }

  async function registrar_item_manual() {
    if (!usuario) return;
    const itemId = itemIdManual.trim();
    if (!itemId) {
      toast.erro("Informe o itemId da Pluggy / Meu Pluggy.");
      return;
    }
    if (/\s/.test(itemId) || itemId.includes(",")) {
      toast.erro("Informe um único itemId por vez. Salve, depois registre o próximo.");
      return;
    }
    setOcupado(true);
    setProgressoImportacao({ percentual: 2, mensagem: "Registrando conexão…" });
    try {
      const registrada = await clienteApi.registrar_conexao({
        usuarioId: usuario.id,
        conexaoExterna: itemId,
      });
      let importou = false;
      try {
        await clienteApi.atualizar_conexao(
          registrada.conexao.id,
          usuario.id,
          (p: ProgressoImportacaoApi) => {
            setProgressoImportacao({
              percentual: p.percentual,
              mensagem: p.mensagem,
              criados: p.criados,
            });
          },
        );
        importou = true;
      } catch (syncErro) {
        toast.erro(
          syncErro instanceof ErroApi
            ? syncErro.message
            : "Conexão salva, mas não consegui importar o extrato agora.",
        );
      }
      setItemIdManual("");
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes", "extrato");
      const nome = registrada.conexao.instituicao ?? "Conexão";
      if (importou) {
        toast.sucesso(
          `${nome} salva. Saldos e extrato importados do banco. Pode registrar outro itemId.`,
        );
      }
    } catch (e) {
      toast.erro(
        e instanceof ErroApi
          ? e.message
          : "Não foi possível registrar o itemId. Confira se a Application enxerga esse item.",
      );
    } finally {
      setOcupado(false);
      setProgressoImportacao(null);
    }
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-texto">Contas</h1>
        <p className="text-sm text-texto-suave">
          Contas e cartões do usuário (globais). Workspace só agrupa filtros e relatórios.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Botao onClick={ao_conectar} disabled={ocupado || !fonte?.disponivel}>
          <Link2 size={14} />
          {ocupado ? "Conectando..." : "Conectar banco"}
        </Botao>
        <Botao variante="fantasma" onClick={() => abrir_criar("conta")}>
          <Plus size={14} />
          Adicionar conta
        </Botao>
        <Botao variante="fantasma" onClick={() => abrir_criar("cartao")}>
          <Plus size={14} />
          Adicionar cartão
        </Botao>
        <Botao variante="fantasma" onClick={() => setPainelWs(true)}>
          <FolderKanban size={14} />
          Workspaces
        </Botao>
        <Link to="/conexoes">
          <Botao variante="fantasma">Gerenciar conexões</Botao>
        </Link>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {fonte?.id === "pluggy" && (
        <Cartao className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-texto">Conectar Meu Pluggy (itemId)</p>
            <p className="mt-1 text-xs text-texto-suave">
              Um banco por vez: cole o itemId, salve — a conexão entra na lista e o sync é
              pedido. Depois cole o próximo ID (Itaú, Mercado Pago…).
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="min-w-0 flex-1 rounded-lg border border-borda bg-superficie-alta px-3 py-2 text-sm text-texto"
              placeholder="uuid do item (um por vez)"
              value={itemIdManual}
              disabled={ocupado}
              onChange={(e) => setItemIdManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void registrar_item_manual();
              }}
            />
            <Botao
              disabled={ocupado || !itemIdManual.trim()}
              onClick={() => void registrar_item_manual()}
            >
              {ocupado ? "Importando…" : "Salvar conexão"}
            </Botao>
          </div>
          <BarraProgressoImportacao progresso={progressoImportacao} />
        </Cartao>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-medium text-texto">
          <Wallet size={18} className="text-primaria" />
          Contas
        </h2>

        {carregando && contas.length === 0 ? (
          <p className="text-sm text-texto-suave">Carregando...</p>
        ) : contas.length === 0 ? (
          <p className="rounded-2xl border border-borda bg-superficie/80 p-4 text-sm text-texto-suave">
            Nenhuma conta cadastrada. Conecte um banco ou cadastre manualmente.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contas.map((conta, i) => {
              const badge = badge_origem(conta);
              const perfilBadge = badge_perfil(conta.perfil);
              const saldo = para_numero(conta.saldoAtual);
              return (
                <motion.li
                  key={conta.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/80 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-texto">{conta.nome}</p>
                      <span
                        className={unir_classes(
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          perfilBadge.classe,
                        )}
                        title="Perfil da conta"
                      >
                        {perfilBadge.rotulo}
                      </span>
                      {conta.workspaceNome ? (
                        <span
                          className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] text-texto-suave"
                          title="Workspace: agrupador para filtros e relatórios"
                        >
                          {conta.workspaceNome}
                        </span>
                      ) : null}
                      <span
                        className={unir_classes(
                          "rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                          badge.classe,
                        )}
                      >
                        {badge.rotulo}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p
                      className={unir_classes(
                        "text-base font-semibold tabular-nums",
                        saldo < 0 ? "text-despesa" : "text-texto",
                      )}
                    >
                      {formatar_moeda(saldo)}
                    </p>
                    <Botao
                      variante="fantasma"
                      className="px-2"
                      title="Editar conta"
                      onClick={() => abrir_editar_conta(conta)}
                    >
                      <Pencil size={14} />
                    </Botao>
                    <Botao
                      variante="fantasma"
                      className="px-2 text-despesa"
                      title="Excluir conta"
                      onClick={() => void excluir_conta(conta)}
                    >
                      <Trash2 size={14} />
                    </Botao>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="cartoes" className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-medium text-texto">
          <CreditCard size={18} className="text-primaria" />
          Cartões
        </h2>

        {carregando && cartoes.length === 0 ? (
          <p className="text-sm text-texto-suave">Carregando...</p>
        ) : cartoes.length === 0 ? (
          <p className="rounded-2xl border border-borda bg-superficie/80 p-4 text-sm text-texto-suave">
            Nenhum cartão cadastrado. Conecte um banco ou cadastre manualmente.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cartoes.map((cartao, i) => {
              const badge = badge_origem(cartao);
              const perfilBadge = badge_perfil(cartao.perfil);
              return (
                <motion.li
                  key={cartao.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/80 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-texto">
                        {cartao.nome}
                        {cartao.final4 ? (
                          <span className="text-texto-suave"> ···· {cartao.final4}</span>
                        ) : null}
                      </p>
                      <span
                        className={unir_classes(
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          perfilBadge.classe,
                        )}
                        title="Perfil do cartão"
                      >
                        {perfilBadge.rotulo}
                      </span>
                      {cartao.workspaceNome ? (
                        <span
                          className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] text-texto-suave"
                          title="Workspace: agrupador para filtros e relatórios"
                        >
                          {cartao.workspaceNome}
                        </span>
                      ) : null}
                      <span
                        className={unir_classes(
                          "rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                          badge.classe,
                        )}
                      >
                        {badge.rotulo}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-texto-suave">
                      Limite {formatar_moeda(para_numero(cartao.limite))}
                      {cartao.sincronizada ? (
                        <>
                          {" · "}
                          Disponível{" "}
                          {formatar_moeda(
                            para_numero(cartao.limite) - para_numero(cartao.saldo),
                          )}
                        </>
                      ) : null}
                      {" · "}
                      Fecha dia {cartao.fechamento ?? "—"} · Vence dia {cartao.vencimento}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p
                      className={unir_classes(
                        "text-base font-semibold tabular-nums",
                        para_numero(cartao.saldo) > 0 ? "text-despesa" : "text-texto",
                      )}
                    >
                      {formatar_moeda(para_numero(cartao.saldo))}
                    </p>
                    <Botao
                      variante="fantasma"
                      className="px-2"
                      title="Editar cartão"
                      onClick={() => abrir_editar_cartao(cartao)}
                    >
                      <Pencil size={14} />
                    </Botao>
                    <Botao
                      variante="fantasma"
                      className="px-2 text-despesa"
                      title="Excluir cartão"
                      onClick={() => void excluir_cartao(cartao)}
                    >
                      <Trash2 size={14} />
                    </Botao>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>

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
    </div>
  );
}
