import type { CorWorkspace } from "./api";

export const CORES_WORKSPACE: CorWorkspace[] = [
  "violet",
  "blue",
  "teal",
  "orange",
  "red",
  "pink",
  "indigo",
  "slate",
];

const CLASSE_BG: Record<CorWorkspace, string> = {
  violet: "bg-violet-500",
  blue: "bg-sky-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
  red: "bg-rose-500",
  pink: "bg-pink-500",
  indigo: "bg-indigo-500",
  slate: "bg-slate-500",
};

export function classe_cor_workspace(cor: string | undefined): string {
  if (cor && cor in CLASSE_BG) return CLASSE_BG[cor as CorWorkspace];
  return CLASSE_BG.violet;
}
