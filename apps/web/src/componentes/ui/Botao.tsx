import type { ButtonHTMLAttributes } from "react";
import { unir_classes } from "../../lib/unir-classes";

interface PropsBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: "primaria" | "fantasma" | "perigo";
}

const CLASSES_POR_VARIANTE: Record<NonNullable<PropsBotao["variante"]>, string> = {
  primaria: "bg-primaria text-white hover:bg-primaria-forte",
  fantasma: "bg-transparent text-texto hover:bg-superficie-alta border border-borda",
  perigo: "bg-perigo text-white hover:opacity-90",
};

export function Botao({ variante = "primaria", className, disabled, ...props }: PropsBotao) {
  return (
    <button
      className={unir_classes(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        CLASSES_POR_VARIANTE[variante],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
