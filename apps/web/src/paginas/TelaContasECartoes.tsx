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
} from "../lib/api";
import { conectar_banco } from "../lib/conectar-banco";
import { formatar_moeda } from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { ModalContaCartao, type TipoCadastro } from "../componentes/ModalContaCartao";
import { PainelWorkspaces } from "../componentes/PainelWorkspaces";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

function para_numero(valor: string | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
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

  const deps = chave_dependencia(contexto?.versoes, "contas", "cartoes", "conexoes");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [contasCarregadas, cartoesCarregados, fonteDesc] = await Promise.all([
        clienteApi.listar_contas(usuario.id, true),
        clienteApi.listar_cartoes(usuario.id, true),
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
    const ok = await confirmar({
      titulo: "Excluir conta?",
      mensagem:
        `Esta ação é irreversível. A conta "${conta.nome}" some das listagens, ` +
        "mas o histórico de lançamentos vinculados é preservado.",
      confirmarRotulo: "Excluir",
    });
    if (!ok) return;
    try {
      await clienteApi.excluir_conta(conta.id, usuario.id);
      toast.sucesso("Conta excluída.");
      await carregar();
      contexto?.invalidar("contas", "dashboard");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível excluir a conta.");
    }
  }

  async function excluir_cartao(cartao: CartaoResumo) {
    if (!usuario) return;
    const ok = await confirmar({
      titulo: "Excluir cartão?",
      mensagem:
        `Esta ação é irreversível. O cartão "${cartao.nome}" some das listagens, ` +
        "mas o histórico de lançamentos vinculados é preservado.",
      confirmarRotulo: "Excluir",
    });
    if (!ok) return;
    try {
      await clienteApi.excluir_cartao(cartao.id, usuario.id);
      toast.sucesso("Cartão excluído.");
      await carregar();
      contexto?.invalidar("cartoes", "dashboard");
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
          Todas as contas e cartões — novos cadastros e conexões vão para o workspace ativo
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
                      {conta.workspaceNome ? (
                        <span className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] text-texto-suave">
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
                      {cartao.workspaceNome ? (
                        <span className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] text-texto-suave">
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
                      Saldo {formatar_moeda(para_numero(cartao.saldo))} · Fecha dia{" "}
                      {cartao.fechamento ?? "—"} · Vence dia {cartao.vencimento}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="text-base font-semibold tabular-nums text-texto">
                      {formatar_moeda(para_numero(cartao.limite))}
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
