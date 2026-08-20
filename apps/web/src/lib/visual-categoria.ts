import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  Car,
  CreditCard,
  Fuel,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Plane,
  Receipt,
  ShoppingBag,
  Tag,
  Tv,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";

export const PALETA_CATEGORIA = [
  "neutro",
  "azul",
  "turquesa",
  "verde",
  "ambar",
  "laranja",
  "rosa",
  "violeta",
  "ardosia",
] as const;

export type CorCategoria = (typeof PALETA_CATEGORIA)[number];

export const ICONES_CATEGORIA = [
  "geral",
  "restaurante",
  "casa",
  "carro",
  "combustivel",
  "saude",
  "streaming",
  "salario",
  "lazer",
  "viagem",
  "educacao",
  "impostos",
  "vendas",
  "servicos",
  "tag",
  "fatura",
] as const;

export type IconeCategoriaSlug = (typeof ICONES_CATEGORIA)[number];

export const ROTULO_ICONE_CATEGORIA: Record<IconeCategoriaSlug, string> = {
  geral: "Geral",
  restaurante: "Restaurante",
  casa: "Casa",
  carro: "Carro",
  combustivel: "Combustível",
  saude: "Saúde",
  streaming: "Streaming",
  salario: "Salário",
  lazer: "Lazer",
  viagem: "Viagem",
  educacao: "Educação",
  impostos: "Impostos",
  vendas: "Vendas",
  servicos: "Serviços",
  tag: "Tag",
  fatura: "Fatura",
};

export const ROTULO_COR_CATEGORIA: Record<CorCategoria, string> = {
  neutro: "Neutro",
  azul: "Azul",
  turquesa: "Turquesa",
  verde: "Verde",
  ambar: "Âmbar",
  laranja: "Laranja",
  rosa: "Rosa",
  violeta: "Violeta",
  ardosia: "Ardósia",
};

const ICONE_LUCIDE: Record<IconeCategoriaSlug, LucideIcon> = {
  geral: Tag,
  restaurante: UtensilsCrossed,
  casa: Home,
  carro: Car,
  combustivel: Fuel,
  saude: HeartPulse,
  streaming: Tv,
  salario: Wallet,
  lazer: ShoppingBag,
  viagem: Plane,
  educacao: GraduationCap,
  impostos: Landmark,
  vendas: Receipt,
  servicos: Briefcase,
  tag: Tag,
  fatura: CreditCard,
};

const CLASSE_COR: Record<CorCategoria, string> = {
  neutro: "bg-slate-500",
  azul: "bg-sky-500",
  turquesa: "bg-teal-500",
  verde: "bg-emerald-500",
  ambar: "bg-amber-500",
  laranja: "bg-orange-500",
  rosa: "bg-pink-500",
  violeta: "bg-violet-500",
  ardosia: "bg-slate-600",
};

const HEX_COR: Record<CorCategoria, string> = {
  neutro: "#64748b",
  azul: "#0ea5e9",
  turquesa: "#14b8a6",
  verde: "#10b981",
  ambar: "#f59e0b",
  laranja: "#f97316",
  rosa: "#ec4899",
  violeta: "#8b5cf6",
  ardosia: "#475569",
};

export function normalizar_icone_categoria(valor: string | null | undefined): IconeCategoriaSlug {
  if (valor && ICONES_CATEGORIA.includes(valor as IconeCategoriaSlug)) {
    return valor as IconeCategoriaSlug;
  }
  return "geral";
}

export function normalizar_cor_categoria(valor: string | null | undefined): CorCategoria {
  if (valor && PALETA_CATEGORIA.includes(valor as CorCategoria)) {
    return valor as CorCategoria;
  }
  return "neutro";
}

export function icone_lucide_categoria(slug: string | null | undefined): LucideIcon {
  return ICONE_LUCIDE[normalizar_icone_categoria(slug)];
}

export function classe_cor_categoria(cor: string | null | undefined): string {
  return CLASSE_COR[normalizar_cor_categoria(cor)];
}

export function hex_cor_categoria(cor: string | null | undefined): string {
  return HEX_COR[normalizar_cor_categoria(cor)];
}
