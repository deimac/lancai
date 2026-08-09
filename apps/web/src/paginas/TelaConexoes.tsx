import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Link2, RefreshCw } from "lucide-react";
import {
  abrir_widget_conexao,
  ErroWidgetIndisponivel,
  provedor_tem_widget,
} from "@lancai/open-finance/web";
import type { WidgetAberto } from "@lancai/open-finance/web";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import {
  clienteApi,
  ErroApi,
  type CartaoResumo,
  type ConexaoComContas,
  type ConexaoDetalhada,
  type ContaExternaRegistrada,
  type ContaResumo,
  type DescritorFonte,
  type MotivoAtencao,
  type StatusConexao,
} from "../lib/api";
import { chave_dependencia } from "../lib/invalidacao-dados";
import { Botao } from "../componentes/ui/Botao";
import { Cartao } from "../componentes/ui/Cartao";
import { useContextoLayout } from "../layout/useContextoLayout";
import {
  texto_consentimento,
  texto_ultimo_lote,
  texto_ultimo_sync,
} from "../lib/observabilidade-sync";
import { unir_classes } from "../lib/unir-classes";

const ROTULO_STATUS: Record<StatusConexao, string> = {
  ativa: "Ativa",
  sincronizando: "Sincronizando",
  precisa_atencao: "Precisa de atenção",
  removida: "Removida",
};

const ROTULO_MOTIVO: Record<MotivoAtencao, string> = {
  credencial_invalida: "Credencial inválida — reconecte o banco",
  consentimento_revogado: "Consentimento revogado no app do banco",
  aguardando_usuario: "O banco está esperando uma ação sua",
  erro_no_provedor: "Erro temporário na sincronização",
};

function LinhaSync({ conexao }: { conexao: ConexaoDetalhada }) {
  const sync = texto_ultimo_sync(conexao.ultimoSyncEm);
  const lote = texto_ultimo_lote(conexao.ultimoResumoIngestao ?? null);
  const consentimento = texto_consentimento(conexao.consentimentoExpiraEm);
  const destacar =
    sync.atrasado && (conexao.status === "ativa" || conexao.status === "sincronizando");

  return (
    <>
      <p
        className={unir_classes(
          "mt-1 text-xs",
          destacar ? "text-aviso" : "text-texto-suave",
        )}
        title={
          destacar
            ? "Sem sync há mais de 36 h — em produção o banco costuma atualizar sozinho"
            : undefined
        }
      >
        {sync.linha}
      </p>
      {lote && <p className="mt-0.5 text-xs text-texto-suave">{lote}</p>}
      {consentimento && (
        <p className="mt-1 text-xs text-aviso">{consentimento}</p>
      )}
    </>
  );
}

function destino_associado(
  conta: ContaExternaRegistrada,
  contas: ContaResumo[],
  cartoes: CartaoResumo[],
): string | null {
  if (conta.contaId) {
    return contas.find((c) => c.id === conta.contaId)?.nome ?? "Conta local";
  }
  if (conta.cartaoId) {
    return cartoes.find((c) => c.id === conta.cartaoId)?.nome ?? "Cartão local";
  }
  return null;
}

