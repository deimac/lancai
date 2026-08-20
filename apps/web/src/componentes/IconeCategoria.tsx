import { icone_lucide_categoria, classe_cor_categoria } from "../lib/visual-categoria";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  icone?: string | null;
  cor?: string | null;
  tamanho?: number;
  className?: string;
};

export function IconeCategoria({ icone, cor, tamanho = 14, className }: Props) {
  const Icone = icone_lucide_categoria(icone);
  return (
    <span
      className={unir_classes(
        "inline-flex shrink-0 items-center justify-center rounded-md text-white",
        classe_cor_categoria(cor),
        className,
      )}
      style={{ width: tamanho + 10, height: tamanho + 10 }}
      aria-hidden
    >
      <Icone size={tamanho} />
    </span>
  );
}
