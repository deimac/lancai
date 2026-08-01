import { unir_classes } from "../lib/unir-classes";

export interface MensagemLocal {
  id: string;
  papel: "usuario" | "sistema";
  conteudo: string;
  comErro?: boolean;
}

export function BolhaMensagem({ mensagem }: { mensagem: MensagemLocal }) {
  const doUsuario = mensagem.papel === "usuario";

  return (
    <div className={unir_classes("flex w-full", doUsuario ? "justify-end" : "justify-start")}>
      <div
        className={unir_classes(
          "max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap",
          doUsuario
            ? "bg-primaria text-white rounded-br-sm"
            : mensagem.comErro
              ? "bg-perigo/10 border border-perigo/40 text-perigo rounded-bl-sm"
              : "bg-superficie-alta text-texto rounded-bl-sm",
        )}
      >
        {mensagem.conteudo}
      </div>
    </div>
  );
}
