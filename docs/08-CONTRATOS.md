# 08 — Contratos

As interfaces que atravessam fronteiras: entre fontes e Core, entre Core e Conhecimento, entre IA e backend, e entre clientes e API. Alterar qualquer coisa aqui é uma mudança de contrato e exige atenção a quem consome.

**Este documento não cobre:** o pipeline que produz as intenções — ver [10-IA.md](10-IA.md). As regras aplicadas depois que a intenção chega — ver [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md). Estrutura das tabelas — ver [07-MODELO_DE_DADOS.md](07-MODELO_DE_DADOS.md).

---

## 1. Fonte Financeira

Toda movimentação entra no sistema por aqui. É o contrato que mantém o Core ignorante sobre origens e provedores.

```ts
export type TipoFonte =
  | "open_finance"
  | "manual"
  | "whatsapp"
  | "api"
  | "recorrencia"
  | "ofx"
  | "csv"
  | "pdf"; // reservados; sem implementação agora

export interface EventoFinanceiroNormalizado {
  workspaceId: string;
  fonte: TipoFonte;
  /** Rótulo opaco ("pluggy"). O Core armazena e nunca interpreta. */
  provedor?: string;
  /** Identificador da instituição ou hash do arquivo importado. */
  idExterno: string | null;
  ocorridoEm: string; // YYYY-MM-DD
  valor: number; // sempre positivo; a direção está em tipo
  tipo: "receita" | "despesa";
  descricaoFonte: string;
  favorecidoFonte?: string;
  /** UUID local. O Core exige pelo menos um dos dois. */
  contaId?: string;
  cartaoId?: string;
  statusFonte: "confirmado" | "pendente"; // padrão "confirmado"
  /** true em open_finance: o Core passa a recusar alteração do Fato. */
  fatoImutavel: boolean;
}

export interface FonteFinanceira {
  readonly id: string;
  readonly tipo: TipoFonte;
  coletar(workspaceId: string): Promise<EventoFinanceiroNormalizado[]>;
}
```

Três propriedades importantes deste contrato:

1. **A política vem da fonte, não do Core.** É a fonte que declara `fatoImutavel`. O Core apenas obedece. Isso é o que permite adicionar uma fonte nova sem tocar no Core.
2. **`provedor` é opaco.** Nenhum `if (provedor === "pluggy")` deve existir fora de `modulos/open-finance`, e isso é verificado por teste.
3. **A conta é local, não externa.** `contaId` e `cartaoId` são UUIDs nossos. Uma versão anterior deste contrato dizia `contaExternaId` e `cartaoExternoId`, o que parecia conveniente — a fonte entregaria o identificador do provedor e o Core resolveria. Foi recusado: fazer o Core traduzir identificador de provedor é dar a ele conhecimento de provedor, exatamente o que o [ADR-011](adr/011-open-finance-isolado.md) proíbe.

   A consequência é que **resolver a conta é trabalho da fonte**, antes de entregar. É por isso que a porta de Open Finance devolve `MovimentacaoExterna` e não `EventoFinanceiroNormalizado`: o adaptador não conhece nossas contas, então quem completa é o serviço de ingestão do módulo, consultando o mapa de contas externas. Ver seção 2 de [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).

`tipo` tem só duas direções. `transferencia` foi removida: uma linha de extrato é dinheiro entrando ou saindo de uma conta, e dizer que duas linhas formam uma transferência é interpretação — logo Conhecimento, não Fato.

Ver [ADR-010](adr/010-fonte-financeira-porta-unica.md).

---

## 2. Core e Conhecimento

É aqui que o Pilar 1 deixa de ser documentação e passa a ser código.

