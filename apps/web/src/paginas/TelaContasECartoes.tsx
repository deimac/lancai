import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CreditCard, FolderKanban, Link2, Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import type { WidgetAberto } from "@lancai/open-finance/web";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
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
import { Campo } from "../componentes/ui/Campo";
import { PainelWorkspaces } from "../componentes/PainelWorkspaces";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

function para_numero(valor: string | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dia_valido(valor: string): number | null {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
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
  const contexto = useContextoLayout();
  const widgetRef = useRef<WidgetAberto | null>(null);
  const [fonte, setFonte] = useState<DescritorFonte | null>(null);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [visaoGeral, setVisaoGeral] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [formConta, setFormConta] = useState(false);
  const [formCartao, setFormCartao] = useState(false);
  const [painelWs, setPainelWs] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [nomeConta, setNomeConta] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("0");

  const [nomeCartao, setNomeCartao] = useState("");
  const [limite, setLimite] = useState("5000");
  const [fechamento, setFechamento] = useState("10");
  const [vencimento, setVencimento] = useState("17");
  const [contaId, setContaId] = useState("");

  const deps = chave_dependencia(contexto?.versoes, "contas", "cartoes", "conexoes");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [contasCarregadas, cartoesCarregados, fonteDesc, workspaces] = await Promise.all([
        clienteApi.listar_contas(usuario.id),
        clienteApi.listar_cartoes(usuario.id),
        clienteApi.descrever_fonte().catch(() => ({ disponivel: false } as DescritorFonte)),
        clienteApi.listar_workspaces(usuario.id).catch(() => []),
      ]);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
      setFonte(fonteDesc);
      const ativo = workspaces.find((w) => w.ativo);
      setVisaoGeral(ativo?.id === "geral" || Boolean(ativo?.sintetico));
      if (ativo?.id === "geral" || ativo?.sintetico) {
        setFormConta(false);
        setFormCartao(false);
      }
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

  const totalContas = useMemo(
    () => contas.reduce((acc, c) => acc + para_numero(c.saldoAtual), 0),
    [contas],
  );

  async function criar_conta(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nomeConta.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      const saldo = Number(saldoInicial.replace(",", "."));
      await clienteApi.criar_conta({
        usuarioId: usuario.id,
        nome: nomeConta.trim(),
        perfil: "pf",
        saldoInicial: Number.isFinite(saldo) ? saldo : 0,
      });
      setNomeConta("");
      setSaldoInicial("0");
      setFormConta(false);
      await carregar();
      contexto?.invalidar("contas", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar a conta.");
    } finally {
      setSalvando(false);
    }
  }

  async function criar_cartao(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nomeCartao.trim()) return;
    const diaFechamento = dia_valido(fechamento);
    const diaVencimento = dia_valido(vencimento);
    const limiteNum = Number(limite.replace(",", "."));
    if (diaFechamento == null || diaVencimento == null) {
      setErro("Fechamento e vencimento precisam ser dias entre 1 e 31.");
      return;
    }
    if (!Number.isFinite(limiteNum) || limiteNum < 0) {
      setErro("Informe um limite válido.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await clienteApi.criar_cartao({
        usuarioId: usuario.id,
        nome: nomeCartao.trim(),
        limite: limiteNum,
        fechamento: diaFechamento,
        vencimento: diaVencimento,
        perfil: "pf",
        ...(contaId ? { contaId } : {}),
      });
      setNomeCartao("");
      setLimite("5000");
      setFechamento("10");
      setVencimento("17");
      setContaId("");
      setFormCartao(false);
      await carregar();
      contexto?.invalidar("cartoes", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar o cartão.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir_conta(conta: ContaResumo) {
    if (!usuario) return;
    if (!window.confirm(`Excluir a conta "${conta.nome}"? O histórico permanece.`)) return;
    try {
      await clienteApi.excluir_conta(conta.id, usuario.id);
      await carregar();
      contexto?.invalidar("contas", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível excluir a conta.");
    }
  }

  async function excluir_cartao(cartao: CartaoResumo) {
    if (!usuario) return;
    if (!window.confirm(`Excluir o cartão "${cartao.nome}"? O histórico permanece.`)) return;
    try {
      await clienteApi.excluir_cartao(cartao.id, usuario.id);
      await carregar();
      contexto?.invalidar("cartoes", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível excluir o cartão.");
    }
  }

  function ao_conectar() {
    if (!usuario || !fonte) return;
    setOk(null);
    void conectar_banco({
      usuarioId: usuario.id,
      fonte,
      widgetRef,
      aoOcupado: setOcupado,
      aoErro: setErro,
      aoSucesso: async () => {
        setOk("Banco conectado. Contas e cartões foram criados neste workspace.");
        await carregar();
        contexto?.invalidar("tudo");
      },
    });
  }

  if (!usuario) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Contas</h1>
          <p className="text-sm text-texto-suave">
            {visaoGeral
              ? "Todos os workspaces — escolha um workspace para cadastrar"
              : "Manuais e sincronizados no workspace ativo — o banco é só a fonte"}
          </p>
        </div>
        <Botao variante="fantasma" onClick={() => void carregar()} disabled={carregando || ocupado}>
          <RefreshCw size={14} className={carregando ? "animate-spin" : undefined} />
          Atualizar
        </Botao>
      </div>

      {visaoGeral && (
        <p className="rounded-lg border border-borda bg-superficie/80 px-3 py-2 text-sm text-texto-suave">
          Escolha um workspace no seletor para conectar banco ou cadastrar conta/cartão.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Botao
          onClick={ao_conectar}
          disabled={visaoGeral || ocupado || !fonte?.disponivel}
          title={visaoGeral ? "Escolha um workspace para cadastrar" : undefined}
        >
          <Link2 size={14} />
          {ocupado ? "Conectando..." : "Conectar banco"}
        </Botao>
        <Botao
          variante="fantasma"
          disabled={visaoGeral}
          title={visaoGeral ? "Escolha um workspace para cadastrar" : undefined}
          onClick={() => {
            setFormCartao(false);
            setFormConta((v) => !v);
          }}
        >
          <Plus size={14} />
          Nova conta
        </Botao>
        <Botao
          variante="fantasma"
          disabled={visaoGeral}
          title={visaoGeral ? "Escolha um workspace para cadastrar" : undefined}
          onClick={() => {
            setFormConta(false);
            setFormCartao((v) => !v);
          }}
        >
          <Plus size={14} />
          Novo cartão
        </Botao>
        <Botao variante="fantasma" onClick={() => setPainelWs(true)}>
          <FolderKanban size={14} />
          Workspaces
        </Botao>
        <Link to="/conexoes">
          <Botao variante="fantasma">Gerenciar conexões</Botao>
        </Link>
      </div>

      <PainelWorkspaces
        aberto={painelWs}
        aoFechar={() => setPainelWs(false)}
        aoMudar={() => {
          void carregar();
          contexto?.invalidar("tudo");
        }}
      />

      {ok && (
        <div className="rounded-lg border border-primaria/40 bg-primaria/10 px-3 py-2 text-sm text-texto">
          {ok}
        </div>
      )}
      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {formConta && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => void criar_conta(e)}
          className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <p className="text-sm font-medium text-texto">Nova conta manual</p>
          <Campo
            placeholder="Nome (ex.: Dinheiro em espécie)"
            value={nomeConta}
            onChange={(e) => setNomeConta(e.target.value)}
            required
            autoFocus
          />
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Saldo inicial
            <Campo
              inputMode="decimal"
              value={saldoInicial}
              onChange={(e) => setSaldoInicial(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setFormConta(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={salvando || !nomeConta.trim()}>
              {salvando ? "Salvando..." : "Criar conta"}
            </Botao>
          </div>
        </motion.form>
      )}

      {formCartao && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => void criar_cartao(e)}
          className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <p className="text-sm font-medium text-texto">Novo cartão manual</p>
          <Campo
            placeholder="Nome (ex.: Cartão XP)"
            value={nomeCartao}
            onChange={(e) => setNomeCartao(e.target.value)}
            required
            autoFocus
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Limite
              <Campo inputMode="decimal" value={limite} onChange={(e) => setLimite(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Fechamento
              <Campo
                inputMode="numeric"
                value={fechamento}
                onChange={(e) => setFechamento(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Vencimento
              <Campo
                inputMode="numeric"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Conta vinculada (opcional)
            <select
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto"
            >
              <option value="">Nenhuma</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setFormCartao(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={salvando || !nomeCartao.trim()}>
              {salvando ? "Salvando..." : "Criar cartão"}
            </Botao>
          </div>
        </motion.form>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-medium text-texto">
            <Wallet size={18} className="text-primaria" />
            Contas
          </h2>
          <p className="text-sm tabular-nums text-texto-suave">{formatar_moeda(totalContas)}</p>
        </div>

        {carregando && contas.length === 0 ? (
          <p className="text-sm text-texto-suave">Carregando...</p>
        ) : contas.length === 0 ? (
          <p className="rounded-2xl border border-borda bg-superficie/80 p-4 text-sm text-texto-suave">
            {visaoGeral
              ? "Nenhuma conta nos seus workspaces."
              : "Nenhuma conta neste workspace. Conecte um banco ou cadastre manualmente."}
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
                      {visaoGeral && conta.workspaceNome ? (
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
            {visaoGeral
              ? "Nenhum cartão nos seus workspaces."
              : "Nenhum cartão neste workspace. Conecte um banco ou cadastre manualmente."}
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
                      {visaoGeral && cartao.workspaceNome ? (
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
                      Fecha dia {cartao.fechamento ?? "—"} · Vence dia {cartao.vencimento}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="text-base font-semibold tabular-nums text-texto">
                      {formatar_moeda(para_numero(cartao.limite))}
                    </p>
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
    </div>
  );
}
