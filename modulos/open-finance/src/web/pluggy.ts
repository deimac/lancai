import type { LancadorDeWidget } from "./widget";

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
    /** Sem isto o widget cria uma conexão nova em vez de consertar a existente. */
    ...(pedido.conexaoExterna ? { updateItem: pedido.conexaoExterna } : {}),
    language: "pt",
    theme: "dark",
    onSuccess: ({ item }) => pedido.aoConcluir(item.id),
    onError: (erro) => pedido.aoFalhar(erro.message),
    onClose: () => pedido.aoFechar?.(),
  });

  await widget.init();

  return { fechar: () => void widget.destroy() };
};
