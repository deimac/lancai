import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Link2, Plus, RefreshCw, Wallet } from "lucide-react";
import type { Perfil } from "@lancai/tipos";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type ContaResumo } from "../lib/api";
import { formatar_moeda } from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { useContextoLayout } from "../layout/useContextoLayout";
import { unir_classes } from "../lib/unir-classes";

function para_numero(valor: string | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function TelaContas() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [nome, setNome] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("pf");
  const [saldoInicial, setSaldoInicial] = useState("0");
  const depsDados = chave_dependencia(contexto?.versoes, "contas");

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      setContas(await clienteApi.listar_contas(usuario.id));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar as contas.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  const total = useMemo(
    () => contas.reduce((acc, conta) => acc + para_numero(conta.saldoAtual), 0),
    [contas],
  );

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      const saldo = Number(saldoInicial.replace(",", "."));
      await clienteApi.criar_conta({
        usuarioId: usuario.id,
        nome: nome.trim(),
        perfil,
        saldoInicial: Number.isFinite(saldo) ? saldo : 0,
      });
      setNome("");
      setSaldoInicial("0");
      setPerfil("pf");
      setMostrandoForm(false);
      await carregar();
      contexto?.invalidar("contas", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar a conta.");
    } finally {
      setSalvando(false);
    }
  }

  if (!usuario) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Contas</h1>
          <p className="text-sm text-texto-suave">
            Saldos e origem — contas sincronizadas só classificam pelo assistente
          </p>
        </div>
        <div className="flex gap-2">
          <Botao variante="fantasma" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw size={14} className={carregando ? "animate-spin" : undefined} />
            Atualizar
          </Botao>
          <Botao onClick={() => setMostrandoForm((v) => !v)}>
            <Plus size={14} />
            Nova conta
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
            <Wallet size={16} className="text-primaria" />
            <span className="text-xs uppercase tracking-wide">Total nas contas</span>
          </div>
          <p className="text-xl font-semibold tracking-tight text-texto">{formatar_moeda(total)}</p>
        </div>
      </motion.div>

      {mostrandoForm && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => void criar(e)}
          className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
        >
          <p className="text-sm font-medium text-texto">Nova conta manual</p>
          <p className="text-xs text-texto-suave">
            Conta do banco? Prefira{" "}
            <Link to="/conexoes" className="text-primaria hover:underline">
              conectar em Bancos
            </Link>{" "}
            para o extrato entrar sozinho.
          </p>
          <Campo
            placeholder="Nome (ex.: Nubank)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Perfil
              <select
                value={perfil}
                onChange={(e) => setPerfil(e.target.value as Perfil)}
                className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto outline-none focus:border-primaria"
              >
                <option value="pf">Pessoal (PF)</option>
                <option value="pj">Empresa (PJ)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Saldo inicial
              <Campo
                inputMode="decimal"
                value={saldoInicial}
                onChange={(e) => setSaldoInicial(e.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setMostrandoForm(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" disabled={salvando || !nome.trim()}>
              {salvando ? "Salvando..." : "Criar conta"}
            </Botao>
          </div>
        </motion.form>
      )}

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {carregando && contas.length === 0 ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : contas.length === 0 ? (
        <div className="rounded-2xl border border-borda bg-superficie/80 p-6 text-center">
          <p className="text-sm text-texto">Nenhuma conta ainda.</p>
          <p className="mt-1 text-xs text-texto-suave">
            Crie uma conta manual ou conecte um banco para sincronizar.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Botao onClick={() => setMostrandoForm(true)}>
              <Plus size={14} />
              Nova conta
            </Botao>
            <Link to="/conexoes">
              <Botao variante="fantasma">
                <Link2 size={14} />
                Conectar banco
              </Botao>
            </Link>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {contas.map((conta, indice) => {
            const sincronizada = conta.sincronizada === true;
            const saldo = para_numero(conta.saldoAtual);
            return (
              <motion.li
                key={conta.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: indice * 0.03 }}
                className="flex items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/80 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-texto">{conta.nome}</p>
                    <span className="rounded-md border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-suave">
                      {conta.perfil}
                    </span>
                    {sincronizada && (
                      <span
                        className="rounded-md border border-primaria/40 bg-primaria/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primaria"
                        title="Esta conta é sincronizada: o assistente só classifica, não altera o Fato"
                      >
                        Sincronizada
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-texto-suave">
                    {sincronizada
                      ? "Extrato vem do banco — use o assistente para classificar"
                      : "Conta manual — você pode lançar pelo assistente"}
                  </p>
                </div>
                <p
                  className={unir_classes(
                    "shrink-0 text-base font-semibold tabular-nums",
                    saldo < 0 ? "text-despesa" : "text-texto",
                  )}
                >
                  {formatar_moeda(saldo)}
                </p>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
