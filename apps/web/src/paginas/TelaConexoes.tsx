import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Link2, Plus, RefreshCw } from "lucide-react";
import {
  abrir_widget_conexao,
  ErroWidgetIndisponivel,
  provedor_tem_widget,
} from "@lancai/open-finance/web";
import type { WidgetAberto } from "@lancai/open-finance/web";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useConfirmacao } from "../contexto/ContextoConfirmacao";
import { useToast } from "../contexto/ContextoToast";
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
  type MovimentoResumo,
  type ProgressoImportacaoApi,
  type StatusConexao,
} from "../lib/api";
import { formatar_data_curta, formatar_moeda } from "../lib/formatar";
import { chave_dependencia } from "../lib/invalidacao-dados";
import {
  BarraProgressoImportacao,
  type ProgressoImportacaoUi,
} from "../componentes/BarraProgressoImportacao";
import { Botao } from "../componentes/ui/Botao";
import { Cartao } from "../componentes/ui/Cartao";
import { useContextoLayout } from "../layout/useContextoLayout";
import {
  texto_consentimento,
  texto_ultimo_lote,
  texto_ultimo_sync,
} from "../lib/observabilidade-sync";
import { unir_classes } from "../lib/unir-classes";

function eh_cartao_externo(tipo: string): boolean {
  const n = tipo.trim().toUpperCase();
  return (
    n.includes("CREDIT_CARD") ||
    n === "CREDIT" ||
    n.includes("CARTAO") ||
    n.includes("CARTÃO")
  );
}