export function TelaConexoes() {
  const { usuario } = useAutenticacao();
  const contexto = useContextoLayout();
  const [fonte, setFonte] = useState<DescritorFonte | null>(null);
  const [conexoes, setConexoes] = useState<ConexaoDetalhada[]>([]);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [visaoGeral, setVisaoGeral] = useState(false);
  const [detalhe, setDetalhe] = useState<ConexaoComContas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const widgetRef = useRef<WidgetAberto | null>(null);
  const depsDados = chave_dependencia(
    contexto?.versoes,
    "conexoes",
    "contas",
    "cartoes",
  );

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setCarregando(true);
    setErro(null);
    try {
      const [fonteCarregada, conexoesCarregadas, contasCarregadas, cartoesCarregados, workspaces] =
        await Promise.all([
          clienteApi.descrever_fonte(),
          clienteApi.listar_conexoes(usuario.id).catch((e: unknown) => {
            if (e instanceof ErroApi && e.status === 503) return [] as ConexaoDetalhada[];
            throw e;
          }),
          clienteApi.listar_contas(usuario.id),
          clienteApi.listar_cartoes(usuario.id),
          clienteApi.listar_workspaces(usuario.id).catch(() => []),
        ]);
      setFonte(fonteCarregada);
      setConexoes(conexoesCarregadas);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
      const ativo = workspaces.find((w) => w.ativo);
      setVisaoGeral(ativo?.id === "geral" || Boolean(ativo?.sintetico));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar as conexões.");
    } finally {
      setCarregando(false);
    }
  }, [usuario]);

  useEffect(() => {
    void carregar();
  }, [carregar, depsDados]);

  useEffect(() => {
    return () => {
      widgetRef.current?.fechar();
      widgetRef.current = null;
    };
  }, []);

  async function abrir_detalhe(conexaoId: string) {
    if (!usuario) return;
    setOcupado(true);
    setErro(null);
    try {
      setDetalhe(await clienteApi.detalhar_conexao(conexaoId, usuario.id));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir a conexão.");
    } finally {
      setOcupado(false);
    }
  }

  async function conectar_duble() {
    if (!usuario) return;
    setOcupado(true);
    setErro(null);
    try {
      const registrada = await clienteApi.criar_conexao_duble(usuario.id);
      setDetalhe(registrada);
      await carregar();
      contexto?.invalidar("conexoes");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível criar a conexão de mentira.");
    } finally {
      setOcupado(false);
    }
  }

  async function sincronizar_duble() {
    if (!usuario || !detalhe) return;
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      const resumo = await clienteApi.sincronizar_duble(detalhe.conexao.id, usuario.id);
      setDetalhe(await clienteApi.detalhar_conexao(detalhe.conexao.id, usuario.id));
      await carregar();
      contexto?.invalidar("conexoes", "extrato", "contas", "dashboard");
      if (resumo.criados === 0 && resumo.semDestino > 0) {
        setErro("Lote chegou, mas nenhuma conta está associada — associe antes de sincronizar.");
      } else {
        setOk(texto_ultimo_lote(resumo) ?? "Lote sincronizado.");
      }
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível sincronizar o lote de mentira.");
    } finally {
      setOcupado(false);
    }
  }

  async function atualizar_agora(conexaoId: string) {
    if (!usuario) return;
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      const atualizado = await clienteApi.atualizar_conexao(conexaoId, usuario.id);
      if (detalhe?.conexao.id === conexaoId) setDetalhe(atualizado);
      await carregar();
      contexto?.invalidar("conexoes");
      setOk("Atualização pedida ao banco. O extrato chega em instantes pelo webhook.");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível pedir a atualização.");
    } finally {
      setOcupado(false);
    }
  }

  async function conectar(conexaoParaReconectar?: ConexaoDetalhada) {
    if (!usuario || !fonte?.disponivel || !fonte.id) return;

    if (fonte.id === "duble") {
      await conectar_duble();
      return;
    }

    if (!provedor_tem_widget(fonte.id)) {
      setErro(
        "A fonte ativa não tem tela de conexão no navegador. " +
          "Troque OPEN_FINANCE_PROVEDOR por um provedor real para conectar um banco.",
      );
      return;
    }

    setOcupado(true);
    setErro(null);

    try {
      const { token } = await clienteApi.criar_token_conexao({
        usuarioId: usuario.id,
        conexaoId: conexaoParaReconectar?.id,
      });

      widgetRef.current?.fechar();
      widgetRef.current = await abrir_widget_conexao(fonte.id, {
        token,
        incluirSandbox: import.meta.env.DEV,
        conexaoExterna: conexaoParaReconectar?.idExterno,
        aoConcluir: (conexaoExterna) => {
          void (async () => {
            try {
              const registrada = await clienteApi.registrar_conexao({
                usuarioId: usuario.id,
                conexaoExterna,
              });
              setDetalhe(registrada);
              await carregar();
              contexto?.invalidar("conexoes");
            } catch (e) {
              setErro(
                e instanceof ErroApi
                  ? e.message
                  : "O banco conectou, mas não consegui gravar a conexão.",
              );
            } finally {
              setOcupado(false);
              widgetRef.current = null;
            }
          })();
        },
        aoFalhar: (mensagem) => {
          setErro(mensagem);
          setOcupado(false);
          widgetRef.current = null;
        },
        aoFechar: () => {
          setOcupado(false);
          widgetRef.current = null;
        },
      });
    } catch (e) {
      setErro(
        e instanceof ErroWidgetIndisponivel || e instanceof ErroApi
          ? e.message
          : "Não foi possível abrir a conexão com o banco.",
      );
      setOcupado(false);
    }
  }

  async function associar(contaExterna: ContaExternaRegistrada, destino: string) {
    if (!usuario || !detalhe || !destino) return;

    const [tipo, id] = destino.split(":");
    if ((tipo !== "conta" && tipo !== "cartao") || !id) return;

    const confirmado = window.confirm(
      "Ao associar, esta conta passa a receber só o extrato do banco. " +
        "Lançamento manual, correção e cancelamento ficam bloqueados em qualquer canal. Continuar?",
    );
    if (!confirmado) return;

    setOcupado(true);
    setErro(null);
    try {
      const atualizado = await clienteApi.associar_conta_externa({
        conexaoId: detalhe.conexao.id,
        contaExternaId: contaExterna.contaExternaId,
        usuarioId: usuario.id,
        contaId: tipo === "conta" ? id : undefined,
        cartaoId: tipo === "cartao" ? id : undefined,
      });
      setDetalhe(atualizado);
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível associar a conta.");
    } finally {
      setOcupado(false);
    }
  }

  async function desassociar(contaExterna: ContaExternaRegistrada) {
    if (!usuario || !detalhe) return;

    const confirmado = window.confirm(
      "Desassociar devolve a conta ao uso manual, mas o que já veio do banco continua imutável. Continuar?",
    );
    if (!confirmado) return;

    setOcupado(true);
    setErro(null);
    try {
      const atualizado = await clienteApi.desassociar_conta_externa({
        conexaoId: detalhe.conexao.id,
        contaExternaId: contaExterna.contaExternaId,
        usuarioId: usuario.id,
      });
      setDetalhe(atualizado);
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes", "dashboard");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível desassociar a conta.");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar(conexaoId: string) {
    if (!usuario) return;
    const confirmado = window.confirm(
      "Desconectar a instituição? Contas, cartões e histórico permanecem; a sincronização para.",
    );
    if (!confirmado) return;

    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      await clienteApi.desconectar_conexao(conexaoId, usuario.id);
      setDetalhe(null);
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes", "dashboard");
      setOk("Instituição desconectada. O histórico financeiro foi preservado.");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível desconectar.");
    } finally {
      setOcupado(false);
    }
  }

  if (!usuario) {
    return (
      <div className="flex h-full items-center justify-center text-texto-suave">Carregando...</div>
    );
  }

  const fonteDisponivel = Boolean(fonte?.disponivel && fonte.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-texto">Conexões bancárias</h1>
          <p className="text-sm text-texto-suave">
            {visaoGeral
              ? "Todos os workspaces — escolha um workspace para conectar banco"
              : !fonteDisponivel
                ? "Fonte desligada neste ambiente"
                : fonte?.id === "duble"
                  ? "Dublê ativo: conecte um banco de mentira e sincronize um lote de teste"
                  : "Ao conectar, o LancAI cria contas e cartões neste workspace"}
          </p>
        </div>
        <Botao
          onClick={() => void conectar()}
          disabled={visaoGeral || !fonteDisponivel || ocupado}
          title={
            visaoGeral
              ? "Escolha um workspace para cadastrar"
              : !fonteDisponivel
                ? "Fonte Open Finance desligada"
                : undefined
          }
        >
          <Link2 size={14} />
          {fonte?.id === "duble" ? "Conectar banco de mentira" : "Conectar banco"}
        </Botao>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}
      {ok && (
        <div className="rounded-lg border border-primaria/40 bg-primaria/10 px-3 py-2 text-sm text-texto">
          {ok}
        </div>
      )}

      {carregando ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : detalhe ? (
        <DetalheConexao
          detalhe={detalhe}
          contas={contas}
          cartoes={cartoes}
          ocupado={ocupado}
          duble={fonte?.id === "duble"}
          aoVoltar={() => setDetalhe(null)}
          aoReconectar={() => void conectar(detalhe.conexao)}
          aoAtualizar={() => void atualizar_agora(detalhe.conexao.id)}
          aoSincronizarDuble={() => void sincronizar_duble()}
          aoAssociar={associar}
          aoDesassociar={desassociar}
          aoDesconectar={() => void desconectar(detalhe.conexao.id)}
        />
      ) : (
        <ListaConexoes
          conexoes={conexoes}
          ocupado={ocupado}
          mostrarAtualizar={fonte?.id !== "duble"}
          aoAbrir={(id) => void abrir_detalhe(id)}
          aoReconectar={(conexao) => void conectar(conexao)}
          aoAtualizar={(id) => void atualizar_agora(id)}
          aoDesconectar={(id) => void desconectar(id)}
        />
      )}
    </div>
  );
}

