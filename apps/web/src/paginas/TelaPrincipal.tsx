import { useCallback, useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi } from "../lib/api";
import type { CartaoResumo, ContaResumo } from "../lib/api";
import { JanelaChat } from "../componentes/JanelaChat";
import { PainelSaldos } from "../componentes/PainelSaldos";
import { Botao } from "../componentes/ui/Botao";

export function TelaPrincipal() {
  const { usuario, sair } = useAutenticacao();
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [carregandoSaldos, setCarregandoSaldos] = useState(true);

  const recarregar_saldos = useCallback(async () => {
    if (!usuario) return;
    setCarregandoSaldos(true);
    try {
      const [contasCarregadas, cartoesCarregados] = await Promise.all([
        clienteApi.listar_contas(usuario.id),
        clienteApi.listar_cartoes(usuario.id),
      ]);
      setContas(contasCarregadas);
      setCartoes(cartoesCarregados);
    } finally {
      setCarregandoSaldos(false);
    }
  }, [usuario]);

  useEffect(() => {
    // recarregar_saldos já inicia com carregandoSaldos=true (mesmo valor do
    // estado inicial) — busca de dados no mount, sem efeito colateral real de
    // re-render extra; reaproveitada aqui para não duplicar a lógica de fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recarregar_saldos();
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
        <Botao variante="fantasma" onClick={sair}>
          <LogOut size={14} />
          Sair
        </Botao>
      </header>

      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_360px]">
        <main className="flex h-full flex-col overflow-hidden border-r border-borda">
          <JanelaChat usuarioId={usuario.id} aoRegistrarOuCorrigirMovimento={recarregar_saldos} />
        </main>

        <aside className="hidden overflow-y-auto p-4 md:block">
          <PainelSaldos contas={contas} cartoes={cartoes} carregando={carregandoSaldos} />
        </aside>
      </div>
    </div>
  );
}
