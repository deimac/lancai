import { hex_cor_categoria, icone_lucide_categoria } from "../lib/visual-categoria";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  icone?: string | null;
  cor?: string | null;
  tamanho?: number;
  className?: string;
  /** No seletor, deixa o traço visível em vez de pintar com a cor da categoria. */
  variante?: "cor" | "padrao";
  /** Caixa menor, para listas densas como o Cockpit. */
  compacto?: boolean;
};

export function IconeCategoria({
  icone,
  cor,
  tamanho = 16,
  className,
  variante = "cor",
  compacto = false,
}: Props) {
  const Icone = icone_lucide_categoria(icone);
  const padrao = variante === "padrao";
  const hex = hex_cor_categoria(cor);
  const caixa = tamanho + (compacto ? 6 : 12);
  return (
    <span
      className={unir_classes(
        "inline-flex shrink-0 items-center justify-center",
        compacto ? "rounded" : "rounded-md",
        padrao ? "bg-borda/60 text-texto" : "",
        className,
      )}
      style={{
        width: caixa,
        height: caixa,
        ...(padrao
          ? {}
          : {
              backgroundColor: `color-mix(in srgb, ${hex} 18%, transparent)`,
              color: hex,
            }),
      }}
      aria-hidden
    >
      <Icone size={tamanho} />
    </span>
  );
}
