import {
  AlertTriangle,
  Building2,
  Landmark,
  ListFilter,
  PenLine,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { CategoriaResumo } from "../lib/api";
import {
  type ClassificacaoExtrato,
  type FilaExtrato,
  type PapelExtrato,
} from "../lib/filtrar-extrato";
import { Drawer } from "./ui/Drawer";
import { SeletorVisual, type OpcaoSeletorVisual } from "./ui/SeletorVisual";
import { Botao } from "./ui/Botao";

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  quantidade: number;
  categorias: CategoriaResumo[];
  categoriaId: string | null;
  classificacao: ClassificacaoExtrato;
  papel: PapelExtrato;
  fila: FilaExtrato;
  onCategoria: (id: string | null) => void;
  onClassificacao: (valor: ClassificacaoExtrato) => void;
  onPapel: (valor: PapelExtrato) => void;
  onFila: (valor: FilaExtrato) => void;
  onLimpar: () => void;
};

const OPCOES_CLASSIFICACAO: OpcaoSeletorVisual[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "usuario", rotulo: "Você", icone: UserRound },
  { valor: "regra", rotulo: "Regra", icone: ListFilter },
  { valor: "ia", rotulo: "IA", icone: Sparkles },
  { valor: "sem_classificar", rotulo: "Sem classificar", icone: AlertTriangle },
];

const OPCOES_PAPEL: OpcaoSeletorVisual[] = [
  { valor: "todas", rotulo: "Todos" },
  { valor: "gastos", rotulo: "Só gastos" },
  { valor: "pagamentos_fatura", rotulo: "Pagamentos de fatura", icone: Landmark },
];

const OPCOES_FILA: OpcaoSeletorVisual[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "banco", rotulo: "Do banco", icone: Building2 },
  { valor: "manual", rotulo: "Manuais", icone: PenLine },
  { valor: "revisar", rotulo: "Para revisar", icone: AlertTriangle },
];

export function DrawerFiltrosExtrato({
  aberto,
  aoFechar,
  quantidade,
  categorias,
  categoriaId,
  classificacao,
  papel,
  fila,
  onCategoria,
  onClassificacao,
  onPapel,
  onFila,
  onLimpar,
}: Props) {
  const opcoesCategoria: OpcaoSeletorVisual[] = [
    { valor: "", rotulo: "Todas" },
    ...categorias.map((categoria) => ({
      valor: categoria.id,
      rotulo: categoria.nome,
      iconeCategoria: categoria.icone ?? null,
      cor: categoria.cor ?? null,
    })),
  ];

  return (
    <Drawer
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Filtros"
      subtitulo={`${quantidade} lançamento${quantidade === 1 ? "" : "s"} neste recorte`}
      labelledBy="drawer-filtros-extrato"
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[10px] uppercase tracking-wide text-texto-suave">
          Categoria
          <SeletorVisual
            className="w-full normal-case tracking-normal"
            ariaLabel="Filtrar por categoria"
            valor={categoriaId ?? ""}
            opcoes={opcoesCategoria}
            onChange={(v) => onCategoria(v || null)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[10px] uppercase tracking-wide text-texto-suave">
          Classificação
          <SeletorVisual
            className="w-full normal-case tracking-normal"
            ariaLabel="Filtrar por classificação"
            valor={classificacao}
            opcoes={OPCOES_CLASSIFICACAO}
            onChange={(v) => onClassificacao(v as ClassificacaoExtrato)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[10px] uppercase tracking-wide text-texto-suave">
          Papel
          <SeletorVisual
            className="w-full normal-case tracking-normal"
            ariaLabel="Filtrar por papel"
            valor={papel}
            opcoes={OPCOES_PAPEL}
            onChange={(v) => onPapel(v as PapelExtrato)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[10px] uppercase tracking-wide text-texto-suave">
          Origem do lançamento
          <SeletorVisual
            className="w-full normal-case tracking-normal"
            ariaLabel="Filtrar fila do extrato"
            valor={fila}
            opcoes={OPCOES_FILA}
            onChange={(v) => onFila(v as FilaExtrato)}
          />
        </label>
        <Botao variante="fantasma" className="mt-2" onClick={onLimpar}>
          Limpar filtros extra
        </Botao>
      </div>
    </Drawer>
  );
}
