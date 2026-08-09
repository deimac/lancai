import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Perfil } from "@lancai/tipos";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type CartaoResumo, type ContaResumo } from "../lib/api";
import { Botao } from "./ui/Botao";
import { Campo } from "./ui/Campo";

export type TipoCadastro = "conta" | "cartao";

type Props = {
  aberto: boolean;
  modo: "criar" | "editar";
  tipoInicial?: TipoCadastro;
  alvo?: ContaResumo | CartaoResumo | null;
  aoFechar: () => void;
  aoSalvar: () => void;
};

function eh_cartao(alvo: ContaResumo | CartaoResumo | null | undefined): alvo is CartaoResumo {
  return Boolean(alvo && "limite" in alvo && "vencimento" in alvo);
}

function dia_valido(valor: string): number | null {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

function para_numero(valor: string): number | null {
  const n = Number(valor.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function ModalContaCartao({
  aberto,
  modo,
  tipoInicial = "conta",
  alvo,
  aoFechar,
  aoSalvar,
}: Props) {
  const { usuario } = useAutenticacao();
  const editando = modo === "editar";
  const tipoFixo: TipoCadastro | null = editando ? (eh_cartao(alvo) ? "cartao" : "conta") : null;

  const [tipo, setTipo] = useState<TipoCadastro>(tipoInicial);
  const [nome, setNome] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("pf");
  const [saldo, setSaldo] = useState("0");
  const [limite, setLimite] = useState("5000");
  const [fechamento, setFechamento] = useState("10");
  const [vencimento, setVencimento] = useState("17");
  const [numero, setNumero] = useState("");
  const [validade, setValidade] = useState("");
  const [cvv, setCvv] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const tipoEfetivo = tipoFixo ?? tipo;
  const sincronizada = Boolean(alvo?.sincronizada);
  const temPlastico = eh_cartao(alvo) && Boolean(alvo.final4);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setTipo(tipoInicial);
    if (editando && alvo) {
      setNome(alvo.nome);
      setPerfil(alvo.perfil);
      if (eh_cartao(alvo)) {
        setSaldo(String(Number(alvo.saldo ?? 0)));
        setLimite(String(Number(alvo.limite ?? 0)));
        setFechamento(String(alvo.fechamento ?? 10));
        setVencimento(String(alvo.vencimento ?? 17));
      } else {
        setSaldo(String(Number(alvo.saldoAtual ?? 0)));
      }
    } else {
      setNome("");
      setPerfil("pf");
      setSaldo("0");
      setLimite("5000");
      setFechamento("10");
      setVencimento("17");
    }
    setNumero("");
    setValidade("");
    setCvv("");
  }, [aberto, editando, alvo, tipoInicial]);

  if (!aberto || !usuario) return null;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;

    const saldoNum = para_numero(saldo);
    if (saldoNum == null || saldoNum < 0) {
      setErro("Informe um saldo válido.");
      return;
    }

    const algumPlastico = Boolean(numero.trim() || validade.trim() || cvv.trim());
    if (tipoEfetivo === "cartao" && algumPlastico) {
      if (!numero.trim() || !validade.trim() || !cvv.trim()) {
        setErro("Preencha número, validade e CVV juntos, ou deixe os três em branco.");
        return;
      }
    }

    setSalvando(true);
    setErro(null);
    try {
      if (tipoEfetivo === "conta") {
        if (editando && alvo && !eh_cartao(alvo)) {
          await clienteApi.atualizar_conta(alvo.id, {
            usuarioId: usuario.id,
            nome: nome.trim(),
            perfil,
            ...(sincronizada ? {} : { saldoAtual: saldoNum }),
          });
        } else {
          await clienteApi.criar_conta({
            usuarioId: usuario.id,
            nome: nome.trim(),
            perfil,
            saldoInicial: saldoNum,
          });
        }
      } else {
        const diaFechamento = dia_valido(fechamento);
        const diaVencimento = dia_valido(vencimento);
        const limiteNum = para_numero(limite);
        if (diaFechamento == null || diaVencimento == null) {
          setErro("Fechamento e vencimento precisam ser dias entre 1 e 31.");
          setSalvando(false);
          return;
        }
        if (limiteNum == null || limiteNum < 0) {
          setErro("Informe um limite válido.");
          setSalvando(false);
          return;
        }
        const plastico =
          algumPlastico
            ? { numero: numero.trim(), validade: validade.trim(), cvv: cvv.trim() }
            : undefined;

        if (editando && alvo && eh_cartao(alvo)) {
          await clienteApi.atualizar_cartao(alvo.id, {
            usuarioId: usuario.id,
            nome: nome.trim(),
            perfil,
            ...(sincronizada
              ? {}
              : {
                  limite: limiteNum,
                  saldo: saldoNum,
                  fechamento: diaFechamento,
                  vencimento: diaVencimento,
                  ...(plastico ? { plastico } : {}),
                }),
          });
        } else {
          await clienteApi.criar_cartao({
            usuarioId: usuario.id,
            nome: nome.trim(),
            perfil,
            limite: limiteNum,
            saldo: saldoNum,
            fechamento: diaFechamento,
            vencimento: diaVencimento,
            ...(plastico ? { plastico } : {}),
          });
        }
      }
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={(e) => void salvar(e)}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-borda bg-superficie shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-borda px-4 py-3">
          <h2 className="text-lg font-semibold text-texto">
            {editando
              ? tipoEfetivo === "cartao"
                ? "Editar cartão"
                : "Editar conta"
              : "Adicionar conta"}
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1 text-texto-suave hover:bg-superficie-alta hover:text-texto"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Nome
            <Campo
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={tipoEfetivo === "cartao" ? "Ex.: Cartão XP" : "Ex.: Conta Nubank"}
              required
              autoFocus
            />
          </label>

          {!editando && (
            <label className="flex flex-col gap-1 text-xs text-texto-suave">
              Tipo
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoCadastro)}
                className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto"
              >
                <option value="conta">Conta corrente</option>
                <option value="cartao">Cartão de crédito</option>
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Perfil
            <select
              value={perfil}
              onChange={(e) => setPerfil(e.target.value as Perfil)}
              className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto"
            >
              <option value="pf">Pessoa física</option>
              <option value="pj">Pessoa jurídica</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Saldo
            <Campo
              inputMode="decimal"
              value={saldo}
              onChange={(e) => setSaldo(e.target.value)}
              disabled={sincronizada}
            />
            <span className="text-[11px] text-texto-suave">
              {tipoEfetivo === "cartao"
                ? "Saldo devido do cartão (gasto atual). Use 0 se não houver dívida."
                : "Valor que tem na conta."}
            </span>
          </label>

          {tipoEfetivo === "cartao" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-texto-suave">
                Limite do cartão
                <Campo
                  inputMode="decimal"
                  value={limite}
                  onChange={(e) => setLimite(e.target.value)}
                  disabled={sincronizada}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-texto-suave">
                  Dia de fechamento
                  <Campo
                    inputMode="numeric"
                    value={fechamento}
                    onChange={(e) => setFechamento(e.target.value)}
                    disabled={sincronizada}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-texto-suave">
                  Dia de vencimento
                  <Campo
                    inputMode="numeric"
                    value={vencimento}
                    onChange={(e) => setVencimento(e.target.value)}
                    disabled={sincronizada}
                  />
                </label>
              </div>

              {!sincronizada && (
                <fieldset className="flex flex-col gap-3 rounded-xl border border-borda p-3">
                  <legend className="px-1 text-xs text-texto-suave">Dados do plástico</legend>
                  {temPlastico && (
                    <p className="text-[11px] text-texto-suave">
                      Plástico salvo: ···· {eh_cartao(alvo) ? alvo.final4 : ""}. Deixe em branco para
                      manter; preencha os três campos só se quiser substituir.
                    </p>
                  )}
                  <label className="flex flex-col gap-1 text-xs text-texto-suave">
                    Número do cartão
                    <Campo
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      placeholder={temPlastico ? "Manter o atual" : "0000 0000 0000 0000"}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-texto-suave">
                      Validade
                      <Campo
                        autoComplete="cc-exp"
                        value={validade}
                        onChange={(e) => setValidade(e.target.value)}
                        placeholder={temPlastico ? "Manter" : "MM/AA"}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-texto-suave">
                      CVV
                      <Campo
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        value={cvv}
                        onChange={(e) => setCvv(e.target.value)}
                        placeholder={temPlastico ? "Manter" : "•••"}
                      />
                    </label>
                  </div>
                </fieldset>
              )}
            </>
          )}

          {sincronizada && (
            <p className="text-xs text-texto-suave">
              Item sincronizado: valores financeiros vêm do banco — só nome e perfil podem mudar.
            </p>
          )}

          {erro && <p className="text-sm text-despesa">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-borda px-4 py-3">
          <Botao type="button" variante="fantasma" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" disabled={salvando || !nome.trim()}>
            {salvando ? "Salvando..." : "Salvar"}
          </Botao>
        </div>
      </form>
    </div>
  );
}
