import { unir_classes } from "../lib/unir-classes";

export type ProgressoImportacaoUi = {
  percentual: number;
  mensagem: string;
  criados?: number;
};

type Props = {
  progresso: ProgressoImportacaoUi | null;
  className?: string;
};

/** Barra com percentual durante importação de extrato Open Finance. */
export function BarraProgressoImportacao({ progresso, className }: Props) {
  if (!progresso) return null;

  const pct = Math.max(0, Math.min(100, Math.round(progresso.percentual)));

  return (
    <div className={unir_classes("flex flex-col gap-2", className)} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs text-texto-suave">
        <p className="min-w-0 truncate">{progresso.mensagem}</p>
        <p className="shrink-0 tabular-nums font-medium text-texto">{pct}%</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-borda/60">
        <div
          className="h-full rounded-full bg-primaria transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {typeof progresso.criados === "number" && progresso.criados > 0 ? (
        <p className="text-[11px] text-texto-suave">
          {progresso.criados} lançamento{progresso.criados === 1 ? "" : "s"} importado
          {progresso.criados === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
