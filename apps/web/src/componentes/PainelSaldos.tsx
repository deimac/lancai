import { formatarMoeda } from "@lancai/tipos";
import { Cartao } from "./ui/Cartao";
import type { CartaoResumo, ContaResumo } from "../lib/api";

interface PropsPainelSaldos {
  contas: ContaResumo[];
  cartoes: CartaoResumo[];
  carregando: boolean;
}

function RotuloPerfil({ perfil }: { perfil: "pf" | "pj" }) {
  return (
    <span
      className={
        perfil === "pj"
          ? "rounded-full bg-superficie-alta px-2 py-0.5 text-[11px] font-medium text-texto-suave"
          : "rounded-full bg-superficie-alta px-2 py-0.5 text-[11px] font-medium text-primaria"
      }
    >
      {perfil === "pj" ? "Empresa" : "Pessoal"}
    </span>
  );
}

function rotulo_modalidade(modalidade: CartaoResumo["modalidade"]): string {
  if (modalidade === "debito") return "débito";
  if (modalidade === "multiplo") return "múltiplo";
  return "crédito";
}

export function PainelSaldos({ contas, cartoes, carregando }: PropsPainelSaldos) {
  const totalContas = contas.reduce((total, conta) => total + Number(conta.saldoAtual), 0);

  return (
    <div className="flex flex-col gap-4">
      <Cartao>
        <p className="text-xs text-texto-suave">Saldo total em contas</p>
        <p className="mt-1 text-2xl font-semibold text-texto">{formatarMoeda(totalContas)}</p>
      </Cartao>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-texto-suave">Contas</h3>
        <div className="flex flex-col gap-2">
          {carregando && <p className="text-sm text-texto-suave">Carregando...</p>}
          {!carregando && contas.length === 0 && (
            <p className="text-sm text-texto-suave">Nenhuma conta cadastrada ainda.</p>
          )}
          {contas.map((conta) => (
            <Cartao key={conta.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-texto">{conta.nome}</span>
                <RotuloPerfil perfil={conta.perfil} />
              </div>
              <span className="text-sm font-medium text-texto">{formatarMoeda(conta.saldoAtual)}</span>
            </Cartao>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-texto-suave">Cartões</h3>
        <div className="flex flex-col gap-2">
          {!carregando && cartoes.length === 0 && (
            <p className="text-sm text-texto-suave">Nenhum cartão cadastrado ainda.</p>
          )}
          {cartoes.map((cartao) => (
            <Cartao key={cartao.id} className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-texto">{cartao.nome}</span>
                  <RotuloPerfil perfil={cartao.perfil} />
                  <span className="text-[11px] text-texto-suave">{rotulo_modalidade(cartao.modalidade)}</span>
                </div>
                {cartao.final4 ? (
                  <span className="text-xs text-texto-suave">•••• {cartao.final4}</span>
                ) : null}
              </div>
              <span className="text-xs text-texto-suave">
                {cartao.modalidade === "debito" ? "débito" : `vence dia ${cartao.vencimento}`}
              </span>
            </Cartao>
          ))}
        </div>
      </div>
    </div>
  );
}
