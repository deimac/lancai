import { icone_lucide_categoria, classe_cor_categoria } from "../lib/visual-categoria";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  icone?: string | null;
  cor?: string | null;
  tamanho?: number;
  className?: string;
  /** No seletor, deixa o traço visível em vez de pintar com a cor da categoria. */
  variante?: "cor" | "padrao";
};

export function IconeCategoria({
  icone,
  cor,
  tamanho = 14,
  className,
  variante = "cor",
}: Props) {
  const Icone = icone_lucide_categoria(icone);
  const padrao = variante === "padrao";
  return (
    <span
      className={unir_classes(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        padrao ? "bg-borda/60 text-texto" : `text-white ${classe_cor_categoria(cor)}`,
        className,
      )}
      style={{ width: tamanho + 10, height: tamanho + 10 }}
      aria-hidden
    >
      <Icone size={tamanho} />
    </span>
  );
}
