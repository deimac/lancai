import { Botao } from "./ui/Botao";
import { SeletorVisual } from "./ui/SeletorVisual";
import { TAMANHOS_PAGINA } from "../lib/filtrar-extrato";
import { unir_classes } from "../lib/unir-classes";

type Props = {
  pagina: number;
  paginas: number;
  total: number;
  porPagina: number;
  de: number;
  ate: number;
  onPagina: (pagina: number) => void;
  onPorPagina: (porPagina: number) => void;
};

function paginas_visiveis(pagina: number, paginas: number): number[] {
  const janela = 5;
  let inicio = Math.max(1, pagina - Math.floor(janela / 2));
  const fim = Math.min(paginas, inicio + janela - 1);
  inicio = Math.max(1, fim - janela + 1);
  return Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i);
}

const OPCOES_POR_PAGINA = TAMANHOS_PAGINA.map((n) => ({
  valor: String(n),
  rotulo: String(n),
}));

export function Paginador({
  pagina,
  paginas,
  total,
  porPagina,
  de,
  ate,
  onPagina,
  onPorPagina,
}: Props) {
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-3 pr-14 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-texto-suave">
        Mostrando {de}–{ate} de {total}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-texto-suave">
          Por página
          <SeletorVisual
            compacto
            className="w-[4.75rem]"
            ariaLabel="Lançamentos por página"
            valor={String(porPagina)}
            opcoes={OPCOES_POR_PAGINA}
            onChange={(v) => onPorPagina(Number(v))}
          />
        </label>
        <div className="flex items-center gap-1">
          <Botao
            variante="fantasma"
            className="px-2 py-1.5 text-xs"
            disabled={pagina <= 1}
            onClick={() => onPagina(pagina - 1)}
            aria-label="Página anterior"
          >
            Anterior
          </Botao>
          {paginas_visiveis(pagina, paginas).map((n) => (
            <Botao
              key={n}
              variante={n === pagina ? "primaria" : "fantasma"}
              className={unir_classes("min-w-8 px-2 py-1.5 text-xs", n === pagina && "pointer-events-none")}
              onClick={() => onPagina(n)}
              aria-current={n === pagina ? "page" : undefined}
              aria-label={`Página ${n}`}
            >
              {n}
            </Botao>
          ))}
          <Botao
            variante="fantasma"
            className="px-2 py-1.5 text-xs"
            disabled={pagina >= paginas}
            onClick={() => onPagina(pagina + 1)}
            aria-label="Próxima página"
          >
            Próxima
          </Botao>
        </div>
      </div>
    </div>
  );
}
