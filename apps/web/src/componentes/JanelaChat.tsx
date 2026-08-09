import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { IntencaoDetectada } from "@lancai/tipos";
import { Send } from "lucide-react";
import { clienteApi, ErroApi } from "../lib/api";
import { Botao } from "./ui/Botao";
import { Campo } from "./ui/Campo";
import { BolhaMensagem } from "./BolhaMensagem";
import type { MensagemLocal } from "./BolhaMensagem";
import { ChipsAtalho } from "./ChipsAtalho";

export interface JanelaChatHandle {
  /** Envia uma mensagem pelo mesmo pipeline do formulário — usado pelo botão "Menu" do cabeçalho. */
  enviarMensagem: (texto: string) => void;
  /** Foco no campo de mensagem (abrir painel / a11y). */
  focar: () => void;
}

interface PropsJanelaChat {
  usuarioId: string;
  /** Se o usuário ainda não tem nenhuma conta cadastrada, o chat abre em modo onboarding. */
  temContas: boolean;
  aoRegistrarOuCorrigirMovimento?: () => void;
}

/** Intenções que alteram saldos/limites/lista e invalidam o cockpit. */
const INTENCOES_QUE_AFETAM_SALDOS = new Set<IntencaoDetectada["intencao"]>([
  "REGISTRAR_MOVIMENTO",
  "CORRIGIR_MOVIMENTO",
  "CRIAR_CONTA",
  "CRIAR_CARTAO",
  "CORRIGIR_CONTA",
  "CORRIGIR_CARTAO",
]);

function intencao_afeta_saldos(intencao: IntencaoDetectada): boolean {
  if (!INTENCOES_QUE_AFETAM_SALDOS.has(intencao.intencao)) return false;
  // Pedido de exclusão ainda não confirmado: o backend só pergunta, nada mudou.
  if (
    (intencao.intencao === "CORRIGIR_CONTA" || intencao.intencao === "CORRIGIR_CARTAO") &&
    intencao.campos_alterados.ativo === false &&
    intencao.campos_alterados.confirmado !== true
  ) {
    return false;
  }
  if (
    intencao.intencao === "CORRIGIR_MOVIMENTO" &&
    intencao.campos_alterados.status === "cancelado" &&
    intencao.campos_alterados.confirmado !== true
  ) {
    return false;
  }
  // Duplicata ainda não confirmada: backend só pergunta (confirmado === false explícito).
  if (intencao.intencao === "REGISTRAR_MOVIMENTO" && intencao.confirmado === false) {
    return false;
  }
  return true;
}

function montar_mensagem_boas_vindas(temContas: boolean): MensagemLocal {
  if (temContas) {
    return {
      id: "boas-vindas",
      papel: "sistema",
      conteudo:
        'Oi! Pode me contar seus lançamentos como se estivesse conversando. Ex.: "Gastei R$ 45 no almoço hoje no Nubank".',
    };
  }

  return {
    id: "boas-vindas",
    papel: "sistema",
    conteudo:
      "Oi! Eu sou o Lançai. Aqui você não preenche formulário nenhum — é só me contar suas contas e cartões conversando, como se estivesse mandando mensagem para um amigo.\n\n" +
      'Pra começar, me conta: qual é o nome de uma conta ou carteira sua e quanto tem nela hoje? Ex.: "Tenho uma conta Nubank com R$ 1.200".\n\n' +
      'Se preferir, use os atalhos abaixo ou digite "ajuda" a qualquer momento.',
  };
}

/**
 * Chat conversacional do Lançai. Diferente do `useChat` do AI SDK (pensado
 * para respostas em streaming, token a token), o endpoint POST /chat devolve
 * uma única resposta já pronta — a IA só é usada no backend para interpretar
 * a intenção; quem "fala" de volta é o MotorFinanceiro. Por isso o estado do
 * chat aqui é gerenciado localmente, sem streaming.
 */
export const JanelaChat = forwardRef<JanelaChatHandle, PropsJanelaChat>(function JanelaChat(
  { usuarioId, temContas, aoRegistrarOuCorrigirMovimento },
  ref,
) {
  const [mensagens, setMensagens] = useState<MensagemLocal[]>(() => [montar_mensagem_boas_vindas(temContas)]);
  const [textoAtual, setTextoAtual] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mostrarChips, setMostrarChips] = useState(!temContas);
  const [sessaoId, setSessaoId] = useState<string | undefined>(undefined);
  const campoRef = useRef<HTMLInputElement>(null);

  const ultimaMensagem = mensagens[mensagens.length - 1];
  const aguardandoSenhaCartao =
    ultimaMensagem?.papel === "sistema" &&
    ultimaMensagem.conteudo.startsWith('Para ver os dados do cartão "');

  async function enviarTexto(mensagem: string) {
    if (!mensagem || enviando) return;

    const eraPedidoSenha = aguardandoSenhaCartao;
    const mensagemUsuario: MensagemLocal = {
      id: crypto.randomUUID(),
      papel: "usuario",
      conteudo: eraPedidoSenha ? "[senha omitida]" : mensagem,
    };
    setMensagens((atual) => [...atual, mensagemUsuario]);
    setMostrarChips(false);
    setEnviando(true);

    try {
      const resposta = await clienteApi.enviar_mensagem_chat({
        usuarioId,
        mensagem,
        sessaoId,
      });
      setSessaoId(resposta.sessaoId);

      setMensagens((atual) => [
        ...atual,
        { id: crypto.randomUUID(), papel: "sistema", conteudo: resposta.resposta },
      ]);

      if (resposta.intencao.intencao === "MENU") {
        setMostrarChips(true);
      } else if (intencao_afeta_saldos(resposta.intencao)) {
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

  useImperativeHandle(ref, () => ({
    enviarMensagem: (texto: string) => {
      void enviarTexto(texto);
    },
    focar: () => {
      campoRef.current?.focus();
    },
  }));

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const mensagem = textoAtual.trim();
    if (!mensagem) return;
    setTextoAtual("");
    await enviarTexto(mensagem);
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

      {mostrarChips && (
        <ChipsAtalho aoSelecionar={(mensagem) => void enviarTexto(mensagem)} desabilitado={enviando} />
      )}

      <form onSubmit={enviar} className="flex items-center gap-2 border-t border-borda p-3">
        <Campo
          ref={campoRef}
          type={aguardandoSenhaCartao ? "password" : "text"}
          value={textoAtual}
          onChange={(evento) => setTextoAtual(evento.target.value)}
          placeholder={
            aguardandoSenhaCartao
              ? "Digite a senha da sua conta Lançai..."
              : "Conte o que aconteceu com o seu dinheiro..."
          }
          disabled={enviando}
          autoFocus
          autoComplete={aguardandoSenhaCartao ? "current-password" : "off"}
          aria-label="Mensagem para o assistente"
        />
        <Botao type="submit" disabled={enviando || !textoAtual.trim()} aria-label="Enviar">
          <Send size={16} aria-hidden />
        </Botao>
      </form>
    </div>
  );
});
