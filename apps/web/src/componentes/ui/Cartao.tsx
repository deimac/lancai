import type { HTMLAttributes } from "react";
import { unir_classes } from "../../lib/unir-classes";

export function Cartao({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={unir_classes("rounded-xl border border-borda bg-superficie p-4 shadow-sm", className)}
      {...props}
    />
  );
}
