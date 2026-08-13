import type { LancadorDeWidget } from "./widget";

function mensagem_erro_connect(erro: {
  message?: string;
  data?: {
    item?: {
      executionStatus?: string;
      error?: { code?: string | null; message?: string | null } | null;
      connector?: { name?: string | null } | null;
    };
  };
}): string {
  const item = erro.data?.item;
  const nome = item?.connector?.name ?? "";
  if (/meu\s*pluggy/i.test(nome)) {
    return (
      "Meu Pluggy não se conecta por este widget. Abra meu.pluggy.ai, " +
      "conecte o banco e use Reconectar com o itemId."
    );
  }
  const codigo = item?.error?.code ?? item?.executionStatus;
  const base = erro.message?.trim() || "Não foi possível conectar o banco.";
  if (codigo && !base.includes(codigo)) return `${base} (${codigo})`;
  return base;
}

/**
 * Onde o widget da Pluggy é aberto. É o único arquivo de navegador que conhece
 * o provedor, e o SDK entra por import dinâmico para que o servidor — que
 * importa `../index`, nunca este diretório — não carregue código de browser.
 */
export const abrir_widget_pluggy: LancadorDeWidget = async (pedido) => {
  const { PluggyConnect } = await import("pluggy-connect-sdk");

  const widget = new PluggyConnect({
    connectToken: pedido.token,
    includeSandbox: pedido.incluirSandbox ?? false,
    ...(pedido.conectorIds && pedido.conectorIds.length > 0
      ? { connectorIds: pedido.conectorIds }
      : {}),
    /** Sem isto o widget cria uma conexão nova em vez de consertar a existente. */
    ...(pedido.conexaoExterna ? { updateItem: pedido.conexaoExterna } : {}),
    language: "pt",
    theme: "dark",
    onSuccess: ({ item }) => pedido.aoConcluir(item.id),
    onError: (erro) => pedido.aoFalhar(mensagem_erro_connect(erro)),
    onClose: () => pedido.aoFechar?.(),
  });

  await widget.init();

  return { fechar: () => void widget.destroy() };
};