function ListaConexoes({
  conexoes,
  ocupado,
  mostrarAtualizar,
  aoAbrir,
  aoReconectar,
  aoAtualizar,
  aoDesconectar,
}: {
  conexoes: ConexaoDetalhada[];
  ocupado: boolean;
  mostrarAtualizar: boolean;
  aoAbrir: (id: string) => void;
  aoReconectar: (conexao: ConexaoDetalhada) => void;
  aoAtualizar: (id: string) => void;
  aoDesconectar: (id: string) => void;
}) {
  if (conexoes.length === 0) {
    return (
      <Cartao>
        <p className="text-sm text-texto">Nenhum banco conectado ainda.</p>
        <p className="mt-1 text-xs text-texto-suave">
          Conecte uma instituição — contas e cartões são criados neste workspace automaticamente.
        </p>
      </Cartao>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {conexoes.map((conexao) => (
        <li key={conexao.id}>
          <Cartao className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-texto">
                {conexao.instituicao ?? "Instituição conectada"}
              </p>
              <p className="mt-1 text-xs text-texto-suave">
                {ROTULO_STATUS[conexao.status]}
                {conexao.motivoAtencao ? ` · ${ROTULO_MOTIVO[conexao.motivoAtencao]}` : ""}
              </p>
              <LinhaSync conexao={conexao} />
            </div>
            <div className="flex flex-wrap gap-2">
              {mostrarAtualizar && conexao.status !== "removida" && (
                <Botao
                  variante="fantasma"
                  disabled={ocupado || conexao.status === "sincronizando"}
                  onClick={() => aoAtualizar(conexao.id)}
                  title="Pede ao banco um sync agora; o extrato chega pelo webhook"
                >
                  <RefreshCw size={14} />
                  Atualizar agora
                </Botao>
              )}
              {conexao.status === "precisa_atencao" && (
                <Botao
                  variante="fantasma"
                  disabled={ocupado}
                  onClick={() => aoReconectar(conexao)}
                >
                  <RefreshCw size={14} />
                  Reconectar
                </Botao>
              )}
              <Botao variante="fantasma" disabled={ocupado} onClick={() => aoAbrir(conexao.id)}>
                Contas
              </Botao>
              {conexao.status !== "removida" && (
                <Botao
                  variante="fantasma"
                  disabled={ocupado}
                  onClick={() => aoDesconectar(conexao.id)}
                >
                  Desconectar
                </Botao>
              )}
            </div>
          </Cartao>
        </li>
      ))}
    </ul>
  );
}

function DetalheConexao({
  detalhe,
  contas,
  cartoes,
  ocupado,
  duble,
  aoVoltar,
  aoReconectar,
  aoAtualizar,
  aoSincronizarDuble,
  aoAssociar,
  aoDesassociar,
  aoDesconectar,
}: {
  detalhe: ConexaoComContas;
  contas: ContaResumo[];
  cartoes: CartaoResumo[];
  ocupado: boolean;
  duble: boolean;
  aoVoltar: () => void;
  aoReconectar: () => void;
  aoAtualizar: () => void;
  aoSincronizarDuble: () => void;
  aoAssociar: (conta: ContaExternaRegistrada, destino: string) => void;
  aoDesassociar: (conta: ContaExternaRegistrada) => void;
  aoDesconectar: () => void;
}) {
  const { conexao } = detalhe;
  const semDestinoLocal = contas.length === 0 && cartoes.length === 0;
  const temAssociacao = detalhe.contas.some((c) => c.contaId || c.cartaoId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Botao variante="fantasma" onClick={aoVoltar}>
          <ArrowLeft size={14} />
          Todas as conexões
        </Botao>
        <div className="flex flex-wrap gap-2">
          {duble && (
            <Botao
              variante="fantasma"
              disabled={ocupado || !temAssociacao}
              onClick={aoSincronizarDuble}
              title={
                temAssociacao
                  ? "Seméia um lote de teste e grava no extrato"
                  : "Associe uma conta antes de sincronizar"
              }
            >
              <RefreshCw size={14} />
              Sincronizar lote de mentira
            </Botao>
          )}
          {!duble && conexao.status !== "removida" && (
            <Botao
              variante="fantasma"
              disabled={ocupado || conexao.status === "sincronizando"}
              onClick={aoAtualizar}
              title="Pede ao banco um sync agora; o extrato chega pelo webhook"
            >
              <RefreshCw size={14} />
              Atualizar agora
            </Botao>
          )}
          {conexao.status === "precisa_atencao" && (
            <Botao variante="fantasma" disabled={ocupado} onClick={aoReconectar}>
              <RefreshCw size={14} />
              Reconectar
            </Botao>
          )}
          {conexao.status !== "removida" && (
            <Botao variante="fantasma" disabled={ocupado} onClick={aoDesconectar}>
              Desconectar
            </Botao>
          )}
        </div>
      </div>

      <Cartao>
        <p className="text-sm font-medium text-texto">
          {conexao.instituicao ?? "Instituição conectada"}
        </p>
        <p className="mt-1 text-xs text-texto-suave">
          {ROTULO_STATUS[conexao.status]}
          {conexao.motivoAtencao ? ` · ${ROTULO_MOTIVO[conexao.motivoAtencao]}` : ""}
        </p>
        <LinhaSync conexao={conexao} />
      </Cartao>

      {semDestinoLocal && (
        <p className="text-xs text-texto-suave">
          Nenhum recurso materializado ainda. Reconecte o banco ou volte a Contas
          para conectar de novo.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {detalhe.contas.map((contaExterna) => {
          const associado = destino_associado(contaExterna, contas, cartoes);
          return (
            <li key={contaExterna.contaExternaId}>
              <Cartao className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium text-texto">{contaExterna.nome}</p>
                  <p className="text-xs text-texto-suave">{contaExterna.tipo}</p>
                </div>

                {associado ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-texto-suave">Associada a {associado}</p>
                    <Botao
                      variante="fantasma"
                      disabled={ocupado}
                      onClick={() => aoDesassociar(contaExterna)}
                    >
                      Desassociar
                    </Botao>
                  </div>
                ) : (
                  <label className="flex flex-col gap-1 text-xs text-texto-suave">
                    Associar a
                    <select
                      className="rounded-lg border border-borda bg-superficie-alta px-3 py-2 text-sm text-texto disabled:opacity-50"
                      disabled={ocupado || semDestinoLocal}
                      defaultValue=""
                      onChange={(evento) => {
                        const valor = evento.target.value;
                        if (!valor) return;
                        aoAssociar(contaExterna, valor);
                        evento.target.value = "";
                      }}
                    >
                      <option value="" disabled>
                        Escolha uma conta ou cartão
                      </option>
                      {contas.map((conta) => (
                        <option key={conta.id} value={`conta:${conta.id}`}>
                          Conta · {conta.nome}
                        </option>
                      ))}
                      {cartoes.map((cartao) => (
                        <option key={cartao.id} value={`cartao:${cartao.id}`}>
                          Cartão · {cartao.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </Cartao>
            </li>
          );
        })}
      </ul>

      {detalhe.contas.length === 0 && (
        <Cartao>
          <p className="text-sm text-texto-suave">
            Nenhuma conta encontrada nesta conexão ainda. O extrato costuma chegar após o
            primeiro sync.
          </p>
        </Cartao>
      )}
    </div>
  );
}
