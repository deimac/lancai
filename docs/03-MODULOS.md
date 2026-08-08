# 03 — Módulos

Um capítulo por módulo: o que faz, o que nunca faz, onde estão seus arquivos e qual é a distância entre o estado atual e o estado-alvo.

**Este documento não cobre:** o diagrama de dependência e os fluxos — ver [02-ARQUITETURA.md](02-ARQUITETURA.md). As interfaces expostas por cada módulo — ver [08-CONTRATOS.md](08-CONTRATOS.md).

---

## 1. Estrutura do repositório

### Estado atual

```text
lancai/
├── docs/
├── apps/
│   ├── api/          # Fastify: rotas, webhooks, cron, serviços de turno
│   └── web/          # React: MVP de chat
├── modulos/
│   ├── financeiro/   # MotorFinanceiro
│   ├── conhecimento/ # enriquecimento, regras, hábitos (Memoria)
│   ├── open-finance/ # fonte bancária isolada
│   ├── ia/           # interpretação, atalhos, normalizadores, resolvedor
│   ├── relatorios/   # agregações de leitura
│   └── evolution/    # transporte WhatsApp
├── pacotes/
│   ├── banco/        # schema Drizzle
│   └── tipos/        # contratos Zod
└── infra/
```

### Estado-alvo

```text
modulos/
  financeiro/     # Core: Fato + entrada de ingestão
  conhecimento/   # enriquecimento + regras + memória
  open-finance/   # provedores, isolado e trocável
  ia/
  relatorios/
  evolution/
```

Diferenças do alvo já resolvidas:

1. `conhecimento` existe e **absorveu** `memoria` (hábitos em `conhecimento/src/memoria/`). **Feito** na F3.
2. `open-finance` na F2. **Feito.**
3. `financeiro` com ingestão sem conhecer origem/provedor. **Feito** na F1, por `ingerir_eventos`.

Não existe `modulos/auditoria`: a trilha de auditoria é uma tabela escrita pelo próprio `financeiro`.

---

## 2. `modulos/financeiro` — Core Financeiro

O centro da arquitetura e o único componente com autoridade sobre o Fato Financeiro.

**Faz:** recebe eventos normalizados de qualquer fonte, deduplica por identificador externo, grava o Fato, recalcula saldo, gera parcelas, aplica cancelamento lógico onde permitido e registra auditoria.

**Nunca faz:** conhecer provedor de Open Finance, categorizar, falar com canal de interface, interpretar linguagem natural.

**Arquivos principais:**

```text
modulos/financeiro/src/motor-financeiro.ts       # fachada de escrita
modulos/financeiro/src/repositorio.ts            # porta de persistência
modulos/financeiro/src/calcular-saldo.ts         # direção do impacto por tipo
modulos/financeiro/src/registrar-parcelamento.ts # parcelas e vencimentos
modulos/financeiro/src/fluxo-cruzado.ts          # classificação PF/PJ
```

**Estado atual:** funcional e testado, escrevendo `movimento` sem noção de fonte. **A fazer na F1:** aceitar `EventoFinanceiroNormalizado`, respeitar `fatoImutavel` e expor `CoreFinanceiro` separado do serviço de Conhecimento.

---

## 3. `modulos/conhecimento` — o saber do LançAI

Módulo novo. Reúne tudo que é mutável e aprendido: enriquecimento, regras e memória.

**Faz:** grava categoria, pessoa, perfil, tags e observações sobre um movimento existente; casa regras e as aplica; classifica por IA quando nenhuma regra casa; propõe regra a partir de uma correção do usuário; guarda hábitos/preferências (`Memoria`).

**Nunca faz:** alterar valor, data, conta ou descrição de origem. Calcular saldo. Chamar provedor de Open Finance.

**Estado atual:** completo para a F3. `ServicoConhecimento` cobre enriquecimento, regras, fallback de IA e “virar regra?”; `Memoria` (ex-`modulos/memoria`) cobre hábitos chave/valor. Após ingestão, a API chama `classificar` no composition root.

---

## 4. `modulos/open-finance` — a fonte bancária

Módulo completamente isolado. É o único lugar do repositório onde o nome de um provedor pode aparecer, e isso é verificado por teste, não por revisão manual — ver item 7 da seção 6 de [14-TESTES.md](14-TESTES.md).

**Faz:** conexão com o provedor, reação ao webhook, mapa de contas externas para contas locais, guarda de payload bruto e configurações do provedor, tradução da transação em movimentação externa e entrega do evento normalizado ao Core.

**Nunca faz:** aplicar regra de negócio, escrever Conhecimento, decidir categoria.

**Estado atual:** existe, com a porta `ProvedorOpenFinance`, dois serviços — ingestão e conexão —, as três tabelas internas, um dublê em memória, o adaptador de um provedor real e a entrada de navegador `@lancai/open-finance/web` que abre o widget. Tanto o fluxo webhook → Fato quanto o de token → conta associada estão testados ponta a ponta, com as rotas de `/open-finance` e a tela `/conexoes` sobre eles.

Os dois serviços são separados porque a conexão é iniciada por uma pessoa numa tela e a ingestão pelo provedor, sem ninguém olhando: ritmos e modos de falha diferentes.

Qual adaptador sobe é decidido por `criar_provedor_open_finance`, dentro do módulo. Os adaptadores concretos não são exportados: quem quiser um pede pelo nome, e assim nenhuma aplicação precisa conhecer um provedor. O mesmo vale para o widget: a tela chama `abrir_widget_conexao` pelo identificador opaco.

**A fazer na F2:** rodar o adaptador contra o ambiente de teste do provedor. Detalhamento em [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).

---

