export type ConversaCorpus = {
  id: string;
  categoria: string;
  titulo: string;
  mensagens: string[];
};

/**
 * Só consulta. Nenhuma mensagem pede lançar, corrigir ou apagar.
 * dataAtual da simulação é o dia civil de agora (hoje = terça 25/08/2026 no ambiente do autor).
 */
export const CORPUS_CONSULTAS_XAI: ConversaCorpus[] = [
  {
    id: "A-jornada-tayna",
    categoria: "jornada real",
    titulo: "Entradas ontem → sábado → maior → sexta → Tayna",
    mensagens: [
      "quanto eu tive de entradas ontem?",
      "sabado eu tive alguma entrada?",
      "certo, me mostre qual foi a maior entrada de ontem?",
      "me mostre detalhadamente os lancamentos de sexta",
      "quanto a tayna santos me enviou de pix?",
    ],
  },
  {
    id: "B-enviei-vs-enviou",
    categoria: "entradas vs saídas",
    titulo: "Enviei Pix vs ela me enviou",
    mensagens: [
      "quanto eu enviei de pix ontem?",
      "quanto a tayna santos me enviou de pix?",
    ],
  },
  {
    id: "C-followup-periodo",
    categoria: "período",
    titulo: "Follow-up de dia da semana e mês",
    mensagens: [
      "quanto gastei ontem?",
      "e sábado?",
      "e sexta?",
      "e mês passado?",
    ],
  },
  {
    id: "D-grain",
    categoria: "grain",
    titulo: "Maior, menor, últimos N, maiores N",
    mensagens: [
      "qual foi a maior entrada de ontem?",
      "e a menor entrada?",
      "me mostre os 3 últimos lançamentos de hoje",
      "os 3 maiores gastos do mês",
    ],
  },
  {
    id: "E-detalhado",
    categoria: "detalhado",
    titulo: "Resumo → maior → detalhado",
    mensagens: [
      "quanto tive de entradas ontem?",
      "qual foi a maior?",
      "mostre detalhado",
    ],
  },
  {
    id: "F-saldo-vs-resultado",
    categoria: "saldo",
    titulo: "Saldo das contas vs resultado do dia",
    mensagens: [
      "qual o meu saldo?",
      "qual o resultado de hoje?",
      "quanto sobrou hoje?",
    ],
  },
  {
    id: "G-vazio",
    categoria: "vazio",
    titulo: "Dia sem entradas e o outro lado",
    mensagens: [
      "quanto eu tive de entradas no sábado?",
      "e as saídas?",
    ],
  },
  {
    id: "H-empresa",
    categoria: "PJ",
    titulo: "Conta da empresa e tira a empresa",
    mensagens: [
      "quanto gastei na conta da empresa este mês?",
      "tira a empresa",
    ],
  },
];
