interface AtalhoChat {
  rotulo: string;
  mensagem: string;
}

const ATALHOS: AtalhoChat[] = [
  { rotulo: "Cadastrar conta", mensagem: "Quero cadastrar uma conta" },
  { rotulo: "Cadastrar cartão", mensagem: "Quero cadastrar um cartão" },
  { rotulo: "Ver exemplos", mensagem: "menu" },
  { rotulo: "Ajuda", mensagem: "ajuda" },
];

interface PropsChipsAtalho {
  aoSelecionar: (mensagem: string) => void;
  desabilitado?: boolean;
}

/**
 * Botões de atalho que enviam mensagens prontas pelo mesmo pipeline de chat
 * (POST /chat) — não existe endpoint dedicado, é só um preenchimento
 * automático do que o usuário digitaria.
 */
export function ChipsAtalho({ aoSelecionar, desabilitado }: PropsChipsAtalho) {
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3">
      {ATALHOS.map((atalho) => (
        <button
          key={atalho.rotulo}
          type="button"
          disabled={desabilitado}
          onClick={() => aoSelecionar(atalho.mensagem)}
          className="rounded-full border border-borda bg-superficie-alta px-3 py-1.5 text-xs font-medium text-texto transition-colors hover:bg-primaria hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {atalho.rotulo}
        </button>
      ))}
    </div>
  );
}