## 5. `modulos/ia` — a camada de linguagem

**Faz:** classifica o ramo da mensagem, extrai a intenção tipada, aplica atalhos determinísticos antes de gastar token, normaliza a intenção, resolve nomes para identificadores, personaliza perguntas curtas, monta listas de desambiguação.

**Nunca faz:** gravar no banco. Criar, alterar ou excluir Fato de conta sincronizada. Calcular saldo.

**Arquivos principais:**

```text
modulos/ia/src/interpretador-intencoes.ts       # orquestra classificar + extrair
modulos/ia/src/ramos-intencao.ts                # agrupamento de intenções
modulos/ia/src/prompt.ts                        # ContextoInterpretacao
modulos/ia/src/prompt-ollama.ts                 # variante texto→JSON
modulos/ia/src/orquestrador-ia.ts               # provedores e fallback
modulos/ia/src/interpretar-lancamento-rapido.ts # atalhos sem LLM
modulos/ia/src/interpretar-consulta-rapida.ts
modulos/ia/src/interpretar-correcao-rapida.ts
modulos/ia/src/consulta-historico-detalhada.ts
modulos/ia/src/normalizar-intencao-movimento.ts
modulos/ia/src/normalizar-intencao-cadastro.ts
modulos/ia/src/normalizar-intencao-recorrencia.ts
modulos/ia/src/normalizar-descricao.ts
modulos/ia/src/personalizar-pergunta.ts
modulos/ia/src/resolvedor-intencao.ts
modulos/ia/src/montar-lista-semelhantes.ts
```

**Estado atual:** maduro, com o pipeline conversacional já refinado. **A fazer:** o resolvedor precisa consultar a política de escrita da conta antes de propor criação ou exclusão.

---

## 6. `modulos/relatorios` — leitura

**Faz:** agrega Fato e Conhecimento nas oito visões de consulta e devolve dados estruturados.

**Nunca faz:** escrever. Formatar o texto final, que é responsabilidade da API.

**Arquivo principal:** `modulos/relatorios/src/modulo-relatorios.ts`.

**Estado atual:** funcional. **A fazer:** passar a filtrar por `workspace_id` e a respeitar `ignorado_em_relatorio`.

---

## 7. `modulos/evolution` — transporte WhatsApp

**Faz:** envia e recebe mensagem pela Evolution API.

**Nunca faz:** domínio, interpretação, decisão de produto.

**Estado atual:** cliente fino, como deve ser. Comportamento do canal em [12-WHATSAPP.md](12-WHATSAPP.md).

---

## 8. `apps/api` — composition root

**Faz:** autenticação, rotas HTTP, webhooks, endpoints de cron, montagem das respostas em texto, orquestração do turno de conversa, alertas.

**Nunca faz:** regra de domínio pesada. Quando um arquivo daqui começa a decidir regra financeira, ele está no lugar errado.

**Arquivos principais:**

```text
apps/api/src/servicos/processar-turno-conversa.ts  # orquestra o turno
apps/api/src/servicos/processar-mensagem-whatsapp.ts
apps/api/src/servicos/interpretar-orcamento-recorrencia-rapido.ts
apps/api/src/servicos/orcamento-servico.ts
apps/api/src/servicos/recorrencia-servico.ts
apps/api/src/montar-resposta-chat.ts
apps/api/src/montar-resposta-visao.ts
apps/api/src/montar-resposta-menu.ts
apps/api/src/interpretar-confirmacao-exclusao.ts
apps/api/src/interpretar-confirmacao-duplicata.ts
apps/api/src/rotas/chat.ts
apps/api/src/rotas/webhooks-evolution.ts
apps/api/src/rotas/cron.ts
apps/api/src/rotas/{contas,cartoes,categorias,pessoas,movimentos,usuarios}.ts
```

**Estado atual:** concentra bastante orquestração. **A fazer:** afinar conforme `conhecimento` e `open-finance` assumirem responsabilidades hoje espalhadas.

---

## 9. `apps/web` — interface

**Estado atual:** MVP de chat, com as telas skeleton da F2 — conexões em `/conexoes` e extrato em `/extrato`. O widget do provedor não vive aqui — vive em `@lancai/open-finance/web`.

**Estado-alvo:** cockpit financeiro com assistente de IA em painel lateral persistente. Detalhamento em [11-WEB.md](11-WEB.md).

---

## 10. `pacotes/tipos` — contratos

Schemas Zod e tipos TypeScript compartilhados. É onde vivem as intenções da IA e, na arquitetura-alvo, `TipoFonte`, `EventoFinanceiroNormalizado` e `FonteFinanceira`.

Este pacote é a razão pela qual os módulos não precisam se importar entre si: eles compartilham contrato, não implementação.

**Arquivo principal:** `pacotes/tipos/src/intencoes.ts`.

---

## 11. `pacotes/banco` — schema

Definições Drizzle das tabelas, uma por arquivo, exportadas por `index.ts`. Ver [07-MODELO_DE_DADOS.md](07-MODELO_DE_DADOS.md).

---

## 12. Onde mexer para cada tipo de tarefa

Atalho mental para quem vai implementar:

- Mudar como uma frase é entendida: `modulos/ia`
- Mudar uma regra de cálculo ou validação: `modulos/financeiro`
- Mudar o texto de uma resposta: `apps/api/src/montar-resposta-*.ts`
- Mudar o que aparece em um relatório: `modulos/relatorios` e a formatação na API
- Adicionar campo de classificação: `modulos/conhecimento` e `pacotes/banco`
- Adicionar provedor bancário: só `modulos/open-finance`
- Adicionar tipo de fonte: `pacotes/tipos` e a entrada de ingestão em `financeiro`