```ts
// modulos/financeiro
export interface CoreFinanceiro {
  /**
   * `ContextoIngestao` carrega o que o evento não tem porque não é Fato: autor,
   * categoria de pouso e perfil padrão. Uma transação recém-chegada da
   * instituição ainda não tem categoria — quem define isso é o Conhecimento.
   */
  ingerir_eventos(
    eventos: EventoFinanceiroNormalizado[],
    contexto: ContextoIngestao,
  ): Promise<ResultadoIngestao>;
  /**
   * Alteração anunciada pela instituição sobre Fato já ingerido. Porta do
   * sistema, separada de `ingerir_eventos` porque a janela de recoleta faz o
   * lote normal retrazer o que já entrou: se a criação também atualizasse, todo
   * sync reescreveria Fato. Escreve só campo de Fato — o Conhecimento é intocado.
   */
  atualizar_fatos_da_fonte(
    eventos: EventoFinanceiroNormalizado[],
    contexto: ContextoIngestao,
  ): Promise<ResultadoAtualizacaoFonte>;
  /**
   * Transação desfeita pela instituição. Nada é apagado: `status_fonte` vira
   * `removido` e `status` vira `cancelado`, devolvendo o saldo e preservando a
   * linha. Idempotente — o provedor retenta, e devolver saldo duas vezes seria
   * um erro difícil de perceber.
   */
  remover_fatos_da_fonte(
    remocoes: Array<{ workspaceId: string; fonte: TipoFonte; provedor?: string; idExterno: string }>,
    contexto: ContextoIngestao,
  ): Promise<ResultadoRemocaoFonte>;
  criar_movimento(entrada: EntradaCriarMovimento): Promise<ResultadoCriarMovimento>;
  /** Recusa com erro de domínio quando o Fato é imutável ou a conta é sincronizada. */
  corrigir_fato_manual(entrada: EntradaCorrigirFatoManual): Promise<Movimento>;
  /**
   * Liga e desliga a marca de conta sincronizada, chamada pela associação de
   * conta no Open Finance. Mora no Core, e não na Fonte, porque é a marca que
   * decide o que o Core permite — ver seção 10 de 09-REGRAS_DE_NEGOCIO.md.
   */
  definir_sincronizacao(
    origem: { contaId?: string; cartaoId?: string },
    sincronizada: boolean,
  ): Promise<void>;
}

// modulos/conhecimento
export interface ServicoConhecimento {
  atualizar(entrada: EntradaAtualizarConhecimento): Promise<Movimento>;
  /**
   * Primeira etapa da ordem de classificação. Nunca toca movimento com
   * `classificado_por = 'usuario'`. Idempotente.
   */
  aplicar_regras(movimentoId: string): Promise<ResultadoAplicarRegra>;
  /** Passo 2: IA via porta `SugeridorCategoria` — implementação em `modulos/ia`. */
  aplicar_ia(movimentoId: string, sugeridor: SugeridorCategoria): Promise<ResultadoAplicarIa>;
  /** Ordem completa: regra → IA. */
  classificar(movimentoId: string, sugeridor: SugeridorCategoria): Promise<ResultadoClassificar>;
  criar_regra(entrada: EntradaCriarRegra): Promise<Regra>;
  /** Oferta “IFOOD → Restaurantes” após classificação manual; null se não há trecho ou já existe. */
  propor_regra_de_movimento(movimentoId: string): Promise<PropostaRegra | null>;
  /** “Sim” do virar regra? — origem `aprendizado_conversa`. Idempotente. */
  criar_regra_a_partir_de_correcao(movimentoId: string): Promise<ResultadoCriarRegraDeCorrecao>;
}

/** Hábitos chave/valor — absorvidos de `modulos/memoria` na F3. */
export class Memoria {
  buscar_habitos(usuarioId: string): Promise<HabitoMemoria[]>;
  buscar_habito(usuarioId: string, chave: string): Promise<string | undefined>;
  salvar_habito(usuarioId: string, chave: string, valor: string): Promise<void>;
}
```

**Nenhum método do Core aceita categoria ou tag. Nenhum método de Conhecimento aceita valor, data ou conta.** A separação é estrutural: não existe assinatura de função pela qual a violação passe.

Ver [ADR-009](adr/009-fato-vs-conhecimento.md) e as três camadas de garantia em [07-MODELO_DE_DADOS.md](07-MODELO_DE_DADOS.md).

---

## 3. Regra de ouro das importações

- `modulos/financeiro` não importa `open-finance`, `ia`, `evolution` nem React.
- `modulos/open-finance` importa apenas `pacotes/tipos`.
- Nenhum módulo periférico importa outro módulo periférico.
- O `apps/web` não importa SDK de provedor de Open Finance de forma fixa: descobre o provedor ativo pela API.

