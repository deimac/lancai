import { Link } from "react-router-dom";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  className?: string;
  tamanho?: "sm" | "md";
  /** Quando false, só marca visual (login etc.), sem navegar. */
  link?: boolean;
};

function IconeMarca({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="32" height="32" rx="9" className="fill-primaria" />
      <path
        d="M9.5 8.5v15h13.5"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 18.5c1.2-2.4 2.6-3.8 4.5-4.5"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

export function MarcaLancai({ className, tamanho = "md", link = true }: Props) {
  const texto = tamanho === "sm" ? "text-base" : "text-lg";
  const icone = tamanho === "sm" ? "h-7 w-7" : "h-8 w-8";

  const conteudo = (
    <>
      <IconeMarca className={unir_classes(icone, "shrink-0")} />
      <span className={unir_classes("font-semibold tracking-tight text-texto", texto)}>
        Lançai
      </span>
    </>
  );

  const classes = unir_classes(
    "inline-flex items-center gap-2 rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primaria/50",
    className,
  );

  if (!link) {
    return <div className={classes}>{conteudo}</div>;
  }

  return (
    <Link to="/" className={classes} aria-label="Lançai — início">
      {conteudo}
    </Link>
  );
}
