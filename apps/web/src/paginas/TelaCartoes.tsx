import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CreditCard, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useConfirmacao } from "../contexto/ContextoConfirmacao";
import { clienteApi, ErroApi, type CartaoResumo, type ContaResumo } from "../lib/api";
import { formatar_moeda } from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { CampoValor } from "../componentes/ui/CampoValor";
import { useContextoLayout } from "../layout/useContextoLayout";
import { parsear_valor_mascara, valor_para_mascara } from "../lib/mascara-valor";
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

export function TelaCartoes() {
  const { usuario } = useAutenticacao();
  const { confirmar } = useConfirmacao();
  const contexto = useContextoLayout();
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [nome, setNome] = useState("");
  const [limite, setLimite] = useState(valor_para_mascara(5000));
  const [fechamento, setFechamento] = useState("10");
  const [vencimento, setVencimento] = useState("17");
  const [contaId, setContaId] = useState("");
  const depsDados = chave_dependencia(contexto?.versoes, "cartoes", "contas");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [cartoesCarregados, contasCarregadas] = await Promise.all([
        clienteApi.listar_cartoes(usuario.id),
        clienteApi.listar_contas(usuario.id),
      ]);
      setCartoes(cartoesCarregados);
      setContas(contasCarregadas);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar os cartões.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  const limiteTotal = useMemo(
    () => cartoes.reduce((acc, cartao) => acc + para_numero(cartao.limite), 0),
    [cartoes],
  );

  const nomeConta = useCallback(
    (id: string | null | undefined) => {
      if (!id) return null;
      return contas.find((c) => c.id === id)?.nome ?? null;
    },
    [contas],
  );

  function limpar_form() {
    setNome("");
    setLimite(valor_para_mascara(5000));
    setFechamento("10");
    setVencimento("17");
    setContaId("");
    setMostrandoForm(false);
    setEditandoId(null);
  }

  function iniciar_edicao(cartao: CartaoResumo) {
    setMostrandoForm(false);
    setEditandoId(cartao.id);
    setNome(cartao.nome);
    setLimite(valor_para_mascara(para_numero(cartao.limite)));
    setFechamento(String(cartao.fechamento ?? 10));
    setVencimento(String(cartao.vencimento));
    setContaId(cartao.contaId ?? "");
    setErro(null);
  }

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;
    const diaFechamento = dia_valido(fechamento);
    const diaVencimento = dia_valido(vencimento);
    const limiteNum = parsear_valor_mascara(limite);
    if (diaFechamento == null || diaVencimento == null) {
      setErro("Fechamento e vencimento precisam ser dias entre 1 e 31.");
      return;
    }
    if (limiteNum == null || limiteNum < 0) {
      setErro("Informe um limite válido.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      await clienteApi.criar_cartao({
        usuarioId: usuario.id,
        nome: nome.trim(),
        limite: limiteNum,
        fechamento: diaFechamento,
        vencimento: diaVencimento,
        perfil: "pf",
        ...(contaId ? { contaId } : {}),
      });
      limpar_form();
      await carregar();
      contexto?.invalidar("cartoes", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar o cartão.");
    } finally {
      setSalvando(false);
    }
  }

  async function salvar_edicao(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !editandoId || !nome.trim()) return;
    const cartao = cartoes.find((item) => item.id === editandoId);
    if (!cartao) return;

    const diaFechamento = dia_valido(fechamento);
    const diaVencimento = dia_valido(vencimento);
    const limiteNum = parsear_valor_mascara(limite);
    if (diaFechamento == null || diaVencimento == null) {
      setErro("Fechamento e vencimento precisam ser dias entre 1 e 31.");
      return;
    }
    if (limiteNum == null || limiteNum < 0) {
      setErro("Informe um limite válido.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      await clienteApi.atualizar_cartao(editandoId, {
        usuarioId: usuario.id,
        nome: nome.trim(),
        ...(cartao.sincronizada
          ? {}
          : {
              limite: limiteNum,
              fechamento: diaFechamento,
              vencimento: diaVencimento,
              contaId: contaId || null,
            }),
      });
      limpar_form();
      await carregar();
      contexto?.invalidar("cartoes", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível atualizar o cartão.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(cartao: CartaoResumo) {
    if (!usuario) return;
    const ok = await confirmar({
      titulo: "Excluir cartão?",
      mensagem:
        `Esta ação é irreversível. O cartão "${cartao.nome}" some das listagens, ` +
        "mas o histórico de lançamentos vinculados é preservado.",
      confirmarRotulo: "Excluir",
    });
    if (!ok) return;
    setErro(null);
    try {
      await clienteApi.excluir_cartao(cartao.id, usuario.id);
      if (editandoId === cartao.id) limpar_form();
      await carregar();
      contexto?.invalidar("cartoes", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível excluir o cartão.");
    }
  }

  if (!usuario) return null;

  const cartaoEditando = editandoId ? cartoes.find((c) => c.id === editandoId) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Cartões</h1>
          <p className="text-sm text-texto-suave">
            Limite, fechamento e vencimento — cartões sincronizados só classificam
          </p>
        </div>
        <Botao
          onClick={() => {
            setEditandoId(null);
            setMostrandoForm((v) => !v);
          }}
        >
          <Plus size={14} />
          Novo cartão
        </Botao>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-borda bg-superficie/80 p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-texto-suave">
            <CreditCard size={16} className="text-primaria" />
            <span className="text-xs uppercase tracking-wide">Limite total</span>
          </div>
          <p className="text-xl font-semibold tracking-tight text-texto">
            {formatar_moeda(limiteTotal)}
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
          <p className="text-sm font-medium text-texto">Novo cartão manual</p>
          <p className="text-xs text-texto-suave">
            Cartão do banco? Prefira{" "}
            <Link to="/contas" className="text-primaria hover:underline">
              Contas
            </Link>
            .
          </p>
          <Campo
            placeholder="Nome (ex.: Nubank Roxinho)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Limite
              <CampoValor value={limite} onChange={setLimite} required />
            </label>
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Dia de fechamento
              <Campo
                inputMode="numeric"
                value={fechamento}
                onChange={(e) => setFechamento(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Dia de vencimento
              <Campo
                inputMode="numeric"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                required
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Conta vinculada (opcional)
            <select
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
            >
              <option value="">Nenhuma</option>
              {contas.map((conta) => (
                <option key={conta.id} value={conta.id}>
                  {conta.nome}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={limpar_form}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={salvando || !nome.trim()}>
              {salvando ? "Salvando..." : "Criar cartão"}
            </Botao>
          </div>
        </motion.form>
      )}

      {cartaoEditando && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => void salvar_edicao(e)}
          className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <p className="text-sm font-medium text-texto">Editar cartão</p>
          <Campo
            placeholder="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
          />
          {!cartaoEditando.sincronizada && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-texto-suave">
                Limite
                <CampoValor value={limite} onChange={setLimite} required />
              </label>
              <label className="flex flex-col gap-1 text-xs text-texto-suave">
                Dia de fechamento
                <Campo
                  inputMode="numeric"
                  value={fechamento}
                  onChange={(e) => setFechamento(e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-texto-suave">
                Dia de vencimento
                <Campo
                  inputMode="numeric"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                  required
                />
              </label>
            </div>
          )}
          {!cartaoEditando.sincronizada && (
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Conta vinculada (opcional)
              <select
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
                className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
              >
                <option value="">Nenhuma</option>
                {contas.map((conta) => (
                  <option key={conta.id} value={conta.id}>
                    {conta.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          {cartaoEditando.sincronizada && (
            <p className="text-xs text-texto-suave">
              Cartão sincronizado: limite e datas vêm do banco — só o nome pode mudar.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={limpar_form}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={salvando || !nome.trim()}>
              {salvando ? "Salvando..." : "Salvar"}
            </Botao>
          </div>
        </motion.form>
      )}

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {carregando && cartoes.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : cartoes.length === 0 ? (
        <div className="rounded-2xl border border-borda bg-superficie/80 p-6 text-center">
          <p className="text-sm text-texto">Nenhum cartão ainda.</p>
          <p className="mt-1 text-xs text-texto-suave">
            Cadastre um cartão manual ou conecte o banco para sincronizar.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Botao onClick={() => setMostrandoForm(true)}>
              <Plus size={14} />
              Novo cartão
            </Botao>
            <Link to="/contas">
              <Botao variante="fantasma">
                <Link2 size={14} />
                Conectar banco
              </Botao>
            </Link>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {cartoes.map((cartao, indice) => {
            const sincronizada = cartao.sincronizada === true;
            const vinculada = nomeConta(cartao.contaId);
            return (
              <motion.li
                key={cartao.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: indice * 0.03 }}
                className="flex items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/80 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-texto">
                      {cartao.nome}
                      {cartao.final4 ? (
                        <span className="text-texto-suave"> ···· {cartao.final4}</span>
                      ) : null}
                    </p>
                    <span className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave">
                      {cartao.modalidade}
                    </span>
                    {sincronizada && (
                      <span
                        className="rounded-md border border-primaria/40 bg-primaria/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primaria"
                        title="Cartão sincronizado: o assistente só classifica"
                      >
                        Sincronizado
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-texto-suave">
                    Fecha dia {cartao.fechamento ?? "—"} · Vence dia {cartao.vencimento}
                    {vinculada ? ` · Conta ${vinculada}` : ""}
                    {sincronizada
                      ? " · Extrato vem do banco"
                      : " · Lançamentos pelo assistente"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className={unir_classes("text-base font-semibold tabular-nums text-texto")}>
                    {formatar_moeda(para_numero(cartao.limite))}
                  </p>
                  <Botao
                    variante="fantasma"
                    className="px-2"
                    title="Editar cartão"
                    aria-label={`Editar ${cartao.nome}`}
                    onClick={() => iniciar_edicao(cartao)}
                  >
                    <Pencil size={14} />
                  </Botao>
                  <Botao
                    variante="fantasma"
                    className="px-2 text-despesa hover:text-despesa"
                    title="Excluir cartão"
                    aria-label={`Excluir ${cartao.nome}`}
                    onClick={() => void excluir(cartao)}
                  >
                    <Trash2 size={14} />
                  </Botao>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
