import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina classes condicionalmente e resolve conflitos de utilitários Tailwind. */
export function unir_classes(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas));
}