Ver [ADR-011](adr/011-open-finance-isolado.md) e [ADR-014](adr/014-seis-modulos-sem-infra-nova.md).

---

## 4. Contrato da IA: catálogo de intenções

A IA traduz qualquer frase exclusivamente em um JSON validado por schema Zod em `pacotes/tipos/src/intencoes.ts`, nunca em texto livre interpretado à mão. A união tem **17 variantes** (incluindo `CRIAR_REGRA_APRENDIZADO`, emitida só pelo atalho de confirmação do “virar regra?”, não pelo prompt da LLM).

A IA não possui credencial de escrita no banco ([ADR-003](adr/README.md)). Ela produz estrutura; quem decide é o backend.

### 4.1 Movimento

**`REGISTRAR_MOVIMENTO`**

```json
{
  "intencao": "REGISTRAR_MOVIMENTO",
  "tipo_movimento": "despesa",
  "valor": 180,
  "data_movimento": "2026-07-31",
  "descricao": "Combustível",
  "perfil": "pf",
  "conta_nome": "Nubank",
  "cartao_nome": null,
  "categoria_nome": "Combustível",
  "pessoa_nome": null,
  "parcelas": null
}
```

Campos adicionais: `forma_pagamento`, `confirmado`, `conta_destino_nome` (apenas quando `tipo_movimento` é `transferencia`).

`valor` é opcional na saída bruta: mensagens vagas como “fiz mercado” podem vir sem valor, e o normalizador converte em pergunta em vez de falhar. Quando o usuário não cita conta, cartão, categoria ou pessoa, o campo vem `null` e a resolução decide o que fazer.

**`CORRIGIR_MOVIMENTO`**

```json
{
  "intencao": "CORRIGIR_MOVIMENTO",
  "referencia": { "descricao": "combustível", "data_movimento": "2026-07-31" },
  "campos_alterados": { "valor": 210 }
}
```

`referencia` aceita `descricao`, `codigo`, `indice` ou `data_movimento`. Esta mesma intenção também cancela, passando `status: "cancelado"` em `campos_alterados` — a distinção entre corrigir e cancelar é uma regra de negócio crítica, detalhada em [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md).

### 4.2 Consulta

**`CONSULTAR_VISAO`**

```json
{
  "intencao": "CONSULTAR_VISAO",
  "tipo_visao": "categoria",
  "filtros": {
    "categoria_nome": "Alimentação",
    "perfil": "pf",
    "periodo": { "de": "2026-08-01", "ate": "2026-08-31" }
  },
  "detalhado": false
}
```

`tipo_visao` aceita oito valores: `saldos`, `cartoes`, `parcelamentos`, `categoria`, `futuro`, `fluxo`, `evolucao`, `historico`. A regra de agregação e o período padrão de cada um estão em [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md).

`filtros` aceita `conta_nome`, `cartao_nome`, `categoria_nome`, `pessoa_nome`, `descricao`, `perfil` e `periodo`. Chegam como texto livre e são resolvidos para identificadores pelo resolvedor, que **não cria nada automaticamente**: referência inexistente gera `ErroReferenciaNaoEncontrada` (HTTP 422), em vez de devolver resultado vazio enganoso.

`detalhado` distingue “só os totais” de “liste os lançamentos”.

### 4.3 Cadastro

`CRIAR_CONTA`, `CRIAR_CARTAO`, `CORRIGIR_CONTA`, `CORRIGIR_CARTAO`, `CONSULTAR_DADOS_CARTAO`.

```json
{ "intencao": "CRIAR_CONTA", "nome": "Nubank", "saldo_inicial": 1200, "perfil": "pf" }
```

```json
{
  "intencao": "CRIAR_CARTAO",
  "nome": "Nubank",
  "limite": 5000,
  "fechamento": 20,
  "vencimento": 27,
  "perfil": "pf",
  "conta_nome": "Nubank"
}
```

Todos os campos de `CRIAR_CONTA` e `CRIAR_CARTAO` são opcionais no schema, o que permite slot-filling flexível: o usuário informa tudo em uma frase, em qualquer ordem, ou aos poucos ao longo de vários turnos.

`CONSULTAR_DADOS_CARTAO` devolve dados do plástico e só é atendida após validação de senha no chat.

### 4.4 Orçamento e recorrência

