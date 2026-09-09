import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi, type ConflitoAlocacaoFatura } from "../lib/api";
import { formatar_moeda } from "../lib/formatar";
import { Botao } from "./ui/Botao";
import { Campo } from "./ui/Campo";
import { unir_classes } from "../lib/unir-classes";

function competencia_inicial(item: ConflitoAlocacaoFatura): string {
    const origem = item.conflitoDadosOrigem;
    if (origem && typeof origem === "object" && "decisaoNova" in origem) {
        const decisao = origem.decisaoNova;
        if (decisao && typeof decisao === "object" && "competencia" in decisao) {
            const competencia = decisao.competencia;
            if (typeof competencia === "string" && /^\d{4}-\d{2}$/.test(competencia)) return competencia;
        }
    }
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

export function PainelConflitosFatura({ dependencia }: { dependencia?: unknown }) {
    const { usuario } = useAutenticacao();
    const [itens, setItens] = useState<ConflitoAlocacaoFatura[]>([]);
    const [competencias, setCompetencias] = useState<Record<string, string>>({});
    const [carregando, setCarregando] = useState(true);
    const [resolvendo, setResolvendo] = useState<string | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    const carregar = useCallback(async () => {
        if (!usuario) return;
        setCarregando(true);
        setErro(null);
        try {
            const conflitos = await clienteApi.listar_conflitos_alocacao_fatura(usuario.id);
            setItens(conflitos);
            setCompetencias((anteriores) => {
                const proximas = { ...anteriores };
                for (const item of conflitos) proximas[item.movimentoId] ??= competencia_inicial(item);
                return proximas;
            });
        } catch (e) {
            setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar os conflitos de fatura.");
        } finally {
            setCarregando(false);
        }
    }, [usuario]);

    useEffect(() => {
        void carregar();
    }, [carregar, dependencia]);

    async function resolver(item: ConflitoAlocacaoFatura) {
        if (!usuario) return;
        const competencia = competencias[item.movimentoId] ?? "";
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
            setErro("Informe uma competência válida no formato AAAA-MM.");
            return;
        }

        setResolvendo(item.movimentoId);
        setErro(null);
        try {
            await clienteApi.resolver_alocacao_fatura(item.movimentoId, {
                usuarioId: usuario.id,
                competencia,
            });
            setItens((atuais) => atuais.filter((atual) => atual.movimentoId !== item.movimentoId));
        } catch (e) {
            setErro(e instanceof ErroApi ? e.message : "Não foi possível resolver o conflito.");
        } finally {
            setResolvendo(null);
        }
    }

    if (carregando || itens.length === 0) return null;

    return (
        <section className="rounded-2xl border border-aviso/40 bg-aviso/10 p-4 shadow-sm shadow-black/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-aviso" />
                    <div>
                        <h2 className="text-sm font-semibold text-texto">Alocações de fatura pendentes</h2>
                        <p className="mt-1 text-xs text-texto-suave">
                            O provedor apontou faturas diferentes para estes lançamentos. Escolha a competência correta para registrar a decisão.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void carregar()}
                    className="rounded-lg p-2 text-texto-suave hover:bg-aviso/10 hover:text-texto"
                    title="Atualizar conflitos"
                >
                    <RefreshCw size={15} />
                </button>
            </div>

            {erro ? <p className="mt-3 text-sm text-perigo">{erro}</p> : null}

            <div className="mt-4 grid gap-3">
                {itens.map((item) => {
                    const competencia = competencias[item.movimentoId] ?? competencia_inicial(item);
                    const ocupado = resolvendo === item.movimentoId;
                    return (
                        <div key={item.movimentoId} className="rounded-xl border border-borda bg-superficie/80 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-texto">{item.descricao}</p>
                                    <p className="mt-1 text-xs text-texto-suave">
                                        {item.cartaoNome} · {item.dataMovimento.slice(0, 10)} · {formatar_moeda(Number(item.valor))}
                                    </p>
                                    <p className="mt-1 text-xs text-texto-suave">
                                        Bill atual do provedor: <span className="font-mono text-texto">{item.providerBillId ?? "não informado"}</span>
                                    </p>
                                </div>
                                <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
                                    <label className="min-w-32 text-xs text-texto-suave">
                                        Competência
                                        <Campo
                                            type="month"
                                            value={competencia}
                                            onChange={(evento) =>
                                                setCompetencias((atuais) => ({ ...atuais, [item.movimentoId]: evento.target.value }))
                                            }
                                            className="mt-1"
                                        />
                                    </label>
                                    <Botao
                                        type="button"
                                        onClick={() => void resolver(item)}
                                        disabled={ocupado}
                                        className="h-10 px-3"
                                        title="Resolver conflito"
                                    >
                                        <Check size={15} />
                                        {ocupado ? "Salvando..." : "Resolver"}
                                    </Botao>
                                </div>
                            </div>
                            {item.conflitoMotivo ? (
                                <p className={unir_classes("mt-2 text-xs", "text-aviso")}>
                                    {item.conflitoMotivo}
                                </p>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