function contar_recursos(contas: ContaExternaRegistrada[]) {
  let cartoes = 0;
  let contasCorrentes = 0;
  for (const c of contas) {
    if (eh_cartao_externo(c.tipo)) cartoes += 1;
    else contasCorrentes += 1;
  }
  return { contas: contasCorrentes, cartoes };
}

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
  const toast = useToast();
  const { confirmar } = useConfirmacao();
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
  /** Atalho de teste Meu Pluggy: colar itemId sem abrir o widget. */
  const [itemIdManual, setItemIdManual] = useState("");
  const [progressoImportacao, setProgressoImportacao] = useState<ProgressoImportacaoUi | null>(
    null,
  );
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
    try {
      const resumo = await clienteApi.sincronizar_duble(detalhe.conexao.id, usuario.id);
      setDetalhe(await clienteApi.detalhar_conexao(detalhe.conexao.id, usuario.id));
      await carregar();
      contexto?.invalidar("conexoes", "extrato", "contas", "dashboard");
      if (resumo.criados === 0 && resumo.semDestino > 0) {
        toast.erro("Lote chegou, mas nenhuma conta está associada — associe antes de sincronizar.");
      } else {
        toast.sucesso(texto_ultimo_lote(resumo) ?? "Lote sincronizado.");
      }
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível sincronizar o lote de mentira.");
    } finally {
      setOcupado(false);
    }
  }

  async function registrar_item_manual() {
    if (!usuario) return;
    const itemId = itemIdManual.trim();
    if (!itemId) {
      setErro("Informe o itemId da Pluggy / Meu Pluggy.");
      return;
    }
    // Um ID por vez — como conectar um banco; espaços/quebras indicam cola acidental.
    if (/\s/.test(itemId) || itemId.includes(",")) {
      setErro("Informe um único itemId por vez. Salve, depois registre o próximo.");
      return;
    }
    setOcupado(true);
    setErro(null);
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
      setDetalhe(null);
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes", "extrato");
      const nome = registrada.conexao.instituicao ?? "Conexão";
      if (importou) {
        toast.sucesso(
          `${nome} salva. Saldos e extrato importados. Pode registrar outro itemId.`,
        );
      }
    } catch (e) {
      setErro(
        e instanceof ErroApi
          ? e.message
          : "Não foi possível registrar o itemId. Confira se a Application enxerga esse item.",
      );
    } finally {
      setOcupado(false);
      setProgressoImportacao(null);
    }
  }

  async function atualizar_agora(conexaoId: string) {
    if (!usuario) return;
    setOcupado(true);
    setErro(null);
    setProgressoImportacao({ percentual: 2, mensagem: "Atualizando saldos…" });
    let criados = 0;
    try {
      const atualizado = await clienteApi.atualizar_conexao(
        conexaoId,
        usuario.id,
        (p: ProgressoImportacaoApi) => {
          if (typeof p.criados === "number") criados = p.criados;
          setProgressoImportacao({
            percentual: p.percentual,
            mensagem: p.mensagem,
            criados: p.criados,
          });
        },
      );
      if (detalhe?.conexao.id === conexaoId) setDetalhe(atualizado);
      await carregar();
      contexto?.invalidar("conexoes");
      contexto?.invalidar("conexoes", "extrato");
      toast.sucesso(
        criados > 0
          ? `Extrato importado: ${criados} lançamento(s) novo(s).`
          : "Saldos e extrato conferidos com o banco (nada novo).",
      );
    } catch (e) {
      const mensagem =
        e instanceof ErroApi
          ? e.message
          : e instanceof Error
            ? e.message
            : "Não foi possível importar o extrato agora.";
      toast.erro(mensagem);
    } finally {
      setOcupado(false);
      setProgressoImportacao(null);
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
              contexto?.invalidar("conexoes", "contas", "cartoes");
              toast.sucesso("Conexão realizada. Contas e cartões foram recuperados.");
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

    const confirmado = await confirmar({
      titulo: "Associar conta ao banco?",
      mensagem:
        "Ao associar, esta conta passa a receber só o extrato do banco. " +
        "Lançamento manual, correção e cancelamento ficam bloqueados em qualquer canal.",
      confirmarRotulo: "Associar",
      perigo: false,
    });
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

    const confirmado = await confirmar({
      titulo: "Desassociar conta?",
      mensagem:
        "Desassociar devolve a conta ao uso manual, mas o que já veio do banco continua imutável.",
      confirmarRotulo: "Desassociar",
      perigo: false,
    });
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
    const confirmado = await confirmar({
      titulo: "Desconectar instituição?",
      mensagem:
        "Contas, cartões e histórico permanecem; a sincronização com o banco é encerrada.",
      confirmarRotulo: "Desconectar",
    });
    if (!confirmado) return;

    setOcupado(true);
    setErro(null);
    try {
      await clienteApi.desconectar_conexao(conexaoId, usuario.id);
      setDetalhe(null);
      await carregar();
      contexto?.invalidar("conexoes", "contas", "cartoes", "dashboard");
      toast.sucesso("Instituição desconectada. O histórico financeiro foi preservado.");
    } catch (e) {
      toast.erro(e instanceof ErroApi ? e.message : "Não foi possível desconectar.");
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
          {fonte?.id === "duble" ? <Link2 size={14} /> : <Plus size={14} />}
          {fonte?.id === "duble" ? "Conectar banco de mentira" : "Conectar conta ou cartão"}
        </Botao>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}

      {fonte?.id === "pluggy" && !visaoGeral && !detalhe && (
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
              {ocupado && progressoImportacao ? "Importando…" : "Salvar conexão"}
            </Botao>
          </div>
          <BarraProgressoImportacao progresso={progressoImportacao} />
        </Cartao>
      )}

      {progressoImportacao && (detalhe || fonte?.id !== "pluggy" || visaoGeral) && (
        <Cartao>
          <BarraProgressoImportacao progresso={progressoImportacao} />
        </Cartao>
      )}

      {carregando ? (
        <p className="text-sm text-texto-suave">Carregando...</p>
      ) : detalhe ? (
        <DetalheConexao
          usuarioId={usuario.id}
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
  usuarioId,
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
  usuarioId: string;
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
  const contagem = contar_recursos(detalhe.contas);
  const [transacoes, setTransacoes] = useState<MovimentoResumo[]>([]);
  const [carregandoTx, setCarregandoTx] = useState(false);

  const idsConta = useMemo(() => {
    const ids = new Set(
      detalhe.contas.map((c) => c.contaId).filter((id): id is string => Boolean(id)),
    );
    for (const c of contas) {
      if (c.conexaoId === conexao.id) ids.add(c.id);
    }
    return ids;
  }, [contas, conexao.id, detalhe.contas]);

  const idsCartao = useMemo(() => {
    const ids = new Set(
      detalhe.contas.map((c) => c.cartaoId).filter((id): id is string => Boolean(id)),
    );
    for (const c of cartoes) {
      if (c.conexaoId === conexao.id) ids.add(c.id);
    }
    return ids;
  }, [cartoes, conexao.id, detalhe.contas]);

  useEffect(() => {
    let cancelado = false;
    setCarregandoTx(true);
    void clienteApi
      .listar_movimentos(usuarioId)
      .then((lista) => {
        if (cancelado) return;
        const filtrados = lista
          .filter(
            (m) =>
              m.fonte === "open_finance" &&
              ((m.contaId && idsConta.has(m.contaId)) ||
                (m.cartaoId && idsCartao.has(m.cartaoId))),
          )
          .slice(0, 20);
        setTransacoes(filtrados);
      })
      .catch(() => {
        if (!cancelado) setTransacoes([]);
      })
      .finally(() => {
        if (!cancelado) setCarregandoTx(false);
      });
    return () => {
      cancelado = true;
    };
  }, [usuarioId, conexao.id, conexao.ultimoSyncEm, idsConta, idsCartao]);

  function nome_origem(m: MovimentoResumo): string {
    if (m.contaId) return contas.find((c) => c.id === m.contaId)?.nome ?? "Conta";
    if (m.cartaoId) return cartoes.find((c) => c.id === m.cartaoId)?.nome ?? "Cartão";
    return "—";
  }

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
        <p className="text-sm font-semibold text-texto">Conexão realizada</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-texto-suave">Instituição</dt>
            <dd className="font-medium text-texto">
              {conexao.instituicao ?? "Instituição conectada"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Status</dt>
            <dd className="font-medium text-texto">
              {ROTULO_STATUS[conexao.status]}
              {conexao.motivoAtencao ? ` · ${ROTULO_MOTIVO[conexao.motivoAtencao]}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Contas encontradas</dt>
            <dd className="font-medium text-texto">{contagem.contas}</dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Cartões encontrados</dt>
            <dd className="font-medium text-texto">{contagem.cartoes}</dd>
          </div>
        </dl>
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

      <Cartao>
        <p className="text-sm font-semibold text-texto">Transações recentes</p>
        <p className="mt-1 text-xs text-texto-suave">
          Fonte externa (Open Finance). Use &quot;Atualizar agora&quot; para pedir sync ao banco.
        </p>
        {carregandoTx ? (
          <p className="mt-3 text-sm text-texto-suave">Carregando transações...</p>
        ) : transacoes.length === 0 ? (
          <p className="mt-3 text-sm text-texto-suave">
            Nenhuma transação ingerida ainda para esta conexão.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {transacoes.map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-0.5 border-t border-borda/60 pt-2 text-sm first:border-t-0 first:pt-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-texto">
                    {m.descricaoFonte || m.descricao}
                  </span>
                  <span
                    className={unir_classes(
                      "tabular-nums",
                      m.tipo === "receita" ? "text-sucesso" : "text-texto",
                    )}
                  >
                    {m.tipo === "despesa" ? "−" : "+"}
                    {formatar_moeda(Number(m.valor))}
                  </span>
                </div>
                <p className="text-xs text-texto-suave">
                  {formatar_data_curta(m.dataMovimento)} · {m.tipo} · {nome_origem(m)}
                  {m.idExterno ? ` · ${m.idExterno}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
