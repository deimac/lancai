import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Lock, X } from "lucide-react";
import type { Perfil } from "@lancai/tipos";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useToast } from "../contexto/ContextoToast";
import { clienteApi, ErroApi, type CartaoResumo, type ContaResumo } from "../lib/api";
import { parsear_valor_mascara, valor_para_mascara } from "../lib/mascara-valor";
import { Botao } from "./ui/Botao";
import { Campo } from "./ui/Campo";
import { CampoValor } from "./ui/CampoValor";

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

function formatar_numero_grupos(numero: string): string {
  const digitos = numero.replace(/\D/g, "");
  return digitos.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/** Máscara de validade do plástico: `MM/AA`. */
function formatar_validade_digitacao(entrada: string): string {
  let digitos = entrada.replace(/\D/g, "").slice(0, 4);
  if (digitos.length >= 1) {
    const d1 = Number(digitos[0]);
    if (d1 > 1) digitos = `0${digitos}`;
  }
  digitos = digitos.slice(0, 4);
  if (digitos.length >= 2) {
    let mes = Number(digitos.slice(0, 2));
    if (mes === 0) mes = 1;
    if (mes > 12) mes = 12;
    digitos = `${String(mes).padStart(2, "0")}${digitos.slice(2)}`;
  }
  if (digitos.length <= 2) return digitos;
  return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
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
  const toast = useToast();
  const editando = modo === "editar";
  const tipoFixo: TipoCadastro | null = editando ? (eh_cartao(alvo) ? "cartao" : "conta") : null;

  const [tipo, setTipo] = useState<TipoCadastro>(tipoInicial);
  const [nome, setNome] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("pf");
  const [saldo, setSaldo] = useState(valor_para_mascara(0));
  const [limite, setLimite] = useState(valor_para_mascara(5000));
  const [fechamento, setFechamento] = useState("10");
  const [vencimento, setVencimento] = useState("17");
  const [numero, setNumero] = useState("");
  const [validade, setValidade] = useState("");
  const [cvv, setCvv] = useState("");
  const [plasticoBloqueado, setPlasticoBloqueado] = useState(false);
  const [plasticoVisivel, setPlasticoVisivel] = useState(false);
  const [pedindoSenha, setPedindoSenha] = useState(false);
  const [senha, setSenha] = useState("");
  const [desbloqueando, setDesbloqueando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const tipoEfetivo = tipoFixo ?? tipo;
  const sincronizada = Boolean(alvo?.sincronizada);
  const temPlasticoSalvo =
    eh_cartao(alvo) && Boolean(alvo.temPlastico || alvo.final4);
  const final4 = eh_cartao(alvo) ? alvo.final4 : null;

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setTipo(tipoInicial);
    setPedindoSenha(false);
    setSenha("");
    setPlasticoVisivel(false);
    if (editando && alvo) {
      setNome(alvo.nome);
      setPerfil(alvo.perfil);
      if (eh_cartao(alvo)) {
        setSaldo(valor_para_mascara(Number(alvo.saldo ?? 0)));
        setLimite(valor_para_mascara(Number(alvo.limite ?? 0)));
        setFechamento(String(alvo.fechamento ?? 10));
        setVencimento(String(alvo.vencimento ?? 17));
        const tem = Boolean(alvo.temPlastico || alvo.final4);
        setPlasticoBloqueado(tem);
      } else {
        setSaldo(valor_para_mascara(Number(alvo.saldoAtual ?? 0)));
        setPlasticoBloqueado(false);
      }
    } else {
      setNome("");
      setPerfil("pf");
      setSaldo(valor_para_mascara(0));
      setLimite(valor_para_mascara(5000));
      setFechamento("10");
      setVencimento("17");
      setPlasticoBloqueado(false);
    }
    setNumero("");
    setValidade("");
    setCvv("");
  }, [aberto, editando, alvo, tipoInicial]);

  if (!aberto || !usuario) return null;

  async function desbloquear_plastico(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !alvo || !eh_cartao(alvo) || !senha.trim()) return;
    setDesbloqueando(true);
    setErro(null);
    try {
      const dados = await clienteApi.revelar_plastico(alvo.id, {
        usuarioId: usuario.id,
        senha: senha.trim(),
      });
      setNumero(formatar_numero_grupos(dados.numero));
      setValidade(formatar_validade_digitacao(dados.validade));
      setCvv(dados.cvv);
      setPlasticoBloqueado(false);
      setPlasticoVisivel(false);
      setPedindoSenha(false);
      setSenha("");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível desbloquear o plástico.");
    } finally {
      setDesbloqueando(false);
    }
  }

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;

    const saldoNum = parsear_valor_mascara(saldo);
    if (saldoNum == null || saldoNum < 0) {
      setErro("Informe um saldo válido.");
      return;
    }

    const podeEnviarPlastico = tipoEfetivo === "cartao" && !plasticoBloqueado;
    const algumPlastico = Boolean(numero.trim() || validade.trim() || cvv.trim());
    if (podeEnviarPlastico && algumPlastico) {
      if (!numero.trim() || !validade.trim() || !cvv.trim()) {
        setErro("Preencha número, validade e CVV juntos.");
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
        const limiteNum = parsear_valor_mascara(limite);
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
          podeEnviarPlastico && algumPlastico
            ? {
                numero: numero.replace(/\s/g, ""),
                validade: validade.trim(),
                cvv: cvv.trim(),
              }
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
      toast.sucesso(
        tipoEfetivo === "cartao"
          ? editando
            ? "Cartão atualizado."
            : "Cartão cadastrado."
          : editando
            ? "Conta atualizada."
            : "Conta cadastrada.",
      );
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const numeroExibido = plasticoBloqueado
    ? `•••• •••• •••• ${final4 ?? "••••"}`
    : numero;
  const validadeExibida = plasticoBloqueado ? "••/••" : validade;
  const cvvExibido = plasticoBloqueado ? "•••" : cvv;

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
            <CampoValor value={saldo} onChange={setSaldo} disabled={sincronizada} />
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
                <CampoValor value={limite} onChange={setLimite} disabled={sincronizada} />
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
                  <legend className="flex items-center gap-2 px-1 text-xs text-texto-suave">
                    Dados do plástico
                    {temPlasticoSalvo && plasticoBloqueado && (
                      <button
                        type="button"
                        onClick={() => {
                          setPedindoSenha(true);
                          setErro(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-borda px-1.5 py-0.5 text-[11px] text-texto hover:bg-superficie-alta"
                        title="Desbloquear com senha para ver e alterar"
                      >
                        <Lock size={12} />
                        Desbloquear
                      </button>
                    )}
                    {temPlasticoSalvo && !plasticoBloqueado && (
                      <button
                        type="button"
                        onClick={() => setPlasticoVisivel((v) => !v)}
                        className="inline-flex items-center gap-1 rounded-md border border-borda px-1.5 py-0.5 text-[11px] text-texto hover:bg-superficie-alta"
                        title={plasticoVisivel ? "Ocultar dados" : "Mostrar dados"}
                      >
                        {plasticoVisivel ? <EyeOff size={12} /> : <Eye size={12} />}
                        {plasticoVisivel ? "Ocultar" : "Mostrar"}
                      </button>
                    )}
                  </legend>

                  {plasticoBloqueado && (
                    <p className="text-[11px] text-texto-suave">
                      Dados ocultos. Use o cadeado e a senha da sua conta para ver e alterar.
                    </p>
                  )}

                  <label className="flex flex-col gap-1 text-xs text-texto-suave">
                    Número do cartão
                    <Campo
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={numeroExibido}
                      onChange={(e) => setNumero(formatar_numero_grupos(e.target.value))}
                      placeholder="0000 0000 0000 0000"
                      disabled={plasticoBloqueado}
                      type={!plasticoBloqueado && !plasticoVisivel && temPlasticoSalvo ? "password" : "text"}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-texto-suave">
                      Validade
                      <Campo
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        value={validadeExibida}
                        onChange={(e) => setValidade(formatar_validade_digitacao(e.target.value))}
                        placeholder="MM/AA"
                        maxLength={5}
                        disabled={plasticoBloqueado}
                        type={!plasticoBloqueado && !plasticoVisivel && temPlasticoSalvo ? "password" : "text"}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-texto-suave">
                      CVV
                      <Campo
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        value={cvvExibido}
                        onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="•••"
                        disabled={plasticoBloqueado}
                        type={!plasticoBloqueado && !plasticoVisivel && temPlasticoSalvo ? "password" : "text"}
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

      {pedindoSenha && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={(e) => void desbloquear_plastico(e)}
            className="w-full max-w-sm rounded-2xl border border-borda bg-superficie p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-texto">Senha da conta</h3>
              <button
                type="button"
                onClick={() => {
                  setPedindoSenha(false);
                  setSenha("");
                }}
                className="rounded-lg p-1 text-texto-suave hover:bg-superficie-alta"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-3 text-xs text-texto-suave">
              Digite a senha do Lançai para ver e editar número, validade e CVV.
            </p>
            <Campo
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha"
              autoFocus
              required
            />
            {erro && <p className="mt-2 text-sm text-despesa">{erro}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <Botao
                type="button"
                variante="fantasma"
                onClick={() => {
                  setPedindoSenha(false);
                  setSenha("");
                }}
              >
                Cancelar
              </Botao>
              <Botao type="submit" disabled={desbloqueando || !senha.trim()}>
                {desbloqueando ? "Validando..." : "Desbloquear"}
              </Botao>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
