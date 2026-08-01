import type { InputHTMLAttributes } from "react";
import { unir_classes } from "../../lib/unir-classes";

export function Campo({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={unir_classes(
        "w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto placeholder:text-texto-suave outline-none focus:border-primaria",
        className,
      )}
      {...props}
    />
  );
}
