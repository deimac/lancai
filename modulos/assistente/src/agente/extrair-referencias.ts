import type { EntityReference, UserRequest } from "@lancai/tipos";

function normalizarNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

const ORDINAIS: Record<string, number> = {
  primeiro: 1,
  primeira: 1,
  segundo: 2,
  segunda: 2,
  terceiro: 3,
  terceira: 3,
  quarto: 4,
  quarta: 4,
  quinto: 5,
  quinta: 5,
};

function parsearIndice(bruto: string): number | null {
  const lower = bruto.toLocaleLowerCase("pt-BR");
  if (ORDINAIS[lower] != null) return ORDINAIS[lower];
  const n = Number(bruto.replace(/[ºoª]/gi, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parsearValor(bruto: string): number {
  if (bruto.includes(",")) return Number(bruto.replace(/\./g, "").replace(",", "."));
  return Number(bruto);
}

/**
 * Extrai referências estruturadas da mensagem (não resolve IDs).
 */
export function extrairReferencias(mensagem: string): NonNullable<UserRequest["references"]> {
  const texto = mensagem.trim();
  const refs: NonNullable<UserRequest["references"]> = {};
  const partesTarget: EntityReference[] = [];

  const posicional =
    /\b(?:o|a)\s+(primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta|quinto|quinta|\d+)[ºoª]?\b/i.exec(
      texto,
    );
  if (posicional?.[1]) {
    const index = parsearIndice(posicional[1]);
    if (index) partesTarget.push({ type: "positional", index });
  }

  const temporal =
    /\b(?:o|a)\s+d[eoa]\s+(hoje|ontem|anteontem|semana\s+passada|[uú]ltima\s+semana|este\s+m[eê]s|m[eê]s\s+passado|[a-zç]{3,9})\b/i.exec(
      texto,
    );
  if (temporal?.[1]) {
    const t = temporal[1].toLocaleLowerCase("pt-BR");
    const relative =
      t === "hoje"
        ? "today"
        : t === "ontem"
          ? "yesterday"
          : /semana/.test(t)
            ? "last_week"
            : /este\s+m/.test(t)
              ? "this_month"
              : /m[eê]s\s+passado/.test(t)
                ? "last_month"
                : t;
    partesTarget.push({ type: "temporal", relative });
  }

  const valor = /\b(?:o|a)\s+de\s+(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\b/i.exec(texto);
  if (valor?.[1]) {
    const amount = parsearValor(valor[1]);
    if (Number.isFinite(amount) && amount > 0) partesTarget.push({ type: "value", amount });
  }

  const anaforico = /\b(aquele|aquela|isso|aquilo|o\s+anterior|o\s+[uú]ltimo)\b/i.exec(texto);
  if (anaforico?.[1]) {
    const p = anaforico[1].toLocaleLowerCase("pt-BR");
    const pronoun = /anterior|[uú]ltimo/.test(p) ? "previous" : p.includes("ultimo") ? "last" : "that";
    partesTarget.push({ type: "anaphoric", pronoun: pronoun === "last" ? "last" : pronoun });
  } else if (/\b(essa|esse|este|esta)\b/i.test(texto) && /\b(foi|era|é)\b/i.test(texto)) {
    partesTarget.push({ type: "anaphoric", pronoun: "that" });
  }

  const merchantAlvo =
    /\b(?:o|a)\s+([a-záàâãéêíóôõúç0-9]{2,30})(?:\s+(?:foi|para|de|no|na)|$)/i.exec(texto);
  if (merchantAlvo?.[1]) {
    const nome = normalizarNome(merchantAlvo[1]);
    if (
      !ORDINAIS[nome] &&
      !/^(de|do|da|hoje|ontem|aquele|aquela)$/.test(nome) &&
      !/^\d+$/.test(nome)
    ) {
      partesTarget.push({ type: "merchant", name: nome });
    }
  }

  const nos = [
    ...texto.matchAll(/\bno\s+(?!cart[aã]o\b)([a-záàâãéêíóôõúç0-9]+)/gi),
  ];
  const ultimoNo = nos.at(-1)?.[1];
  if (ultimoNo) {
    const nome = normalizarNome(ultimoNo);
    if (nome && !/^(uber|ifood|almoco|almoço)$/.test(nome)) {
      refs.account = { type: "merchant", name: nome };
    }
  }

  const cartao = /\bno\s+cart[aã]o\s+([a-záàâãéêíóôõúç0-9][a-záàâãéêíóôõúç0-9\s]{1,40})/i.exec(texto);
  if (cartao?.[1]) {
    refs.card = { type: "merchant", name: normalizarNome(cartao[1]) };
  }

  const unicas: EntityReference[] = [];
  const visto = new Set<string>();
  for (const p of partesTarget) {
    const chave = JSON.stringify(p);
    if (visto.has(chave)) continue;
    visto.add(chave);
    unicas.push(p);
  }

  if (unicas.length === 1) {
    refs.target = unicas[0];
  } else if (unicas.length > 1) {
    refs.target = { type: "composite", parts: unicas };
  }

  return refs;
}
