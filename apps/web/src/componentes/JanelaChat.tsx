import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Send } from "lucide-react";
import { clienteApi, ErroApi } from "../lib/api";
import { Botao } from "./ui/Botao";
import { Campo } from "./ui/Campo";
import { BolhaMensagem } from "./BolhaMensagem";
import type { MensagemLocal } from "./BolhaMensagem";

interface PropsJanelaChat {
  usuarioId: string;
  aoRegistrarOuCorrigirMovimento?: () => void;
}

const MENSAGEM_BOAS_VINDAS: MensagemLocal = {
  id: "boas-vindas",
  papel: "sistema",
  conteudo:
    'Oi! Pode me contar seus lançamentos como se estivesse conversando. Ex.: "Gastei R$ 45 no almoço hoje no Nubank".',
};

/**
 * Chat conversacional do Lançai. Diferente do `useChat` do AI SDK (pensado
 * para respostas em streaming, token a token), o endpoint POST /chat devolve
 * uma única resposta já pronta — a IA só é usada no backend para interpretar
 * a intenção; quem "fala" de volta é o MotorFinanceiro. Por isso o estado do
 * chat aqui é gerenciado localmente, sem streaming.
 */
export function JanelaChat({ usuarioId, aoRegistrarOuCorrigirMovimento }: PropsJanelaChat) {
  const [mensagens, setMensagens] = useState<MensagemLocal[]>([MENSAGEM_BOAS_VINDAS]);
  const [textoAtual, setTextoAtual] = useState("");
  const [enviando, setEnviando] = useState(false);
  const sessaoIdRef = useRef<string | undefined>(undefined);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const mensagem = textoAtual.trim();
    if (!mensagem || enviando) return;

    const mensagemUsuario: MensagemLocal = { id: crypto.randomUUID(), papel: "usuario", conteudo: mensagem };
    setMensagens((atual) => [...atual, mensagemUsuario]);
    setTextoAtual("");
    setEnviando(true);

    try {
      const resposta = await clienteApi.enviar_mensagem_chat({
        usuarioId,
        mensagem,
        sessaoId: sessaoIdRef.current,
      });
      sessaoIdRef.current = resposta.sessaoId;

      setMensagens((atual) => [
        ...atual,
        { id: crypto.randomUUID(), papel: "sistema", conteudo: resposta.resposta },
      ]);

      if (resposta.intencao.intencao === "REGISTRAR_MOVIMENTO" || resposta.intencao.intencao === "CORRIGIR_MOVIMENTO") {
        aoRegistrarOuCorrigirMovimento?.();
      }
    } catch (erro) {
      const texto = erro instanceof ErroApi ? erro.message : "Não consegui falar com o servidor. Tente de novo.";
      setMensagens((atual) => [
        ...atual,
        { id: crypto.randomUUID(), papel: "sistema", conteudo: texto, comErro: true },
      ]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {mensagens.map((mensagem) => (
          <BolhaMensagem key={mensagem.id} mensagem={mensagem} />
        ))}
        {enviando && (
          <BolhaMensagem
            mensagem={{ id: "digitando", papel: "sistema", conteudo: "Pensando..." }}
          />
        )}
      </div>

      <form onSubmit={enviar} className="flex items-center gap-2 border-t border-borda p-3">
        <Campo
          value={textoAtual}
          onChange={(evento) => setTextoAtual(evento.target.value)}
          placeholder="Conte o que aconteceu com o seu dinheiro..."
          disabled={enviando}
          autoFocus
        />
        <Botao type="submit" disabled={enviando || !textoAtual.trim()}>
          <Send size={16} />
        </Botao>
      </form>
    </div>
  );
}
