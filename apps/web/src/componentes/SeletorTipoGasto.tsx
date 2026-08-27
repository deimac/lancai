import { unir_classes } from "../lib/unir-classes";
import type { TipoGastoExtrato } from "../lib/filtrar-extrato";

const OPCOES: Array<{ valor: TipoGastoExtrato; rotulo: string }> = [
  { valor: "todas", rotulo: "Todos" },
  { valor: "pessoal", rotulo: "Pessoal" },
  { valor: "empresa", rotulo: "Empresa" },
];

type Props = {
  valor: TipoGastoExtrato;
  onChange: (proximo: TipoGastoExtrato) => void;
};

/** Segmented Todos / Pessoal / Empresa — cockpit e extrato. */
export function SeletorTipoGasto({ valor, onChange }: Props) {
  return (
    <div className="flex shrink-0 rounded-lg border border-borda p-0.5 text-xs">
      {OPCOES.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          onClick={() => onChange(opcao.valor)}
          className={unir_classes(
            "rounded-md px-2.5 py-1 font-medium transition",
            valor === opcao.valor
              ? "bg-primaria/15 text-primaria"
              : "text-texto-suave hover:text-texto",
          )}
        >
          {opcao.rotulo}
        </button>
      ))}
    </div>
  );
}