`DEFINIR_ORCAMENTO`, `CONSULTAR_ORCAMENTO`, `CRIAR_RECORRENCIA`, `LISTAR_RECORRENCIAS`, `CANCELAR_RECORRENCIA`.

Em `CRIAR_RECORRENCIA`, `valor` e `dia_do_mes` são opcionais, para permitir slot-filling.

### 4.5 Meta-intenções

**`SOLICITAR_INFORMACAO`** — falta um campo obrigatório e o sistema pergunta em vez de inventar.

```json
{
  "intencao": "SOLICITAR_INFORMACAO",
  "intencao_pendente": "CRIAR_CONTA",
  "pergunta": "Qual o saldo atual dessa conta?",
  "dados_parciais": { "nome": "Nubank", "perfil": "pf" }
}
```

`intencao_pendente` aceita quatro valores: `CRIAR_CONTA`, `CRIAR_CARTAO`, `REGISTRAR_MOVIMENTO` e `CRIAR_RECORRENCIA`.

Não existe estado de “onboarding pendente” persistido. A continuidade vem do `historicoRecente` montado a cada turno — ver [10-IA.md](10-IA.md).

**`MENU`** — `{ "intencao": "MENU" }`. Existe apenas para dar formato consistente ao retorno da rota; a IA nunca a gera, ela vem de um atalho determinístico.

**`NAO_RECONHECIDA`** — `{ "intencao": "NAO_RECONHECIDA", "motivo": "..." }`. Escape hatch para mensagens fora do domínio financeiro. A IA pode gerá-la.

**`MENSAGEM_INFO`** — `{ "intencao": "MENSAGEM_INFO", "motivo": "..." }`. Resposta informativa sem efeito no Core (ex.: “Exclusão cancelada.”). Só atalhos de confirmação; a LLM não gera.

---

## 5. Contratos HTTP

### Chat
`POST /chat` — `{ usuarioId, mensagem, sessaoId? }`. Sessão nova quando `sessaoId` é omitido. Resposta síncrona: interpreta e responde na mesma conexão.

### Usuários
`POST /usuarios/sincronizar` — `{ id, nome, email }`, idempotente. Chamado após login no Supabase; cria o `usuario` se não existir. Mantém o backend agnóstico de como a autenticação é feita.

### Leituras de cadastro
`GET /contas?usuarioId=`, `GET /cartoes?usuarioId=`, além das rotas de `categorias`, `pessoas` e `movimentos`.

### WhatsApp
Webhook da Evolution, que identifica o usuário por `whatsapp_numero` e reusa a sessão ativa. Ver [12-WHATSAPP.md](12-WHATSAPP.md).

### Cron
`POST /cron/recorrencias` materializa as recorrências do dia. `POST /cron/resumo-baixa-confianca` envia o resumo diário da fila de revisão pelo WhatsApp. A arquitetura-alvo acrescenta o cron de rede de segurança de Open Finance pelo mesmo padrão, sem fila dedicada. Ver [15-OPERACAO.md](15-OPERACAO.md).

**TODO:** inventário completo de rotas com payload e código de erro de cada uma. As rotas existem em `apps/api/src/rotas/`, mas nunca foram documentadas exaustivamente.

---

## 6. Invariantes que qualquer alteração deve respeitar

Oito regras que valem para qualquer PR, refatoração ou feature nova:

1. A LLM não grava nem atualiza o banco diretamente.
2. A LLM não inventa valor, conta ou cartão inexistente.
3. Preferir **perguntar** a falhar com erro técnico.
4. Separar rigidamente **corrigir** de **cancelar**.
5. Manter os schemas Zod em `pacotes/tipos` como o contrato da IA.
6. Preferir atalho determinístico quando a precisão for igual ou melhor que a da LLM e o custo menor.
7. Respostas de slot são curtas, um campo por vez, opcionalmente com o primeiro nome do usuário.
8. Atalhos e normalizadores têm teste unitário — ver [14-TESTES.md](14-TESTES.md).

A estas somam-se as invariantes da arquitetura-alvo:

9. Fato de conta sincronizada não é criado, alterado nem excluído por IA, WhatsApp ou Web.
10. Regra de classificação não sobrescreve o que o usuário classificou à mão.
