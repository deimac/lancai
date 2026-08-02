import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi } from "../lib/api";
import type { CartaoResumo, ContaResumo } from "../lib/api";
import { JanelaChat } from "../componentes/JanelaChat";
import type { JanelaChatHandle } from "../componentes/JanelaChat";
import { PainelSaldos } from "../componentes/PainelSaldos";
import { Botao } from "../componentes/ui/Botao";

export function TelaPrincipal() {
  const { usuario, sair } = useAutenticacao();
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [carregandoSaldos, setCarregandoSaldos] = useState(true);
  const janelaChatRef = useRef<JanelaChatHandle>(null);

  /**
   * Busca contas/cartões. No mount usa loading completo; depois do chat usa
   * modo silencioso para atualizar o painel sem desmontar o JanelaChat (senão
   * o histórico da conversa some e parece que “só atualiza com F5”).
   */
  const recarregar_saldos = useCallback(async (silencioso = false) => {
    if (!usuario) return;
    if (!silencioso) setCarregandoSaldos(true);
    try {
      const [contasCarregadas, cartoesCarregados] = await Promise.all([
        clienteApi.listar_contas(usuario.id),
        clienteApi.listar_cartoes(usuario.id),
      ]);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
    } finally {
      if (!silencioso) setCarregandoSaldos(false);
    }
  }, [usuario]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recarregar_saldos();
  }, [recarregar_saldos]);

  if (!usuario) {
    return <div className="flex min-h-screen items-center justify-center text-texto-suave">Carregando...</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-fundo">
      <header className="flex items-center justify-between border-b border-borda px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-texto">LançAI</p>
          <p className="text-xs text-texto-suave">Olá, {usuario.nome}</p>
        </div>
        <div className="flex items-center gap-2">
          <Botao variante="fantasma" onClick={() => janelaChatRef.current?.enviarMensagem("menu")}>
            <Menu size={14} />
            Menu
          </Botao>
          <Botao variante="fantasma" onClick={sair}>
            <LogOut size={14} />
            Sair
          </Botao>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_360px]">
        <main className="flex h-full flex-col overflow-hidden border-r border-borda">
          {carregandoSaldos ? (
            <div className="flex flex-1 items-center justify-center text-sm text-texto-suave">Carregando...</div>
          ) : (
            <JanelaChat
              ref={janelaChatRef}
              usuarioId={usuario.id}
              temContas={contas.length > 0}
              aoRegistrarOuCorrigirMovimento={() => {
                void recarregar_saldos(true);
              }}
            />
          )}
        </main>

        <aside className="hidden overflow-y-auto p-4 md:block">
          <PainelSaldos contas={contas} cartoes={cartoes} carregando={carregandoSaldos} />
        </aside>
      </div>
    </div>
  );
}
