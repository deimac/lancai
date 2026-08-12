import { abrir_widget_conexao, ErroWidgetIndisponivel, provedor_tem_widget } from "@lancai/open-finance/web";
import { clienteApi, ErroApi, type DescritorFonte } from "./api";

type WidgetHandle = { fechar: () => void } | null;

/**
 * Abre Pluggy Connect (ou dublê) e registra a conexão no workspace ativo.
 * Contas/cartões locais são materializados pelo backend após o registro.
 */
export async function conectar_banco(entrada: {
  usuarioId: string;
  fonte: DescritorFonte;
  widgetRef: { current: WidgetHandle };
  /** ID interno LançAI — token com itemId para reconexão. */
  conexaoId?: string;
  /** itemId Pluggy — abre widget em modo updateItem. */
  conexaoExterna?: string;
  aoSucesso: () => void | Promise<void>;
  aoErro: (mensagem: string) => void;
  aoOcupado: (ocupado: boolean) => void;
}): Promise<void> {
  const { usuarioId, fonte, widgetRef, conexaoId, conexaoExterna, aoSucesso, aoErro, aoOcupado } =
    entrada;

  if (!fonte.disponivel || !fonte.id) {
    aoErro("Open Finance não está disponível neste ambiente.");
    return;
  }

  if (fonte.id === "duble") {
    aoOcupado(true);
    try {
      await clienteApi.criar_conexao_duble(usuarioId);
      await aoSucesso();
    } catch (e) {
      aoErro(e instanceof ErroApi ? e.message : "Não foi possível criar a conexão de teste.");
    } finally {
      aoOcupado(false);
    }
    return;
  }

  if (!provedor_tem_widget(fonte.id)) {
    aoErro(
      "A fonte ativa não tem tela de conexão no navegador. " +
        "Troque OPEN_FINANCE_PROVEDOR por um provedor real para conectar um banco.",
    );
    return;
  }

  aoOcupado(true);
  try {
    const { token } = await clienteApi.criar_token_conexao({ usuarioId, conexaoId });
    widgetRef.current?.fechar();
    widgetRef.current = await abrir_widget_conexao(fonte.id, {
      token,
      incluirSandbox: import.meta.env.DEV,
      conexaoExterna,
      aoConcluir: (itemId) => {
        void (async () => {
          try {
            await clienteApi.registrar_conexao({ usuarioId, conexaoExterna: itemId });
            await aoSucesso();
          } catch (e) {
            aoErro(
              e instanceof ErroApi
                ? e.message
                : "O banco conectou, mas não consegui gravar a conexão.",
            );
          } finally {
            aoOcupado(false);
            widgetRef.current = null;
          }
        })();
      },
      aoFalhar: (mensagem) => {
        aoErro(mensagem);
        aoOcupado(false);
        widgetRef.current = null;
      },
      aoFechar: () => {
        aoOcupado(false);
        widgetRef.current = null;
      },
    });
  } catch (e) {
    aoErro(
      e instanceof ErroWidgetIndisponivel || e instanceof ErroApi
        ? e.message
        : "Não foi possível abrir a conexão com o banco.",
    );
    aoOcupado(false);
  }
}
