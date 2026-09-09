# AUDITORIA TÉCNICA PROFUNDA — MÓDULO DE CARTÕES, FATURAS FUTURAS, PARCELAS E RECONCILIAÇÃO — LANÇAI

> Esta auditoria foi produzida a partir da **leitura direta do código-fonte** (schema Drizzle, `MotorFinanceiro`, `ServicoIngestaoOpenFinance`, `AdaptadorPluggy`, `montar-dashboard`, `pagamento-fatura`, `datas`, `serie-parcelamento`, rotas Fastify e webhooks). Cada afirmação abaixo referencia o arquivo e a função reais. A auditoria prévia em `docs/AUDITORIA_TECNICA_CARTAOES_FATURAS.md` foi usada como ponto de partida, mas foi **corrigida** onde divergia do código real.

---

## 0. RESUMO EXECUTIVO

### O estado real

**~85% da base funciona e deve ser preservada.** Em particular, **faturas fechadas funcionam bem** e são sustentadas por uma arquitetura sólida: a autoridade é o `total_amount` do provedor (`fatura_oficial`), a composição é a soma das linhas do ciclo com `aplicar_total_oficial()`, e a quitação é resolvida por `competencia_quitacao_fatura()` (intervalo fecha→vence). Tudo isso está **provado e testado**.

**~15% crítico está quebrado e é o alvo desta evolução: a previsão de faturas futuras/abertas.** A causa-raiz é **modelagem**, não apenas lógica:

1. **`billId` (evidência L0) é completamente ignorado.** O tipo `TransacaoPluggy` **não possui o campo `billId`** (só há um comentário em `pluggy/tipos.ts` que cita sua existência na API). Ele nunca é mapeado, nunca é persistido, nunca é consultado.
2. **`billForecastDate` (evidência L1) é descartado.** Ele é consumido apenas como **um dos inputs** de `data_movimento_parcela()`, que desloca a data (`ocorridoEm`) da parcela. Nunca é persistido, nunca vira status de previsão, nunca é comparado com a confirmação posterior.
3. **Não existe `BillAllocation`.** O vínculo transação↔fatura é **implícito**, calculado em tempo de leitura por `ciclo_do_movimento()` (heurística de fechamento/vencimento aplicada sobre `dataMovimento`). Não há histórico, não há status, não há método, não há score.
4. **Não existe entidade de fatura aberta/futura.** `fatura_oficial` só guarda faturas **fechadas** (com `totalAmount` do provedor). A "fatura futura" é **recalculada a cada request** pelo dashboard (`montar_serie_faturas_dashboard()`), somando os movimentos do ciclo.
5. **Parcelas futuras OF viram transações falsas.** O `completar_parcelas_projetadas()` cria **linhas `movimento` reais** com `idExterno = 'lancai:proj:...'` e `status = 'previsto'`, violando o princípio "não inventar dinheiro / não criar transação falsa".
6. **Não há classificação de confiança.** O `status_fatura()` do dashboard só produz `paga | parcial | em_aberto | aberta | prevista`. Não existe `CONFIRMED | PREDICTED | POSSIBLE | UNRESOLVED`.
7. **Não há Piso / Central / Teto.** Para fatura aberta, o dashboard mostra **um único número** = soma das linhas do ciclo (que inclui `lancai:proj:` como se fosse certeza).
8. **Não há `InstallmentPlan`/`InstallmentInstance`.** Agrupar parcelas de uma mesma compra é heurística (`agrupar_series_parcelamento()`), sem entidade persistida.
9. **Não há `BillAdjustment` nem `BillAuditLog`.** O "ajuste" (`oficial − líquido`) é calculado **na hora, sem persistir**, e **não é explicado** (não distingue IOF, juros, anuidade, tarifa, câmbio, crédito).
10. **Não há configuração por instituição.** Tudo é regra "global" de fechamento/vencimento; o caso Itaú/Azul (que tem histórico real de problema) não tem camada de configuração dedicada.

### Veredito

A arquitetura atual deve ser **AJUSTADA** (não reescrita, não mantida como está). A parte de faturas fechadas **permanece intacta**. O foco é construir um **Bill Forecast Engine** separado do **Bill Reconciliation Engine**, introduzir **`BillAllocation`** como vínculo explícito e testável, e tratar `billForecastDate` como **previsão (L1)** e `billId` como **confirmação (L0)**.

---

## A. ESTADO ATUAL

### A.1 Arquitetura atual — visão geral

```
Pluggy
   ↓ (webhook / sync PATCH / GET histórico)
AdaptadorPluggy (único lugar que conhece "pluggy" — ADR-011)
   ↓ (traduzir_lote_transacoes → MovimentacaoExterna)
ServicoIngestaoOpenFinance
   ↓ (montar_eventos → EventoFinanceiroNormalizado)
MotorFinanceiro (Core — única autoridade financeira, ADR-002)
   ↓ (ingerir_eventos / atualizar_fatos_da_fonte / remover_fatos_da_fonte)
Postgres (Drizzle)
   ↓
Dashboard (montar-dashboard → montar_serie_faturas_dashboard → ciclos de fatura)
   ↓
UI (CardFaturasDashboard, Extrato, Próximos pagamentos)
```

**Ponto-chave:** o Core **não conhece fatura aberta/futura**. Ele só cria/atualiza/cancela `movimento` (fato). A noção de "fatura" nasce **no dashboard**, em tempo de leitura, a partir do ciclo do cartão. Não existe estado persistido de fatura aberta, nem alocação, nem previsão.

### A.2 Schema atual (Drizzle — `pacotes/banco/src/schema/`)

#### `movimento` (`schema/movimento.ts`) — O Fato Financeiro

É o equivalente do `Transaction`. Seus grupos de colunas:

| Grupo | Colunas | Regra de escrita |
|---|---|---|
| **Fato** (imutável p/ `fonte='open_finance'`) | `fonte`, `provedor`, `idExterno`, `valor`, `tipo`, `status`, `formaPagamento`, `dataMovimento`, `ocorridoEmInstante`, `contaId`, `cartaoId`, `descricaoFonte`, `favorecidoFonte`, `statusFonte`, `fingerprint`, `parcelaNumero`, `parcelaTotal`, `parcelaCompraEm`, `parcelaCompraValor` | Trigger `proteger_fato_financeiro` (ADR-009) |
| **Conhecimento** (sempre mutável) | `descricao`, `categoriaId`, `pessoaId`, `tipoGasto`, `tags`, `observacoes`, `classificadoPor`, `regraId`, `confiancaIa`, `ignoradoEmRelatorio`, `possivelRepetido`, `papel`, `cartaoFaturaId`, `competenciaFatura` | Sempre editável |
| **Auditoria** | `dataLancamento`, `usuarioId`, `criadoPor`, `alteradoPor`, `dataCriacao`, `dataAtualizacao` | Automático |

Indexes: `uniqueIndex(workspaceId, fonte, provedor, idExterno) WHERE idExterno IS NOT NULL`; `index(fingerprint)`; `index(workspaceId, dataMovimento)`.

**CRÍTICO — não existe:** `billId` (nem `providerBillId`), nem `billForecastDate` (nem `providerBillForecastDate`), nem `installmentPlanId`. O parcelamento do provedor foi **achatado em 4 colunas** (`parcelaNumero`, `parcelaTotal`, `parcelaCompraEm`, `parcelaCompraValor`), mas **sem um plano persistido** que agrupe a compra-mãe.

#### `fatura_oficial` (`schema/fatura-oficial.ts`) — Só faturas fechadas

```
id, workspaceId, cartaoId, idExterno, competencia (YYYY-MM),
total (numeric 14,2), dataFechamento, dataVencimento
UNIQUE(cartaoId, idExterno), UNIQUE(cartaoId, competencia)
```

**CRÍTICO — não existe:** `lifecycle_status`, `payment_status`, `reconciliation_status`, `period_start`, `period_end`, `versao`, `total_previsto`, `piso`, `teto`. Não há **fatura aberta/futura persistida**.

#### `cartao` (`schema/cartao.ts`) — Entidade unificada do plástico

```
id, workspaceId, contaFinanceiraId, nome, limite (numeric), saldo (numeric),
fechamento (int), vencimento (int), melhorDiaCompra (int), perfil,
modalidade (credito|debito|multiplo), ativo, sincronizada,
dadosPlasticosCifrados, contaId, usuarioId, dataCriacao, dataAtualizacao
```

**Observações:**
- Não existe `providerCardReference`, `maskedNumber`, `holder`, `cardType (titular|adicional|virtual)`, `metadata` — campos sugeridos pela Pluggy para cartões adicionais/virtuais. O mapeamento para múltiplos cartões da mesma conta hoje é feito via `conta_financeira` (identidade estável), mas o `cartao` local **não distingue** cartão adicional/virtual.
- `saldo` = "saldo devido" (dívida atual). `limite` = limite total. `fechamento`/`vencimento` = dias do mês.

#### `parcela` (`schema/parcela.ts`) — Só parcelamento manual

```
id, movimentoId (FK movimento), numeroParcela, valor, dataMovimento, status
```

É o modelo "movimento pai + N filhas", usado **apenas** para lançamentos manuais (`registrar_parcelamento()`). **Parcelas OF não usam esta tabela** — chegam como `movimento` independentes.

#### `conta_financeira` (`schema/conta-financeira.ts`) — Identidade estável

```
id, usuarioId, instituicao, nomeExibicao, mascara, tipo, perfil,
bancoCodigo, agencia, contaNumero, conexaoStatus, conexaoId, ultimoSyncEm,
origem (manual|open_finance), dataCriacao, dataAtualizacao
```

**Propósito:** permanece quando o `itemId` do provedor muda (reatachar). `conta` e `cartao` locais apontam para cá via `conta_financeira_id`. Isso é o que permite múltiplos cartões/contas por conexão.

#### `open_finance_conexao` (`schema/open-finance.ts`)

```
id, workspaceId, criadoPor, provedor, idExterno (itemId), instituicao,
status, motivoAtencao, consentimentoExpiraEm, ultimoSyncEm,
ultimoResumoIngestao (jsonb), configuracoes (jsonb), dataCriacao, dataAtualizacao
UNIQUE(provedor, idExterno)
```

#### `open_finance_conta_externa` (`schema/open-finance.ts`)

```
id, conexaoId, idExterno, nome, tipo, contaId, cartaoId, contaFinanceiraId
UNIQUE(conexaoId, idExterno)
```

**É o mapa** entre a conta do provedor e a entidade local. É aqui que a ingestão resolve `contaId`/`cartaoId`.

#### `open_finance_evento` (`schema/open-finance.ts`) — O Webhook Inbox (JÁ EXISTE)

```
id, provedor, eventoId, tipo, payload (jsonb), processadoEm, erro, dataCriacao
UNIQUE(provedor, eventoId)
```

**Este é o `ProviderWebhookEvent` / `WebhookInbox` já implementado.** A idempotência é garantida pelo `UNIQUE(provedor, eventoId)` com `onConflictDoNothing`.

### A.3 Fluxo de dados real — PENDING → POSTED

Vamos traçar com o código real (`servico-ingestao.ts`, `motor-financeiro.ts`, `traducao.ts`):

**1. Webhook `transactions/created` (PENDING, sem `billId`, às vezes com `billForecastDate`)**

```
AdaptadorPluggy.interpretar_notificacao(corpo)
  → evento "transactions/created" → NotificacaoFonte { tipo: 'lote_disponivel', referencia }
  → ServicoIngestaoOpenFinance.receber() grava payload bruto em open_finance_evento
  → resposta 2XX imediata
  → ServicoIngestaoOpenFinance.processar() → executar() → ingerir_lote()
    → provedor.coletar_lote(referencia) → traduzir_lote_transacoes()
      → traduzir_transacao(transacao, ciclo)
        → statusFonte = traduzir_status_transacao(status)  // "PENDING" → "pendente"; resto → "confirmado"
        → ocorridoEm = data_do_movimento(transacao, ciclo)
            // para parcela: data_movimento_parcela({ numero, compraEm, billForecastDate, dateProvedor, fechamento, vencimento })
            // para avulsa: dia_movimento_avulsa(transacao.date)
        → NÃO há mapeamento de billId (o tipo nem tem o campo)
        → NÃO há persistência de billForecastDate (só entra como input da data)
    → montar_eventos() → EventoFinanceiroNormalizado (sem billId, sem billForecastDate)
    → MotorFinanceiro.ingerir_eventos()
      → status = (statusFonte === "pendente") ? "previsto" : "realizado"
      → grava movimento com parcelamento achatado (parcelaNumero/Total/CompraEm/CompraValor)
      → NÃO avalia fatura
```

**2. Webhook `transactions/updated` (POSTED, agora com `billId`)**

```
AdaptadorPluggy.interpretar_notificacao(corpo)
  → evento "transactions/updated" → NotificacaoFonte { tipo: 'movimentacoes_alteradas', idsExternos }
  → ServicoIngestaoOpenFinance.processar() → executar() → ingerir_alteradas()
    → provedor.coletar_por_ids(conexaoExterna, idsExternos)
      → traduzir_lote_transacoes([...brutas.values()])
        → traduzir_transacao(...) // AINDA NÃO mapeia billId
    → montar_eventos() → EventoFinanceiroNormalizado
    → MotorFinanceiro.atualizar_fatos_da_fonte()
      → diferenca_do_fato(atual, evento) — compara:
          valor, tipo, descricaoFonte, favorecidoFonte, statusFonte, status,
          dataMovimento, ocorridoEmInstante, parcelamento (4 colunas)
        // NÃO compara billId (não existe), NÃO compara billForecastDate (não existe)
      → atualiza statusFonte "pendente"→"confirmado", status "previsto"→"realizado"
      → NÃO recalcula previsão de fatura
      → NÃO cria/atualiza alocação (não existe)
```

**3. Pós-ingestão** (`enriquecer_apos_ingestao`) — o que acontece depois do Core gravar Fato:
- `marcar_possiveis_repetidos_criados()` — marca possível duplicata.
- `conciliar_manuais_com_fatos_criados()` — casa lançamento manual/recorrência com Fato do banco (estorna o manual).
- Classificação por regra → IA (`ServicoConhecimento.classificar`).
- `avisar_orcamentos_apos_movimentos()` — alerta de orçamento.

**Não há nenhuma etapa de "recalcular faturas afetadas" nem "reavaliar alocação".** O pós-ingestão é puramente classificação/conciliação manual↔banco/orçamento.

### A.4 Como o sistema decide em qual fatura uma transação entra (HOJE)

Este é o coração do problema e do "que já funciona". Há **duas entradas diferentes** para o mesmo conceito:

#### (a) Faturas FECHADAS — funciona bem (preservar)

1. `fatura_oficial` guarda `totalAmount` do provedor (autoridade), `competencia` (YYYY-MM), `dataFechamento`, `dataVencimento`.
2. No dashboard, para cada mês da série, cada cartão tem:
   - `cicloFecha = competencia_alvo_do_modo_fatura({ mes: mesTela, fechamento, vencimento })` — o mês do **fechamento** que corresponde à tela.
   - `oficial = oficiais.get(cartaoId:cicloFecha)` — o total oficial **se** a fatura já foi publicada pelo banco.
   - `gasto = agregar_gasto_cartao_por_competencia(...)` — soma dos movimentos `eh_linha_da_fatura` no ciclo via `movimento_no_resultado_do_mes`.
   - `total = totalOficial ?? gasto.gasto` — **o total oficial prevalece**.
   - `totalPago = somar_pagamentos_fatura(...)` — via `competencia_quitacao_fatura`.
   - `ajuste = totalOficial - gasto.gasto` — residual (calculado na hora, não persistido).
   - `status_fatura()`: `paga` se `totalPago >= totalOficial`; `parcial` se `0 < totalPago < totalOficial`; `em_aberto` se `totalPago === 0`.

**Por que isso funciona:** a fatura fechada tem o total do banco como autoridade, e a composição é a soma das linhas do ciclo. A lógica de "qual ciclo" é determinística e estável porque a fatura já fechou.

#### (b) Faturas ABERTAS / FUTURAS — o problema

Para fatura aberta/futura (`totalOficial == null`), o total é **simplesmente `gasto.gasto`** — a soma das linhas do ciclo calculadas por `ciclo_do_movimento()`. Ou seja:

```
fatura futura (total) = Σ movimentos com ciclo_do_movimento(dataMovimento, cartaoId, fechamento, {
  vencimento, parcelaNumero, status, pagamentos
}) == cicloDaFatura
```

O `ciclo_do_movimento()` (`pagamento-fatura.ts`) faz:
1. `ciclo = competencia_ciclo_da_data(data, fechamento)` — compra ≤ fecha → mês do fecha; compra > fecha → mês seguinte.
2. Se é **parcela prevista** (`parcelaNumero` presente e `status != realizado/cancelado`) e `vencimento > fechamento`, volta ao ciclo que fechou; se `vencimento < fechamento`, fica no ciclo aberto.
3. Antecipação de pagamento empurra para o ciclo seguinte.

E o `dataMovimento` já foi **previamente deslocado** por `data_movimento_parcela()` na ingestão, usando:
- O ciclo local (`fechamento`/`vencimento`) — **manda**.
- `billForecastDate` — **só se bater** com o ciclo local; senão é descartado.
- `compraEm`/`dateProvedor` — fallback.

**Conclusão: a "previsão" de fatura futura hoje = heurística de data de ciclo. Não é uma previsão baseada em evidência do provedor; é uma inferência geométrica sobre `dataMovimento`.**

### A.5 Parcelas OF

Quando o OF entrega parcelamento, cada parcela chega como **`movimento` independente** (Fato), com as 4 colunas achatadas. Não há "movimento pai". O agrupamento em "compra parcelada" é feito **em tempo de leitura** por heurística (`agrupar_series_parcelamento()`, baseada em `cartaoId + parcelaTotal + compraEm (±1 dia) + descrição normalizada`).

**Projeção de parcelas futuras ausentes** (`completar_parcelas_projetadas()` em `servico-ingestao.ts`):
- Se o OF só devolve parcelas POSTED e omite as futuras (comportamento comum em MP/Nubank), o sistema **projeta** as faltantes e **cria `movimento` reais** com `idExterno = 'lancai:proj:<hash>:<numero>'`, `statusFonte = 'pendente'`, `status = 'previsto'`.
- Quando o banco envia a parcela real, `cancelar_projetadas_substituidas()` **cancela** a projetada homônima (combina hash + número + série).

**Problema:** `lancai:proj:` é um **movimento falso** — vira um gasto no extrato/relatório/dashboard sem existir na instituição. Ele é usado como "placeholder de parcela futura", mas está **poluindo o ledger**.

### A.6 Webhook / Sync

- **Webhook:** `POST /api/webhooks/open-finance` (e alias `/pluggy`). Autoriza por header `X-Lancai-Webhook` (timing-safe). Grava payload bruto em `open_finance_evento` (idempotente), responde 2XX, processa em background. **Dead letter / retry counters / fila de retry NÃO existem** — só `erro` (string) e reprocesso manual via `reprocessar_falhos()`. Não há `tentativas`, `proximo_retry`, `dead_letter_em`, `status`.
- **Sync:** `importar_historico()` (GET, ao registrar itemId existente) e `solicitar_atualizacao()` (PATCH no item — o Fato chega via webhook). O cron `importar-historico-open-finance.ts` faz varredura periódica.
- **Adoção de órfãos:** `listar_destinos_adotaveis()` + `filtrarCriacao` (para não duplicar em reatachar).

### A.7 Dashboard / UI

- `montar_dashboard()` (service) → `DashboardResposta` com `cartoes` (inclui `gastoMes`, `totalOficial`, `ajusteFatura`) e `faturas` (série de meses via `montar_serie_faturas_dashboard`).
- A UI mostra um card de cartões (limite/comprometido/disponível), uma série de faturas (meses passados→futuros), e `proximosPagamentos`.
- **Não há** distinção de confiança (confirmado/provável/possível), nem Piso/Central/Teto.

---

## B. O QUE JÁ FUNCIONA (DEVE SER PRESERVADO)

| Funcionalidade | Onde (arquivo:função) | Status |
|---|---|---|
| **Fatura fechada: `total_amount` do provedor é autoridade** | `fatura-oficial` + `montar-dashboard.ts:montar_serie_faturas_dashboard` (`total = totalOficial ?? gasto.gasto`) | ✅ Funciona |
| **Conciliação: totalOficial = Σ linhas + ajuste** | `pagamento-fatura.ts:aplicar_total_oficial` | ✅ Funciona |
| **Quitação no intervalo fecha→vence, deduplica débito+crédito** | `pagamento-fatura.ts:competencia_quitacao_fatura`, `soma_cobrada_do_vencimento`, `competencia_cobranca_casa` | ✅ Testado |
| **Ciclo do cartão (fechamento/vencimento)** | `pagamento-fatura.ts:intervalo_ciclo_fatura`, `competencia_ciclo_da_data`, `ciclo_do_movimento`, `mes_gasto_do_cartao`, `na_fatura_do_recorte` | ✅ Testado extensivamente |
| **Parcelamento manual (movimento pai + N parcelas)** | `motor-financeiro.ts:registrar_parcelamento` + tabela `parcela` | ✅ Funciona |
| **Projeção de parcelas OF faltantes** | `servico-ingestao.ts:completar_parcelas_projetadas` + `projetar-parcelas.ts` | ✅ Funciona (mas cria Fato falso — ver C) |
| **Reidentificação por fingerprint quando idExterno muda** | `motor-financeiro.ts:gerar_fingerprint` + `atualizar_fatos_da_fonte` | ✅ Funciona |
| **Webhook inbox idempotente** | `open_finance_evento` UNIQUE(provedor, evento_id) | ✅ Funciona |
| **Separação Fato vs Conhecimento (trigger imutabilidade)** | trigger `proteger_fato_financeiro` (ADR-009) | ✅ Funciona |
| **Múltiplos cartões por conexão** | `conta_financeira` + `open_finance_conta_externa` | ✅ Funciona |
| **Selo no extrato "Compra em ago → Fatura set"** | `pagamento-fatura.ts:selo_fatura_ciclo` | ✅ Funciona |
| **Dashboard: status paga/parcial/em_aberto/aberta/prevista** | `montar-dashboard.ts:status_fatura` | ✅ Funciona |
| **Deduplicação PENDING/POSTED de "Pagamento recebido" do cartão** | `traducao.ts:absorver_creditos_de_fatura_duplicados`, `servico-ingestao.ts:marcar_creditos_quitacao_duplicados` | ✅ Funciona |
| **IOF de compra internacional (35%, par, moeda da conta)** | `traducao.ts:incorporar_iof_nas_compras`, `traduzir_lote_transacoes` | ✅ Funciona |
| **Crédito de quitação nasce como `pagamento_fatura`** | `pagamento-fatura.ts:conhecimento_inicial_credito_quitacao` | ✅ Funciona |

---

## C. O QUE ESTÁ QUEBRADO / FALTANDO (FOCO: FATURAS FUTURAS)

### C.1 Lacunas críticas confirmadas por busca no código

| Lacuna | Evidência direta no código | Impacto |
|---|---|---|
| **`billId` não é extraído nem armazenado** | `grep -rn billId` → **única ocorrência é um comentário** em `pluggy/tipos.ts:66` ("ao contrário de `billId`, que só aparece depois do fechamento"). O tipo `TransacaoPluggy` **não tem o campo**. | Perde a **evidência L0 (PROVIDER_BILL_ID)** — a única que prova a alocação. Sem ela, tudo é heurística. |
| **`billForecastDate` é descartado** | `grep -rn billForecastDate` → aparece em `tipos.ts` (campo bruto), `traducao.ts` (input de `data_do_movimento`), `datas.ts` (função), `servico-ingestao.ts:730`, e testes. **Nunca é persistido** em coluna. | Perde a **evidência L1 (PROVIDER_FORECAST)**. Vira só um deslocamento de data, não uma previsão auditável. |
| **Não existe `BillAllocation`** | Schema `pacotes/banco/src/schema/` não tem tabela de alocação. | Vínculo transação↔fatura é implícito (ciclo), não rastreável, sem histórico. Mudança de previsão → confirmação é **destrutiva** (a fatura "vira" outra sem registro). |
| **Não existe fatura aberta/futura persistida** | `fatura_oficial` só tem colunas de fatura fechada. | A fatura futura é **recalculada a cada request**; não há `piso/central/teto`, nem estado persistido, nem reprocessamento. |
| **Não existe status de previsão (confirmed/predicted/possible/unresolved)** | `status_fatura()` do dashboard só retorna `paga/parcial/em_aberto/aberta/prevista`. | UI não distingue certeza de estimativa. Uma compra PENDING sem evidência vira "prevista" (falsa certeza). |
| **Não existe Piso/Central/Teto** | `montar_serie_faturas_dashboard` usa `total = totalOficial ?? gasto.gasto` (valor único). | Usuário vê um número, sem saber o quanto é incerto. |
| **Parcelas futuras OF viram `movimento` falsos** | `completar_parcelas_projetadas()` cria linhas com `idExterno='lancai:proj:...'`. | Polui o ledger com transação que não existe na instituição. Violação do princípio "não inventar dinheiro". |
| **Não existe `InstallmentPlan`/`InstallmentInstance`** | Schema não tem essas tabelas; agrupamento é heurístico e em tempo de leitura. | Não modela a compra parcelada como entidade; `virtual → real` não é possível com integridade. |
| **Não existe `BillAdjustment`** | `aplicar_total_oficial` só calcula `ajuste = oficial − líquido` na hora. | Diferença não é explicada (IOF, juros, anuidade, tarifa, câmbio, crédito, unexplained). Não persiste a "fotografia" da reconciliação. |
| **Não existe `BillAuditLog`** | `auditoria` (tabela genérica) cobre movimento, mas não fatura/alocação. | Mudança de previsão/alocação sem rastro; não é possível responder "por que mudou?". |
| **Não há configuração por instituição** | Nenhuma camada de `InstitutionCardBehavior`; tudo é regra global de fechamento/vencimento. | O caso Itaú/Azul (e outros) não tem parametrização; regras ad hoc teriam que ser espalhadas. |

### C.2 O bug central das faturas futuras — explicado com precisão

**Em uma frase:** o sistema não tem **evidência** para decidir a fatura futura; ele tem apenas **uma heurística de data de ciclo** aplicada sobre `dataMovimento`, e essa heurística **não usa `billId` (que nem existe no código) nem respeita `billForecastDate` como previsão**.

Decomposição:

1. **Ingestão:** `traduzir_transacao` pega `creditCardMetadata.billForecastDate` e o passa para `data_do_movimento`. Se a transação é parcela, `data_movimento_parcela` **desloca `ocorridoEm`** para o mês do ciclo. Se é avulsa, `billForecastDate` é ignorado. O `billId` **não é lido**.
2. **Persistência:** o `movimento` gravado tem `dataMovimento` (já deslocado) e as 4 colunas de parcelamento. **`billForecastDate` se perde. `billId` nunca existiu.**
3. **Leitura (dashboard):** `montar_serie_faturas_dashboard` soma os `movimento` do ciclo via `ciclo_do_movimento`. Como `billForecastDate` se perdeu, **o que decide a fatura é só a data deslocada + fechamento/vencimento**. O resultado é uma **previsão geométrica**, não uma previsão baseada no que o banco disse.
4. **PENDING → POSTED:** `atualizar_fatos_da_fonte` vira `status` e `statusFonte`, mas **não avalia alocação** — porque não existe alocação para avaliar, e `billId` (que chegaria no POSTED) **não é lido**.
5. **Parcelas futuras:** `completar_parcelas_projetadas` cria `lancai:proj:` como Fato. Quando a parcela real chega, a projetada é cancelada — mas a **previsão nunca foi CONFIRMED/PREDICTED/POSSIBLE**, é só uma linha cancelada.

**Consequência prática:** a fatura futura do dashboard é a soma de (a) compras PENDING sem evidência + (b) parcelas projetadas (`lancai:proj:`) + (c) parcelas reais já deslocadas pelo ciclo. Tudo isso **misturado com o mesmo peso**, sem classificação de confiança.

### C.3 Casos extremos (do requisito §34) — cobertura atual

| Caso | Cobertura atual | Como se comporta |
|---|---|---|
| 1. Compra hoje, PENDING, sem `billId` | ❌ Sem evidência | Vira `status='previsto'`, `statusFonte='pendente'`. `billForecastDate` pode não existir. Entra no ciclo pela data. |
| 2. Compra hoje, PENDING, `billForecastDate` = mês seguinte | ⚠️ Parcial | `data_movimento_parcela` só usa o forecast **se bater** com o ciclo; senão o ciclo manda. O forecast **não é persistido**. |
| 3. `billForecastDate` muda | ❌ Não rastreado | `atualizar_fatos_da_fonte` não compara forecast (não existe coluna). |
| 4. PENDING → POSTED | ⚠️ Parcial | `atualizar_fatos_da_fonte` vira status, mas **não reavalia alocação** (não existe). |
| 5. `billId` aparece posteriormente | ❌ **Ignorado** | `billId` não é lido no adaptador. |
| 6. Fatura fecha antes do previsto | ⚠️ Parcial | `fatura_oficial` é gravada com `totalAmount`; dashboard passa a usar `totalOficial`. Mas as linhas da fatura **não são reconciliadas** (não há alocação). |
| 7. Compra no dia do fechamento | ✅ | `competencia_ciclo_da_data`: `dia <= diaFecha` → mês do fecha. |
| 8. Compra após o fechamento | ✅ | `dia > diaFecha` → mês seguinte. |
| 9. Compra perto da meia-noite UTC/Brasil | ✅ | `dia_provedor_iso`, `dia_civil_iso`, `dia_movimento_avulsa`, `instante_do_movimento` tratam fuso. |
| 10. Compra internacional com timezone | ✅ | `valor_na_moeda_da_conta`, `instante_do_movimento`, `incorporar_iof_nas_compras`. |
| 11. Compra parcelada | ✅ (heuristicamente) | Cada parcela vira `movimento`; projeta faltantes com `lancai:proj:`. |
| 12. Todas as parcelas aparecem de uma vez | ✅ | `agrupar_series_parcelamento` junta; `planejar_parcelas_faltantes` não projeta nada. |
| 13. Parcelas aparecem mês a mês | ✅ (mas via Fato falso) | `completar_parcelas_projetadas` projeta as futuras. |
| 14. Parcela futura aparece sem `billId` | ⚠️ Parcial | Vira `movimento` `lancai:proj:` (Fato falso). |
| 15. Parcela futura já aparece vinculada | ❌ | `billId` não é lido. |
| 16. Uma parcela desaparece | ✅ | `remover_fatos_da_fonte` marca `removido`. |
| 17. Parcela desaparece e reaparece com outro ID | ⚠️ Parcial | `cancelar_projetadas_substituidas` + fingerprint reidentifica. Mas sem `billId`, a confirmação é frágil. |
| 18. Compra cancelada | ✅ | `remover_fatos_da_fonte` → `cancelado`. |
| 19. Estorno parcial | ✅ | Vira `receita`/`estorno` no cartão; `eh_linha_da_fatura` soma como crédito. |
| 20. Estorno total | ✅ | Igual, `valor_na_fatura` abate. |
| 21. Crédito na fatura | ✅ | `CREDITOS_DA_FATURA` (`receita`, `reembolso`, `estorno`) → `valor_na_fatura` negativo. |
| 22. IOF | ✅ | `incorporar_iof_nas_compras` soma à compra; IOF isolado viraria linha. |
| 23. Juros | ❌ | Não modelado como `BillAdjustment`; vira linha genérica. |
| 24. Anuidade | ❌ | Não modelada; vira linha. |
| 25. Tarifa | ❌ | Não modelada; vira linha. |
| 26. Câmbio | ⚠️ Parcial | `valor_na_moeda_da_conta` usa `amountInAccountCurrency`; variação cambial não é `adjustment`. |
| 27. Dois cartões na mesma conta | ✅ | `conta_financeira` + `open_finance_conta_externa` suportam. |
| 28. Cartão adicional | ⚠️ | `conta_financeira` agrupa; `cartao` **não tem `providerCardReference`/`cardType`** para distinguir. |
| 29. Cartão virtual | ⚠️ | Igual ao adicional. |
| 30. Duas compras no mesmo estabelecimento com mesmo valor | ⚠️ | `fingerprint` não é único (por design); desambiguação por `status`/`data`. |
| 31. Duas combinações diferentes com a mesma soma | ❌ | **Não usa Subset Sum** (bom), mas também não tem evidência para desempatar — sem `billId`, fica UNRESOLVED. |
| 32. Transação sem data suficiente | ⚠️ | `data_movimento_parcela` tem fallbacks (`compra`, `dateDia`, `forecast`). |
| 33. Transação sem `billForecastDate` | ⚠️ | Ciclo manda; sem evidência, vira heurística. |
| 34. Bill sem transactions inicialmente | ❌ | Não existe entidade de fatura aberta. |
| 35. Transactions chegando depois da criação da Bill | ❌ | Sem fatura aberta persistida, sem alocação. |
| 36. Webhook duplicado | ✅ | `UNIQUE(provedor, evento_id)` + `onConflictDoNothing`. |
| 37. Webhook fora de ordem | ⚠️ | Sem lock por conexão; `transactions/updated` antes de `created` → `desconhecidos` são criados depois. Idempotente por `idExterno`. |
| 38. Webhook chega antes do sync | ✅ | `atualizar_fatos_da_fonte` cria o desconhecido na alteração. |
| 39. Sync chega antes do webhook | ✅ | Idempotente por `idExterno`. |
| 40. Reprocessamento de evento | ⚠️ | `reprocessar_falhos` existe, mas sem retry counter / dead letter. |

---

## D. COMPARAÇÃO: ATUAL vs MODELO PROPOSTO

A tabela a seguir compara cada conceito. A coluna **ação** indica: `manter` (não mexer), `alterar` (estender/ajustar), `substituir` (trocar a forma de resolver), `criar` (nova entidade/módulo), `remover` (retirar).

| Conceito proposto | Existe hoje? | Onde/como | Ação |
|---|---|---|---|
| **CreditCard** (entidade explícita de cartão) | ⚠️ Parcial | `cartao` (unificado) + `conta_financeira` (identidade) | **Alterar** — adicionar `providerCardReference`, `maskedNumber`, `holder`, `cardType (titular/adicional/virtual)`, `metadata` |
| **Transaction** (fato financeiro puro) | ✅ | `movimento` (grupo Fato, imutável p/ OF) | **Manter** — já correto. Só **adicionar** colunas de evidência (`providerBillId`, `providerBillForecastDate`) e `installmentPlanId` |
| **BillAllocation** (vínculo transação↔fatura) | ❌ | Não existe — vínculo é implícito (`ciclo_do_movimento`) | **Criar** — tabela `bill_allocation` com `status`, `method`, `confidenceScore`, `validFrom/validTo/isCurrent`, `allocatedAmount` |
| **CreditCardBill** (fatura) | ⚠️ Parcial | `fatura_oficial` (só fechadas) | **Alterar** — estender para cobrir **abertas/futuras** (lifecycle/payment/reconciliation status, period, versão) e persistir previsão |
| **InstallmentPlan** | ❌ | Heurística `agrupar_series_parcelamento` (tempo de leitura) | **Criar** — tabela `installment_plan` com `fingerprint`, `providerInstallmentKey`, `totalAmount`, `totalInstallments`, `purchaseDate` |
| **InstallmentInstance** | ❌ | Parcelas soltas no `movimento` + `parcela` (manual) | **Criar** — tabela `installment_instance` com `isVirtual`, `providerTransactionId`, `transactionId`. **OF deixa de criar `movimento` falso** |
| **BillAdjustment** | ❌ | `ajuste = oficial − líquido` (na hora, não persistido) | **Criar** — tabela `bill_adjustment` com `type` (iof/juros/anuidade/tarifa/câmbio/…), `signedAmount` |
| **BillAuditLog** | ⚠️ Parcial | `auditoria` (genérica, só movimento) | **Criar** — `bill_audit_log` específico de fatura/alocação/previsão/reconciliação |
| **ProviderWebhookEvent (inbox)** | ✅ | `open_finance_evento` UNIQUE(provedor, evento_id) | **Manter** — já existe. **Melhorar** com dead letter/retry/métricas |
| **Bill Forecast Engine** | ❌ | Lógica espalhada (`ciclo_do_movimento`, `montar_serie_faturas_dashboard`) | **Criar** — engine separado, determinístico, com classificação e piso/central/teto |
| **Bill Reconciliation Engine** | ⚠️ Parcial | `montar_serie_faturas_dashboard` + `aplicar_total_oficial` | **Substituir/extrair** — separar do Forecast; usar `fatura_oficial` como autoridade |
| **Status previsão** (`CONFIRMED/PREDICTED/POSSIBLE/UNRESOLVED`) | ❌ | `status_fatura` (paga/parcial/em_aberto/aberta/prevista) | **Criar** — enum + lógica |
| **Hierarquia de evidências (L0–L6)** | ❌ | Ciclo local manda sobre forecast | **Criar** — `billId > billForecastDate > regra > histórico > matching > math_validation` |
| **Piso / Central / Teto** | ❌ | Valor único por fatura | **Criar** — computar e persistir |
| **Configuração por instituição** | ❌ | Regra global | **Criar** — `InstitutionCardBehavior` (closingDay, timezone, supportsBillId, supportsBillForecast, installmentBehavior, pendingBehavior, forecastBehavior) |

---

## E. TARGET ARCHITECTURE — ARQUITETURA FINAL RECOMENDADA

A filosofia central: **o provedor informa o que sabe; o LançAI infere apenas o que precisa; a previsão assume incerteza; a reconciliação busca certeza.**

```
                       ┌──────────────────────────┐
                       │      PLUGGY / PROVIDERS   │
                       └────────────┬─────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────┐
              │        PROVIDER ADAPTER (Pluggy)         │  ← único que conhece "pluggy" (ADR-011)
              │  Normaliza TransacaoPluggy →             │
              │  EventoFinanceiroNormalizado             │
              │  EXTRAI: billId, billForecastDate,       │  ← mudança: passar a extrair billId
              │  installmentNumber, totalInstallments,   │
              │  purchaseDate, cardNumber                 │
              │  NÃO decide alocação de fatura           │
              └────────────────────┬─────────────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────┐
              │      WEBHOOK INBOX (open_finance_evento) │  ← JÁ EXISTE
              │  UNIQUE(provider, eventId) = idempotência│
              │  Payload bruto 30 dias                   │
              │  Melhorias: status, attempts, nextRetry, │
              │  deadLetterAt, métricas                  │
              └────────────────────┬─────────────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────┐
              │        TRANSACTION ENGINE (Core)         │  ← MotorFinanceiro (mantém)
              │  Upsert movimento (Fato) por idExterno   │
              │  + fingerprint                           │
              │  Lifecycle: PENDING → POSTED → REMOVED   │
              │  GRAM: providerBillId, providerBillForecastDate, installment_plan_id
              │  NÃO decide fatura sozinho               │
              └──────────┬───────────────────────────────┘
                         │
        ┌────────────────┼───────────────────────────┐
        ▼                ▼                           ▼
┌──────────────┐ ┌──────────────┐        ┌──────────────────┐
│ INSTALLMENT  │ │   BILL       │        │ BILL RECONCILIA- │
│ ENGINE       │ │ FORECAST     │        │ TION ENGINE      │
│              │ │ ENGINE       │        │                  │
│ Detecta      │ │ Para cada    │        │ Fatura fechada:  │
│ parcelado    │ │ fatura       │        │ bill.totalAmount │
│ Cria Plan    │ │ aberta/      │        │ é autoridade     │
│ Cria         │ │ futura:      │        │                  │
│ Instances    │ │  hard        │        │ Σ allocations    │
│ virtual→real │ │  constraints │        │ + Σ adjustments  │
│ fingerprint  │ │  candidate   │        │ NÃO altera o     │
│              │ │  generation  │        │ total oficial    │
│              │ │  weighted    │        │                  │
│              │ │  matching    │        │                  │
│              │ │  classify    │        │                  │
│              │ │  piso/central│        │                  │
│              │ │  /teto       │        │                  │
└──────────────┘ └──────────────┘        └──────────────────┘
                         │
                         ▼
              ┌──────────────────────────────────────────┐
              │         BILL ALLOCATION ENGINE           │
              │  BillAllocation: transaction_id, bill_id,│
              │  status, method, confidenceScore,        │
              │  allocatedAmount, validFrom/validTo/     │
              │  isCurrent, history                      │
              └────────────────────┬─────────────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────────┐
              │          ADJUSTMENT ENGINE               │
              │  BillAdjustment: bill_id, type,          │
              │  signedAmount (pos=aumenta, neg=reduz)   │
              │  NÃO esconde UNRESOLVED                  │
              └────────────────────┬─────────────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────────┐
              │            AUDIT ENGINE                  │
              │  BillAuditLog: allocation/forecast/      │
              │  reconciliation/adjustment/manual,        │
              │  previous_state, new_state, origin, versão│
              └────────────────────┬─────────────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────────┐
              │           PERSISTÊNCIA (POSTGRES)        │
              │  credit_card (estende cartao)            │
              │  transaction (estende movimento)         │
              │  credit_card_bill (estende fatura_oficial)│
              │  bill_allocation (NOVA)                  │
              │  installment_plan (NOVA)                 │
              │  installment_instance (NOVA)             │
              │  bill_adjustment (NOVA)                  │
              │  bill_audit_log (NOVA)                   │
              │  provider_webhook_event (JÁ EXISTE)      │
              └──────────────────────────────────────────┘
```

**Regra de ouro:** o mesmo domínio base (`Transaction`/`movimento`). **Dois motores diferentes** — `Forecast` (fatura aberta/futura, assume incerteza) vs `Reconciliation` (fatura fechada, busca certeza).

---

## F. TARGET DATA MODEL — SCHEMA RECOMENDADO

> Esta é a modelagem conceitual. **Não vamos criar as migrations agora** — primeiro apresentamos o gap e o plano. As tabelas novas são as que corrigem o problema central.

### F.1 Relacionamentos (visão de entidades)

```
CreditCard (1) ─── (N) CreditCardBill (fatura, aberta ou fechada)
     │                      │
     │                      ├── (N) BillAllocation ── (1) Transaction
     │                      │            │
     │                      │            ├── histórico (validFrom/validTo/isCurrent)
     │                      │            └── allocatedAmount (snapshot)
     │                      ├── (N) BillAdjustment (signedAmount, type)
     │                      └── (N) BillAuditLog
     │
     ├── (N) InstallmentPlan ── (N) InstallmentInstance
     │                                      │
     │                                      ├── isVirtual (projetada) / real
     │                                      └── transaction_id (quando materializada)
     │
Transaction (movimento) ─── pode ter providerBillId / providerBillForecastDate
```

### F.2 `credit_card` (estende `cartao` — ou uma nova tabela separada)

Precisamos distinguir **cartão específico** dentro de uma conta, porque `accountId`/`contaId` não identifica um plástico específico (cartão adicional, virtual). A modelagem sugerida:

```sql
CREATE TABLE credit_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES conta_financeira(id),
  nome text NOT NULL,
  provider_card_reference text,      -- referência do cartão no provedor (cardNumber)
  masked_number text,
  holder text,
  card_type text NOT NULL DEFAULT 'titular',  -- 'titular' | 'adicional' | 'virtual'
  metadata jsonb NOT NULL DEFAULT '{}',
  limite numeric(14,2),
  saldo numeric(14,2) NOT NULL DEFAULT '0',
  fechamento integer,
  vencimento integer,
  melhor_dia_compra integer,
  perfil text NOT NULL,
  modalidade text NOT NULL DEFAULT 'credito',
  sincronizada boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  usuario_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_financeira_id, provider_card_reference)
);
```

**Nota:** o `cartao` atual é o destino local usado pelo `movimento` (`cartaoId`). Para minimizar migração, a recomendação pragmática é **estender `cartao`** com as colunas de referência do provedor e `card_type`, em vez de criar uma tabela paralela e trocar todas as FKs. (Isto é uma decisão de migração a ser confirmada na Fase 7.)

### F.3 `transaction` — estender `movimento`

```sql
-- ALTERAÇÕES EM movimento (não reescrever; adicionar colunas existentes)
ALTER TABLE movimento ADD COLUMN provider_bill_id text;
ALTER TABLE movimento ADD COLUMN provider_bill_forecast_date text;
ALTER TABLE movimento ADD COLUMN installment_plan_id uuid REFERENCES installment_plan(id);

CREATE INDEX idx_movimento_provider_bill_id ON movimento(provider_bill_id);
CREATE INDEX idx_movimento_installment_plan_id ON movimento(installment_plan_id);
```

**Semântica:** `providerBillForecastDate` é **evidência L1 (previsão)**, nunca tratada como verdade. `providerBillId` é **evidência L0 (confirmação)**.

### F.4 `credit_card_bill` — estender `fatura_oficial` para cobrir abertas/futuras

```sql
-- RENAME + ALTER, preservando dados
ALTER TABLE fatura_oficial RENAME TO credit_card_bill;

ALTER TABLE credit_card_bill
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'closed',   -- 'open' | 'closed'
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid',      -- 'unpaid' | 'partial' | 'paid'
  ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'unreconciled', -- 'unreconciled' | 'reconciled' | 'disputed'
  ADD COLUMN period_start date,
  ADD COLUMN period_end date,
  ADD COLUMN versao integer NOT NULL DEFAULT 1,
  -- projeção persistida (forecast)
  ADD COLUMN piso numeric(14,2),
  ADD COLUMN central numeric(14,2),
  ADD COLUMN teto numeric(14,2);

-- Backfill: para faturas fechadas existentes, period_start/period_end a partir
-- do fechamento do cartão e competencia.
```

**Nota:** `totalAmount` (`total`) **não muda de semântica** — continua sendo o total oficial do provedor. Para fatura **aberta**, `totalAmount` é `NULL` e a projeção vem de `piso/central/teto`.

### F.5 `bill_allocation` — O CORAÇÃO DA MUDANÇA

```sql
CREATE TABLE bill_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES movimento(id),
  bill_id uuid NOT NULL REFERENCES credit_card_bill(id),
  status text NOT NULL,                 -- 'confirmed' | 'predicted' | 'possible' | 'unresolved'
  method text NOT NULL,                 -- 'provider_bill_id' | 'provider_forecast' | 'rule_inferred' | 'historical_inferred' | 'matching' | 'math_validation' | 'unresolved'
  confidence_score integer,             -- 0-100, INFORMATIVO apenas (não é verdade)
  allocated_amount numeric(14,2),       -- snapshot do valor alocado (fotografia da reconciliação)
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  is_current boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Uma transação tem apenas UMA alocação atual por fatura
CREATE UNIQUE INDEX bill_allocation_current_unico
  ON bill_allocation(transaction_id, bill_id)
  WHERE is_current;
```

**Histórico:** quando uma transação prevista para Outubro é confirmada em Novembro, a alocação atual muda para a nova fatura (`is_current=false` na antiga, `is_current=true` na nova), preservando o histórico.

### F.6 `installment_plan` / `installment_instance`

```sql
CREATE TABLE installment_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  credit_card_id uuid NOT NULL REFERENCES cartao(id),
  description text NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  total_installments integer NOT NULL,
  purchase_date date NOT NULL,
  provider_installment_key text,        -- heurística de agrupamento (NÃO é identidade absoluta)
  fingerprint text NOT NULL,            -- hash determinístico para correlação
  provider_metadata jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE installment_instance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES installment_plan(id),
  installment_number integer NOT NULL,
  amount numeric(14,2) NOT NULL,
  due_date date NOT NULL,
  is_virtual boolean NOT NULL DEFAULT true,   -- true = projetada, false = real do provider
  provider_transaction_id text,               -- idExterno da transação real
  transaction_id uuid REFERENCES movimento(id), -- quando materializada
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, installment_number)
);
```

**Conceito:** compra 6x R$100 → `InstallmentPlan` (1 plano) + 6 `InstallmentInstance`. As futuras nascem `isVirtual=true` (projetadas, **sem** criar `movimento`). Quando o provedor envia a parcela real, a instância virtual é **materializada** (`isVirtual=false`, `transactionId`, `providerTransactionId`) — sem criar uma segunda parcela paralela.

### F.7 `bill_adjustment`

```sql
CREATE TABLE bill_adjustment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES credit_card_bill(id),
  type text NOT NULL,   -- 'unexplained_difference' | 'fee' | 'interest' | 'iof' | 'exchange_variation' | 'finance_charge' | 'credit' | 'other'
  amount numeric(14,2) NOT NULL,   -- SIGNED: positivo = aumenta fatura, negativo = reduz
  description text,
  source_transaction_id uuid REFERENCES movimento(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES usuario(id)
);
```

**Regra crítica:** `UNEXPLAINED_DIFFERENCE` **só** surge quando há diferença real entre o total oficial e os componentes explicados (Σ allocations + Σ outros adjustments). **Transação não localizada → `UNRESOLVED`, NUNCA vira adjustment.**

### F.8 `bill_audit_log`

```sql
CREATE TABLE bill_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid REFERENCES credit_card_bill(id),
  allocation_id uuid REFERENCES bill_allocation(id),
  adjustment_id uuid REFERENCES bill_adjustment(id),
  action text NOT NULL,  -- 'allocation_changed' | 'forecast_updated' | 'reconciled' | 'adjusted' | 'manual_intervention'
  previous_state jsonb,
  new_state jsonb,
  origin text NOT NULL,  -- 'system' | 'provider' | 'user' | 'llm_explanation'
  versao integer,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES usuario(id)
);
```

---

## G. FUTURE BILL ENGINE — ALGORITMO COMPLETO

O `Bill Forecast Engine` **não tenta provar a verdade final**. Ele responde: *"com os dados disponíveis agora, qual é a melhor previsão para cada fatura aberta/futura?"* A saída é classificável e produz **piso/central/teto**.

### G.1 Visão geral do fluxo

```
load bills (abertas/futuras)  →  para cada cartão, os ciclos a partir de hoje
        ↓
load open transactions (movimentos não cancelados, PENDING/POSTED sem billId, previstos)
        ↓
provider evidence (L0 billId / L1 billForecastDate)
        ↓
hard constraints (eliminar candidatos impossíveis)
        ↓
candidate generation (para cada transação, lista de faturas possíveis)
        ↓
weighted matching (escolher melhor fatura, com tie-breakers)
        ↓
classification (CONFIRMED / PREDICTED / POSSIBLE / UNRESOLVED)
        ↓
floor / central / ceiling
        ↓
persist projection (piso/central/teto na credit_card_bill)
```

### G.2 Pseudo-fluxo (baseado no desenho do requisito, adaptado ao domínio do LançAI)

```typescript
async function prever_faturas_abertas(
  cartaoId: string,
  hoje: Date,
): Promise<PrevisaoFatura[]> {
  // 1. Carregar faturas abertas/futuras do cartão (ciclos a partir do ciclo aberto)
  const ciclos = ciclos_abertos_futuros(cartaoId, hoje); // ex.: out, nov, dez, jan...

  // 2. Carregar transações candidatas
  const candidatas = await listar_movimentos_candidatos(cartaoId);
  //  Filtro: status != 'cancelado', statusFonte != 'removido', eh_linha_da_fatura

  // 3. Extrair evidência do provedor
  const evidencias = candidatas.map((tx) => ({
    tx,
    billId: tx.providerBillId,             // L0 (pode ser null)
    forecast: tx.providerBillForecastDate, // L1 (YYYY-MM, pode ser null)
    parcela: tx.parcelaNumero,             // para deslocar ciclo
    data: tx.dataMovimento,
  }));

  // 4. Hard constraints (elimina candidatos impossíveis)
  //   - cartão incompatível (mesmo cartaoId)
  //   - período impossível (data fora do intervalo do ciclo, já validada na query)
  //   - status incompatível (cancelado/removido)
  //   - parcela incompatível (numero > total)
  //   - provider bill conflitante (billId aponta outra fatura)
  //   - fatura fechada incompatível (não reabre)
  //   - timezone/data incompatível

  // 5. Candidate generation
  const candidatos: CandidatoAlocacao[] = [];
  for (const tx of evidencias) {
    const faturasPossiveis = faturas_para_lancamento(tx, ciclos);
    for (const fatura of faturasPossiveis) {
      candidatos.push({ tx, fatura, metodo: metodo_para(tx, fatura), score: score_para(tx, fatura) });
    }
  }

  // 6. Weighted matching
  const alocacoes = weighted_matching(candidatos);
  //  Tie-breakers:
  //   1. maior methodScore
  //   2. menor distância temporal
  //   3. parcela número 1 tem prioridade
  //   4. histórico do banco (InstitutionCardBehavior)

  // 7. Classification
  //  CONFIRMED  = method = PROVIDER_BILL_ID
  //  PREDICTED  = method = PROVIDER_FORECAST (billForecastDate bate com o ciclo)
  //  POSSIBLE   = method in (RULE_INFERRED, HISTORICAL_INFERRED, MATCHING) com score >= 50
  //  UNRESOLVED = tudo o mais (sem evidência)

  // 8. Piso / Central / Teto
  //  PISO   = Σ CONFIRMED
  //  CENTRAL = Σ CONFIRMED + Σ PREDICTED
  //  TETO   = Σ CONFIRMED + Σ PREDICTED + Σ POSSIBLE
  //  UNRESOLVED NUNCA entra (não é certeza)

  // 9. Persistir projeção
  await persistir_previsao(ciclos, piso, central, teto);
}
```

### G.3 Diagrama de classificação

```
Evidência disponível                          →  Status        →  Method
──────────────────────────────────────────────    ─────────       ──────────────
providerBillId = "bill-123" (+ POSTED)        →  CONFIRMED     →  PROVIDER_BILL_ID
providerBillForecastDate = "2026-10" (bate)   →  PREDICTED     →  PROVIDER_FORECAST
regra do ciclo local aplicada com força       →  POSSIBLE      →  RULE_INFERRED
histórico do usuário (mesma compra no mês X)  →  POSSIBLE      →  HISTORICAL_INFERRED
matching por descrição/valor                  →  POSSIBLE      →  MATCHING
sem evidência / conflito                      →  UNRESOLVED    →  UNRESOLVED
```

### G.4 Property: `billForecastDate` é `PROVIDER_FORECAST`, nunca `PROVIDER_CONFIRMED`

- **L0 (billId):** autoridade. Se existe, a alocação é `CONFIRMED`.
- **L1 (billForecastDate):** forte indicação de previsão, mas **não é verdade final**. Vira `PREDICTED`.
- **L2 (regra determinística):** ciclo local do cartão. Vira `POSSIBLE`/`PREDICTED` conforme a força.
- **L3 (padrão histórico):** mesmo cartão/estabelecimento/mês recorrente. `POSSIBLE`.
- **L4 (matching):** descrição/valor/série. `POSSIBLE`.
- **L5 (math validation / subset sum):** **somente como validação excepcional ou desempate de subconjunto pequeno. NUNCA como autoridade.**
- **L6 (UNRESOLVED):** sem evidência. **Nunca vira adjustment.**

### G.5 Performance

- **Incremental:** quando uma transação é criada/atualizada, identificar **apenas as faturas afetadas** (cartão + ciclo) e recalcular só elas. Não recalcular toda a base.
- Definir índices: `movimento(cartaoId, dataMovimento)`, `movimento(providerBillId)`, `bill_allocation(bill_id, is_current)`.
- Projeção (`piso/central/teto`) **persistida** na `credit_card_bill` para leitura barata no dashboard; o engine **recalcula** quando há evento.

---

## H. CLOSED BILL ENGINE — PRESERVAÇÃO DO EXISTENTE

**Regra: NÃO alterar o que já funciona.** A fatura fechada deve continuar usando `totalAmount` como autoridade.

```typescript
function reconciliar_fatura_fechada(fatura: CreditCardBill): ResultadoReconciliacao {
  // 1. Autoridade = total oficial do provedor
  const totalOficial = fatura.totalAmount; // NUNCA é alterado

  // 2. Componentes explicados (persistidos em bill_allocation)
  const alocacoes = await listar_alocacoes(fatura.id, { status: 'confirmed' });
  const ajustes = await listar_ajustes(fatura.id);

  const explicado = sum(alocacoes.map((a) => a.allocatedAmount))
                  + sum(ajustes.map((a) => a.amount));

  // 3. Diferença
  const diferenca = totalOficial - explicado;

  // 4. Se |diferença| > tolerância → cria BillAdjustment UNEXPLAINED_DIFFERENCE
  //    NÃO altera totalAmount
  //    NÃO cria transação fantasma
  //    NÃO vira UNRESOLVED automaticamente (só se não houver explicação)

  return { totalOficial, explicado, diferenca, reconciliada: Math.abs(diferenca) <= 0.01 };
}
```

**Migração: as faturas fechadas existentes** (`fatura_oficial`) viram `credit_card_bill` com `lifecycle_status='closed'` e `reconciliation_status='reconciled'` **sem reprocessar nada**. As alocação são **backfilled** (job assíncrono) para que a fotografia da reconciliação fique persistida — mas **a lógica de exibição não muda**.

**Decisão de camada:** manter `montar_serie_faturas_dashboard`/`aplicar_total_oficial` como a **leitura** de fatura fechada; o `Bill Reconciliation Engine` passa a **persistir** a composição (alocações + ajustes) e validar a igualdade. Os dois coexistem.

---

## I. INSTALLMENT ENGINE — VIRTUAL → REAL

### I.1 Detecção do plano

Quando chega uma transação com `creditCardMetadata` de parcelamento (`installmentNumber` + `totalInstallments`):

1. Calcula `fingerprint` heurístico a partir de `cartaoId + purchaseDate + totalInstallments + totalAmount + merchant` (normalizado).
2. Procura `installment_plan` por `fingerprint`.
3. Se não existe, **cria** o plano e **cria N instâncias** (1..N) como `isVirtual=true`, com `dueDate` calculada pelo ciclo do cartão (`data_movimento_parcela`).
4. **NÃO cria `movimento` falso.** A instância virtual é apenas uma projeção; não entra no extrato/relatório como Fato.

### I.2 Materialização (virtual → real)

Quando o provedor envia a parcela real (com `idExterno` novo):

1. Localiza a `installment_instance` correspondente (por `plan_id` + `installment_number`).
2. Atualiza a instância: `isVirtual=false`, `providerTransactionId=idExterno`, `transactionId=movimento.id`, `amount` (valor real), `dueDate` (data do provedor).
3. **Não cria uma segunda parcela** — a mesma instância deixa de ser virtual.
4. Cria/atualiza `bill_allocation` com a evidência disponível (`billId` → CONFIRMED; senão `billForecastDate` → PREDICTED).

### I.3 Correlação delete/recreate

Os "órfãos" (`lancai:proj:` cancelados) são substituídos pela instância real. O `fingerprint` (hash de série) é a **chave de correlação** — mas **não é identidade absoluta**: é uma heurística auditável, e as evidências L0/L1 têm prioridade sobre ele.

---

## J. WEBHOOK ARCHITECTURE

### J.1 O que já existe (bom)

```sql
CREATE TABLE open_finance_evento (
  id uuid PRIMARY KEY,
  provedor text NOT NULL,
  evento_id text NOT NULL,
  tipo text NOT NULL,
  payload jsonb NOT NULL,
  processado_em timestamptz,
  erro text,
  data_criacao timestamptz DEFAULT now(),
  UNIQUE (provedor, evento_id)
);
```

- Idempotência: `UNIQUE(provedor, evento_id)` + `onConflictDoNothing` (resolvido pelo banco, não por "check-then-insert").
- Payload bruto preservado 30 dias (anonimização).
- `reprocessar_falhos()` para eventos com `erro`.

### J.2 Melhorias necessárias

| Melhoria | Implementação |
|---|---|
| **Status do evento** | `status` (`received`\|`processing`\|`processed`\|`failed`\|`dead_letter`) |
| **Retry counters** | `tentativas integer`, `proximo_retry timestamptz`, `dead_letter_em timestamptz` |
| **Dead letter** | Cron que move evento com `tentativas >= MAX` para `dead_letter_em` |
| **Ordenação** | Processar por `data_criacao ASC`; garantir que `transactions/updated` processado antes de `created` do mesmo ID (quando aplicável) |
| **Lock por conexão** | Evitar processamento concorrente do mesmo `itemId` (usar `pg_advisory_xact_lock` ou `lock-sync-conexao.ts` já existente) |
| **Métricas** | Contadores por provedor/tipo: received, processed, failed, retried, dead_letter |

### J.3 Fluxo robusto

```
Webhook recebido
  ↓
Auth (X-Lancai-Webhook, timing-safe)
  ↓
ServicoIngestaoOpenFinance.receber()
  → grava payload bruto em open_finance_evento (idempotente via UNIQUE)
  → responde 2XX imediato (provedor retenta se >5s)
  ↓
Se novo:
  → lock por conexao
  → processar(payload)
     → reinterpretar payload
     → se transactions/updated: coletar_por_ids (recoleta estado atual)
     → montar_eventos → EventoFinanceiroNormalizado
     → MotorFinanceiro.ingerir_eventos / atualizar_fatos_da_fonte / remover_fatos_da_fonte
     → (NOVO) recalcular previsões afetadas: forecastEngine.recalcular(cartaoId, ciclosAfetados)
     → (NOVO) atualizar alocação se billId/forecast mudou
     → marcar processado ou erro
  ↓
Se erro:
  → gravar erro + tentativas++;
  → cron de reprocesso tenta de novo até limite; depois dead letter.
```

---

## K. MIGRATION PLAN

> **Só apresentamos após a comparação (D).** Termos decidido que o vetor é **AJUSTAR**, não reescrever. As migrations foram projetadas para **não perder dados** e **não reprocessar faturas fechadas**.

### K.1 Gap Analysis (schema atual → target)

| Tabela atual | Tabela target | Ação | Risco | Compatibilidade |
|---|---|---|---|---|
| `cartao` | `credit_card` (nova) | **Alterar** (estender) OU criar paralela + swap FK | **Médio** | View de compatibilidade |
| `fatura_oficial` | `credit_card_bill` | **ALTER + RENAME + ADD COLUMNS** | **Baixo** | Dados preservados |
| `movimento` | `transaction` (conceito) | **ADD COLUMNS** (providerBillId, providerBillForecastDate, installmentPlanId) | **Baixo** | Nullable, sem quebra |
| — | `bill_allocation` | **CREATE TABLE** | **Baixo** | Nova, sem dados legacy |
| — | `installment_plan` | **CREATE TABLE** | **Baixo** | Nova |
| — | `installment_instance` | **CREATE TABLE** | **Baixo** | Nova |
| — | `bill_adjustment` | **CREATE TABLE** | **Baixo** | Nova |
| — | `bill_audit_log` | **CREATE TABLE** | **Baixo** | Nova |
| `open_finance_evento` | `provider_webhook_event` | **RENAME + ADD COLUMNS** | **Baixo** | Dados preservados |

### K.2 Plano de migrações (ordem, sem gerar agora)

**MIGRAÇÃO 1 — `bill_allocation` (nova, sem dados legacy)**
```sql
CREATE TABLE bill_allocation (...);
-- + índices
```

**MIGRAÇÃO 2 — `installment_plan` / `installment_instance` (novas)**
```sql
CREATE TABLE installment_plan (...);
CREATE TABLE installment_instance (...);
```

**MIGRAÇÃO 3 — `bill_adjustment` (nova)**
```sql
CREATE TABLE bill_adjustment (...);
```

**MIGRAÇÃO 4 — `bill_audit_log` (nova)**
```sql
CREATE TABLE bill_audit_log (...);
```

**MIGRAÇÃO 5 — estender `movimento` com evidências**
```sql
ALTER TABLE movimento ADD COLUMN provider_bill_id text;
ALTER TABLE movimento ADD COLUMN provider_bill_forecast_date text;
ALTER TABLE movimento ADD COLUMN installment_plan_id uuid REFERENCES installment_plan(id);
CREATE INDEX idx_movimento_provider_bill_id ON movimento(provider_bill_id);
CREATE INDEX idx_movimento_installment_plan_id ON movimento(installment_plan_id);
```

**MIGRAÇÃO 6 — estender `fatura_oficial` → `credit_card_bill`**
```sql
ALTER TABLE fatura_oficial RENAME TO credit_card_bill;
ALTER TABLE credit_card_bill ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'closed';
ALTER TABLE credit_card_bill ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid';
ALTER TABLE credit_card_bill ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'reconciled';
ALTER TABLE credit_card_bill ADD COLUMN versao integer NOT NULL DEFAULT 1;
ALTER TABLE credit_card_bill ADD COLUMN period_start date;
ALTER TABLE credit_card_bill ADD COLUMN period_end date;
-- Backfill period_start/period_end a partir do fechamento do cartão + competencia
```

**MIGRAÇÃO 7 — `credit_card` (nova)**
```sql
CREATE TABLE credit_card (...);
INSERT INTO credit_card SELECT ... FROM cartao;
-- View de compatibilidade para código legado
```

**MIGRAÇÃO 8 — Backfill `bill_allocation` para faturas fechadas (RISCO MÉDIO)**
```sql
-- Job assíncrono, idempotente, com dry-run
-- Para cada fatura fechada:
--   Para cada movimento do ciclo → INSERT bill_allocation(status='confirmed', method='provider_bill_id')
--   Se Σ allocations != totalOficial → INSERT bill_adjustment(unexplained_difference)
-- Validar: Σ allocations + Σ adjustments == total_amount para cada fatura
```

**MIGRAÇÃO 9 — Backfill `installment_plan`/`installment_instance`**
```sql
-- Usar agrupar_series_parcelamento() para detectar planos
-- Criar instâncias virtuais para parcelas futuras não materializadas
-- (Este passo substitui a criação de movimentos `lancai:proj:` — os existentes são
--  marcados como legado/ignoráveis, e a projeção passa a vir das instâncias virtuais)
```

### K.3 Riscos e compatibilidade de migração

| Migração | Dados atuais | Migração necessária | Risco | Rollback |
|---|---|---|---|---|
| 1-4 (tabelas novas) | — | — | **Baixo** | DROP TABLE |
| 5 (ADD COLUMNs em movimento) | Colunas nullable | SQL instantâneo (Postgres ADD COLUMN é metadata-only p/ default null) | **Baixo** | DROP COLUMN |
| 6 (rename + add) | `fatura_oficial` | RENAME é metadata-only; ADD COLUMNs com DEFAULT são rápidas | **Baixo** | RENAME de volta + DROP COLUMN |
| 7 (credit_card) | `cartao` | INSERT SELECT | **Médio** | DROP TABLE + view |
| 8 (backfill allocation p/ fechadas) | ~100k-1M movimentos | Job assíncrono idempotente | **Médio** | TRUNCATE bill_allocation |
| 9 (backfill installment) | `lancai:proj:` + parcelas | Job assíncrono | **Médio** | TRUNCATE installment_plan/instance |

**Princípio:** faturas fechadas **não são reprocessadas**; a lógica de exibição (`aplicar_total_oficial`, `somar_pagamentos_fatura`) permanece idêntica. O backfill de alocação é **aditivo**: cria o vínculo explícito, mas o dashboard continua lendo `fatura_oficial`/`aplicar_total_oficial` até a migração completa.

### K.4 Estratégia de coexistência (legacy fechada × novo forecast)

```
closed bills  →  preservadas (fatura_oficial → credit_card_bill lifecycle=closed)
future/open   →  passam pelo novo Bill Forecast Engine
```

Até que o novo domínio assuma integralmente, `montar_serie_faturas_dashboard` lê:
- fatura fechada: via `fatura_oficial` (autoridade).
- fatura aberta/futura: via `bill_forecast` (piso/central/teto) quando disponível; senão, cai na soma das linhas do ciclo (compatibilidade).

---

## L. TEST PLAN

### L.1 Testes unitários — Bill Forecast Engine

```typescript
describe('BillForecastEngine', () => {
  // Hierarquia de evidências
  it('L0: providerBillId → CONFIRMED / PROVIDER_BILL_ID', () => { ... });
  it('L1: providerBillForecastDate → PREDICTED / PROVIDER_FORECAST', () => { ... });
  it('L2: regra do ciclo local → POSSIBLE / RULE_INFERRED', () => { ... });
  it('L6: sem evidência → UNRESOLVED (não vira adjustment)', () => { ... });

  // Hard constraints
  it('Rejeita cartão incompatível', () => { ... });
  it('Rejeita fatura fechada sem billId', () => { ... });
  it('Rejeita transação cancelada/removida', () => { ... });
  it('Respeita providerBillId conflitante', () => { ... });

  // Piso / Central / Teto
  it('Calcula piso/central/teto corretamente', () => {
    // CONFIRMED=2000, PREDICTED=700, POSSIBLE=300, UNRESOLVED=500
    // → { piso:2000, central:2700, teto:3000 } (UNRESOLVED fora)
  });

  // PENDING → POSTED
  it('PREDICTED → CONFIRMED quando providerBillId chega', () => { ... });

  // Parcelas
  it('Cria InstallmentPlan + N InstallmentInstance virtual (sem movimento)', () => { ... });
  it('Materializa virtual → real sem duplicar', () => { ... });
  it('Projeta parcelas faltantes com datas corretas', () => { ... });
});
```

### L.2 Testes de integração — Pluggy → Forecast

```typescript
describe('Integração Pluggy → Forecast', () => {
  it('Caso 1: compra hoje PENDING sem billId → UNRESOLVED ou POSSIBLE', () => { ... });
  it('Caso 2: compra hoje PENDING com billForecastDate mês seguinte → PREDICTED', () => { ... });
  it('Caso 3: billForecastDate muda → previsão é recalculada', () => { ... });
  it('Caso 4: PENDING → POSTED com billId → CONFIRMED', () => { ... });
  it('Caso 11: compra parcelada 6x → cria 1 plan + 6 instances', () => { ... });
  it('Caso 12: todas as parcelas de uma vez → sem duplicação', () => { ... });
  it('Caso 13: parcelas mês a mês → virtual → real', () => { ... });
  it('Caso 14: parcela futura sem billId → POSSIBLE/PREDICTED', () => { ... });
  it('Caso 17: parcela desaparece e reaparece com outro ID → correlação por fingerprint', () => { ... });
  it('Caso 20: estorno total → abate da fatura', () => { ... });
  it('Caso 22-26: IOF/juros/anuidade/tarifa/câmbio → BillAdjustment', () => { ... });
  it('Caso 36-39: webhook duplicado/fora de ordem/antes/depois do sync', () => { ... });
  it('Caso 40: reprocessamento idempotente', () => { ... });
});
```

### L.3 Testes de regressão — Faturas fechadas (OBRIGATÓRIO)

```typescript
describe('Regression: Closed Bills Unchanged', () => {
  it('Fatura fechada mantém total oficial', () => { ... });
  it('Conciliação: totalOficial = Σ allocations + Σ adjustments', () => { ... });
  it('Pagamento no intervalo fecha→vence ainda funciona', () => { ... });
  it('Status paga/parcial/em_aberto inalterados', () => { ... });
  it('Dashboard fatura fechada mostra mesmo valor', () => { ... });
  it('Ciclo_do_movimento e na_fatura_do_recorte inalterados', () => { ... });
});
```

### L.4 Testes com dados reais anonimizados

- Exportar subset de produção (anonimizado).
- Rodar `BillForecastEngine` e comparar com as faturas fechadas reais.
- Validar: **piso ≤ real ≤ teto** em >95% dos casos.
- Validar: para faturas fechadas, `Σ allocations + Σ adjustments == total_amount` (tolerância: 0,01).

---

## M. RESPOSTAS AO VEREDITO OBRIGATÓRIO

### 1. A arquitetura atual deve ser: **AJUSTADA** (não reescrita)

- **~85% funciona** e é sólido: faturas fechadas (autoridade `total_amount`), pagamentos (intervalo fecha→vence), ciclo do cartão, parcelamento manual, webhook inbox idempotente, fingerprint, imutabilidade do Fato (ADR-009), separação Fato/Conhecimento, múltiplos cartões por `conta_financeira`, IOF, crédito de quitação.
- **~15% está quebrado** e é pontual: falta `BillAllocation`, falta fatura aberta/futura persistida, falta `InstallmentPlan/Instance`, falta `BillForecastEngine` separado, falta classificação de confiança, falta `billId` no adaptador.
- **Reescrever** quebraria o que funciona (faturas fechadas) com risco desnecessário. **Manter como está** deixaria o problema das faturas futuras sem solução.
- **AJUSTAR** é o caminho: adicionar as entidades que faltam, extrair `billId`/`billForecastDate`, criar o `Forecast Engine`, manter o `Reconciliation` e as faturas fechadas intactas.

### 2. A parte de fatura fechada precisa ser alterada? **NÃO** (apenas migração de dados)

- A **lógica** não muda: `fatura_oficial.total` é autoridade; `aplicar_total_oficial` mantém o comportamento; `somar_pagamentos_fatura` idem.
- A **migração de dados**: `fatura_oficial` → `credit_card_bill` com `lifecycle_status='closed'`, `payment_status`/`reconciliation_status` preenchidos; backfill aditivo de `bill_allocation` para as faturas fechadas (job assíncrono, idempotente, dry-run).
- **Não** há necessidade de reescrever `montar_serie_faturas_dashboard` para fatura fechada — apenas garantir que a leitura continue idêntica.

### 3. O problema principal das faturas futuras está em: **MODELAGEM + ALLOCATION** (com DATA como sintoma)

Escolha entre as opções: `DATA` é apenas o **sintoma** (a data deslocada é o mecanismo atual). A **causa-raiz** é:

- **`MODELAGEM`**: não existe `BillAllocation`, `CreditCardBill` aberta, `InstallmentPlan/Instance`. O vínculo transação↔fatura é implícito, calculado na leitura, sem histórico.
- **`ALLOCATION`**: `billId` é ignorado (nem existe no tipo Pluggy), `billForecastDate` é descartado (só vira input de data), não há hierarquia de evidências nem status de previsão.
- **Adicionalmente**, as parcelas futuras são materializadas como **transações falsas** (`lancai:proj:`), o que agrava a poluição do ledger.

**Resposta:** o problema principal é **MODELAGEM + ALLOCATION** (com `DATA` como consequência).

### 4. O modelo `Transaction + BillAllocation + CreditCardBill` resolve o isolamento Movimento/Fatura? **SIM**

- **Transaction** (movimento) = fato financeiro imutável (grupo Fato, trigger).
- **BillAllocation** = vínculo mutável com `status`/`method`/`confidenceScore`, `validFrom`/`validTo`/`isCurrent`, `allocatedAmount` — preservando histórico.
- **CreditCardBill** = container da cobrança (oficial/prevista), com `lifecycle`/`payment`/`reconciliation` status separados.
- **Isso permite:** a mesma transação prevista em Outubro ser confirmada em Novembro **sem perder o histórico**. A alocação atual muda (`valid_to` na antiga, nova `isCurrent`), mas o rastro permanece.

### 5. `InstallmentPlan + InstallmentInstance` é adequado? **SIM**

- Resolve o problema de "parcelas futuras **não geram transactions falsas**" (`isVirtual=true`, sem `movimento`).
- Resolve "virtual → real **sem duplicata**" (mesma instância vira `isVirtual=false`, com `transactionId`).
- Resolve "sem ID universal do provider" via `fingerprint` heurístico (auditável, não é identidade absoluta).
- Mantém a tabela `parcela` para **lançamentos manuais** (não mistura origens).

### 6. `WebhookInbox` é necessário? **JÁ EXISTE** (open_finance_evento)

- Idempotência: `UNIQUE(provedor, evento_id)`.
- Precisa de melhorias (não criação): `status` (`received/processing/processed/failed/dead_letter`), `tentativas`/`proximo_retry`/`dead_letter_em`, **lock por conexão** para eventos fora de ordem, **métricas**.

### 7. `BillAdjustment` está corretamente definido? **SIM, com ressalva de enforcement**

- **Signed amount** (positivo = aumenta fatura, negativo = reduz) ✅.
- **Tipos** (`UNEXPLAINED_DIFFERENCE`, `FEE`, `INTEREST`, `IOF`, `EXCHANGE_VARIATION`, `FINANCE_CHARGE`, `CREDIT`, `OTHER`) ✅.
- **Ressalva:** a regra "transação não identificada → `UNRESOLVED`, não `Adjustment`" precisa ser **enforçada por código** (não por disciplina): o `AdjustmentEngine` não deve ter permissão de criar `UNEXPLAINED_DIFFERENCE` a partir de uma transação não alocada; só de uma diferença real entre `totalAmount` e componentes explicados.

### 8. Há alguma migration perigosa? **SIM: Migração 8 (backfill de allocation para faturas fechadas)**

- **Risco médio.** Precisa ser **job assíncrono, idempotente, com dry-run** e validação `Σ allocations + Σ adjustments == total_amount` para cada fatura.
- **Rollback:** TRUNCATE `bill_allocation`.
- As demais são **baixo risco** (ADD COLUMN nullable, RENAME metadata-only, CREATE TABLE).

### 9. Existe risco de regressão nas faturas fechadas? **NÃO**, se os pré-requisitos forem atendidos

- **Não** alterar a leitura atual (`montar_serie_faturas_dashboard` + `aplicar_total_oficial`).
- **Migração 8** validada com `aplicar_total_oficial()` resultando no mesmo valor.
- **`BillReconciliationEngine`** usando a mesma lógica.
- **Testes de regressão (L.3)** passando em CI antes de cada mudança.

### 10. Qual é o menor conjunto de mudanças necessário para corrigir as faturas futuras?

| Prioridade | Mudança | Esforço | Dependência |
|---|---|---|---|
| **P0** | Criar tabela `bill_allocation` + `bill_audit_log` | 1-2 dias | — |
| **P0** | Estender `movimento` com `provider_bill_id` / `provider_bill_forecast_date` | 0,5 dia | Tabela nova |
| **P0** | Extrair `billId` + `billForecastDate` no `AdaptadorPluggy.traduzir_transacao` e persistir nas colunas novas | 1 dia | Colunas novas |
| **P0** | Criar `BillForecastEngine` separado (extrai de `montar_serie_faturas_dashboard`) | 3-5 dias | Colunas novas |
| **P1** | Implementar classificação `CONFIRMED/PREDICTED/POSSIBLE/UNRESOLVED` | 2 dias | Engine |
| **P1** | Implementar Piso/Central/Teto no dashboard | 2 dias | Engine |
| **P1** | Criar `installment_plan` + `installment_instance` e parar de criar `movimento` `lancai:proj:` | 3-4 dias | Tabelas novas |
| **P2** | Estender `cartao` com `providerCardReference`/`cardType`/adicional/virtual | 2 dias | Tabela |
| **P2** | `BillAdjustment` + `BillAuditLog` | 2 dias | Tabelas novas |
| **P2** | Melhorias no webhook inbox (dead letter, lock, retry) | 1-2 dias | Evento |

**Total estimado: ~17-21 dias de engenharia** (sem QA/testes em produção).

---

## N. CRITÉRIO DE APROVAÇÃO (checklist)

| Critério | Estado atual | Ação |
|---|---|---|
| [x] Faturas fechadas continuam preservadas | ✅ | Preservar leitura; migração aditiva |
| [ ] Faturas futuras possuem Forecast Engine separado | ❌ | Criar `BillForecastEngine` |
| [ ] `billId` é autoridade quando disponível | ❌ | Extrair no adaptador + usar no engine |
| [ ] `billForecastDate` é tratado como previsão (L1) | ⚠️ Parcial | Hierarquia L0 > L1 > L2… |
| [ ] PENDING e POSTED tratados corretamente | ⚠️ Parcial | Atualização deve virar CONFIRMED |
| [ ] Parcelas futuras não geram transactions falsas | ⚠️ Parcial | `isVirtual` em `installment_instance` |
| [ ] Virtual → real é possível | ⚠️ Parcial | `materialize` |
| [ ] `UNRESOLVED` é separado de `Adjustment` | ❌ | Enforcar no AdjustmentEngine |
| [ ] Score não é confundido com verdade | ❌ | `status`/`method`/`score` separados |
| [ ] Webhook é idempotente | ✅ | Já existe |
| [ ] Eventos fora de ordem são suportados | ⚠️ Parcial | Lock por conexão + ordenação |
| [ ] Delete/recreate é tratado | ⚠️ Parcial | Fingerprint reidentifica |
| [ ] Múltiplos cartões são suportados | ✅ | `conta_financeira` |
| [ ] Histórico de alterações é preservado | ⚠️ Parcial | `bill_audit_log` + `valid_from/valid_to` |
| [ ] Reconciliação fechada continua funcionando | ✅ | Preservar lógica |
| [ ] LLM não participa da determinação financeira | ✅ | Já isolado (ADR-012) |
| [ ] Migrations não perdem dados | ✅ | Plano com rollback |
| [ ] Testes cobrem casos extremos | ❌ | Implementar plano L |
nio do LançAI):

```typescript
async function prever_faturas_abertas(
  cartaoId: string,
  hoje: Date,
): Promise<PrevisaoFatura[]> {
  // 1. Carregar faturas abertas/futuras do cartão (ciclos a partir do ciclo aberto)
  const ciclos = ciclos_abertos_futuros(cartaoId, hoje); // ex.: out, nov, dez, jan...

  // 2. Carregar transações candidatas
  const candidatas = await listar_movimentos_candidatos(cartaoId);
  //  Filtro: status != 'cancelado', statusFonte != 'removido', eh_linha_da_fatura

  // 3. Extrair evidência do provedor
  const evidencias = candidatas.map((tx) => ({
    tx,
    billId: tx.providerBillId,             // L0 (pode ser null)
    forecast: tx.providerBillForecastDate, // L1 (YYYY-MM, pode ser null)
    parcela: tx.parcelaNumero,             // para deslocar ciclo
    data: tx.dataMovimento,
  }));

  // 4. Hard constraints (elimina candidatos impossíveis)
  //   - cartão incompatível (mesmo cartaoId)
  //   - período impossível (data fora do intervalo do ciclo, já validada na query)
  //   - status incompatível (cancelado/removido)
  //   - parcela incompatível (numero > total)
  //   - provider bill conflitante (billId aponta outra fatura)
  //   - fatura fechada incompatível (não reabre)
  //   - timezone/data incompatível

  // 5. Candidate generation
  const candidatos: CandidatoAlocacao[] = [];
  for (const tx of evidencias) {
    const faturasPossiveis = faturas_para_lancamento(tx, ciclos);
    for (const fatura of faturasPossiveis) {
      candidatos.push({ tx, fatura, metodo: metodo_para(tx, fatura), score: score_para(tx, fatura) });
    }
  }

  // 6. Weighted matching
  const alocacoes = weighted_matching(candidatos);
  //  Tie-breakers:
  //   1. maior methodScore
  //   2. menor distância temporal
  //   3. parcela número 1 tem prioridade
  //   4. histórico do banco (InstitutionCardBehavior)

  // 7. Classification
  //  CONFIRMED  = method = PROVIDER_BILL_ID
  //  PREDICTED  = method = PROVIDER_FORECAST (billForecastDate bate com o ciclo)
  //  POSSIBLE   = method in (RULE_INFERRED, HISTORICAL_INFERRED, MATCHING) com score >= 50
  //  UNRESOLVED = tudo o mais (sem evidência)

  // 8. Piso / Central / Teto
  //  PISO   = Σ CONFIRMED
  //  CENTRAL = Σ CONFIRMED + Σ PREDICTED
  //  TETO   = Σ CONFIRMED + Σ PREDICTED + Σ POSSIBLE
  //  UNRESOLVED NUNCA entra (não é certeza)

  // 9. Persistir projeção
  await persistir_previsao(ciclos, piso, central, teto);
}
```

### G.3 Diagrama de classificação

```
Evidência disponível                          →  Status        →  Method
──────────────────────────────────────────────    ─────────       ──────────────
providerBillId = "bill-123" (+ POSTED)        →  CONFIRMED     →  PROVIDER_BILL_ID
providerBillForecastDate = "2026-10" (bate)   →  PREDICTED     →  PROVIDER_FORECAST
regra do ciclo local aplicada com força       →  POSSIBLE      →  RULE_INFERRED
histórico do usuário (mesma compra no mês X)  →  POSSIBLE      →  HISTORICAL_INFERRED
matching por descrição/valor                  →  POSSIBLE      →  MATCHING
sem evidência / conflito                      →  UNRESOLVED    →  UNRESOLVED
```

### G.4 Property: `billForecastDate` é `PROVIDER_FORECAST`, nunca `PROVIDER_CONFIRMED`

- **L0 (billId):** autoridade. Se existe, a alocação é `CONFIRMED`.
- **L1 (billForecastDate):** forte indicação de previsão, mas **não é verdade final**. Vira `PREDICTED`.
- **L2 (regra determinística):** ciclo local do cartão. Vira `POSSIBLE`/`PREDICTED` conforme a força.
- **L3 (padrão histórico):** mesmo cartão/estabelecimento/mês recorrente. `POSSIBLE`.
- **L4 (matching):** descrição/valor/série. `POSSIBLE`.
- **L5 (math validation / subset sum):** **somente como validação excepcional ou desempate de subconjunto pequeno. NUNCA como autoridade.**
- **L6 (UNRESOLVED):** sem evidência. **Nunca vira adjustment.**

### G.5 Performance

- **Incremental:** quando uma transação é criada/atualizada, identificar **apenas as faturas afetadas** (cartão + ciclo) e recalcular só elas. Não recalcular toda a base.
- Definir índices: `movimento(cartaoId, dataMovimento)`, `movimento(providerBillId)`, `bill_allocation(bill_id, is_current)`.
- Projeção (`piso/central/teto`) **persistida** na `credit_card_bill` para leitura barata no dashboard; o engine **recalcula** quando há evento.

---

## H. CLOSED BILL ENGINE — PRESERVAÇÃO DO EXISTENTE

**Regra: NÃO alterar o que já funciona.** A fatura fechada deve continuar usando `totalAmount` como autoridade.

```typescript
function reconciliar_fatura_fechada(fatura: CreditCardBill): ResultadoReconciliacao {
  // 1. Autoridade = total oficial do provedor
  const totalOficial = fatura.totalAmount; // NUNCA é alterado

  // 2. Componentes explicados (persistidos em bill_allocation)
  const alocacoes = await listar_alocacoes(fatura.id, { status: 'confirmed' });
  const ajustes = await listar_ajustes(fatura.id);

  const explicado = sum(alocacoes.map((a) => a.allocatedAmount))
                  + sum(ajustes.map((a) => a.amount));

  // 3. Diferença
  const diferenca = totalOficial - explicado;

  // 4. Se |diferença| > tolerância → cria BillAdjustment UNEXPLAINED_DIFFERENCE
  //    NÃO altera totalAmount
  //    NÃO cria transação fantasma
  //    NÃO vira UNRESOLVED automaticamente (só se não houver explicação)

  return { totalOficial, explicado, diferenca, reconciliada: Math.abs(diferenca) <= 0.01 };
}
```

**Migração: as faturas fechadas existentes** (`fatura_oficial`) viram `credit_card_bill` com `lifecycle_status='closed'` e `reconciliation_status='reconciled'` **sem reprocessar nada**. As alocação são **backfilled** (job assíncrono) para que a fotografia da reconciliação fique persistida — mas **a lógica de exibição não muda**.

**Decisão de camada:** manter `montar_serie_faturas_dashboard`/`aplicar_total_oficial` como a **leitura** de fatura fechada; o `Bill Reconciliation Engine` passa a **persistir** a composição (alocações + ajustes) e validar a igualdade. Os dois coexistem.

---

## I. INSTALLMENT ENGINE — VIRTUAL → REAL

### I.1 Detecção do plano

Quando chega uma transação com `creditCardMetadata` de parcelamento (`installmentNumber` + `totalInstallments`):

1. Calcula `fingerprint` heurístico a partir de `cartaoId + purchaseDate + totalInstallments + totalAmount + merchant` (normalizado).
2. Procura `installment_plan` por `fingerprint`.
3. Se não existe, **cria** o plano e **cria N instâncias** (1..N) como `isVirtual=true`, com `dueDate` calculada pelo ciclo do cartão (`data_movimento_parcela`).
4. **NÃO cria `movimento` falso.** A instância virtual é apenas uma projeção; não entra no extrato/relatório como Fato.

### I.2 Materialização (virtual → real)

Quando o provedor envia a parcela real (com `idExterno` novo):

1. Localiza a `installment_instance` correspondente (por `plan_id` + `installment_number`).
2. Atualiza a instância: `isVirtual=false`, `providerTransactionId=idExterno`, `transactionId=movimento.id`, `amount` (valor real), `dueDate` (data do provedor).
3. **Não cria uma segunda parcela** — a mesma instância deixa de ser virtual.
4. Cria/atualiza `bill_allocation` com a evidência disponível (`billId` → CONFIRMED; senão `billForecastDate` → PREDICTED).

### I.3 Correlação delete/recreate

Os "órfãos" (`lancai:proj:` cancelados) são substituídos pela instância real. O `fingerprint` (hash de série) é a **chave de correlação** — mas **não é identidade absoluta**: é uma heurística auditável, e as evidências L0/L1 têm prioridade sobre ele.

---

## J. WEBHOOK ARCHITECTURE

### J.1 O que já existe (bom)

```sql
CREATE TABLE open_finance_evento (
  id uuid PRIMARY KEY,
  provedor text NOT NULL,
  evento_id text NOT NULL,
  tipo text NOT NULL,
  payload jsonb NOT NULL,
  processado_em timestamptz,
  erro text,
  data_criacao timestamptz DEFAULT now(),
  UNIQUE (provedor, evento_id)
);
```

- Idempotência: `UNIQUE(provedor, evento_id)` + `onConflictDoNothing` (resolvido pelo banco, não por "check-then-insert").
- Payload bruto preservado 30 dias (anonimização).
- `reprocessar_falhos()` para eventos com `erro`.

### J.2 Melhorias necessárias

| Melhoria | Implementação |
|---|---|
| **Status do evento** | `status` (`received`\|`processing`\|`processed`\|`failed`\|`dead_letter`) |
| **Retry counters** | `tentativas integer`, `proximo_retry timestamptz`, `dead_letter_em timestamptz` |
| **Dead letter** | Cron que move evento com `tentativas >= MAX` para `dead_letter_em` |
| **Ordenação** | Processar por `data_criacao ASC`; garantir que `transactions/updated` processado antes de `created` do mesmo ID (quando aplicável) |
| **Lock por conexão** | Evitar processamento concorrente do mesmo `itemId` (usar `pg_advisory_xact_lock` ou `lock-sync-conexao.ts` já existente) |
| **Métricas** | Contadores por provedor/tipo: received, processed, failed, retried, dead_letter |

### J.3 Fluxo robusto

```
Webhook recebido
  ↓
Auth (X-Lancai-Webhook, timing-safe)
  ↓
ServicoIngestaoOpenFinance.receber()
  → grava payload bruto em open_finance_evento (idempotente via UNIQUE)
  → responde 2XX imediato (provedor retenta se >5s)
  ↓
Se novo:
  → lock por conexao
  → processar(payload)
     → reinterpretar payload
     → se transactions/updated: coletar_por_ids (recoleta estado atual)
     → montar_eventos → EventoFinanceiroNormalizado
     → MotorFinanceiro.ingerir_eventos / atualizar_fatos_da_fonte / remover_fatos_da_fonte
     → (NOVO) recalcular previsões afetadas: forecastEngine.recalcular(cartaoId, ciclosAfetados)
     → (NOVO) atualizar alocação se billId/forecast mudou
     → marcar processado ou erro
  ↓
Se erro:
  → gravar erro + tentativas++;
  → cron de reprocesso tenta de novo até limite; depois dead letter.
```

---

## K. MIGRATION PLAN

> **Só apresentamos após a comparação (D).** Termos decidido que o vetor é **AJUSTAR**, não reescrever. As migrations foram projetadas para **não perder dados** e **não reprocessar faturas fechadas**.

### K.1 Gap Analysis (schema atual → target)

| Tabela atual | Tabela target | Ação | Risco | Compatibilidade |
|---|---|---|---|---|
| `cartao` | `credit_card` (nova) | **Alterar** (estender) OU criar paralela + swap FK | **Médio** | View de compatibilidade |
| `fatura_oficial` | `credit_card_bill` | **ALTER + RENAME + ADD COLUMNS** | **Baixo** | Dados preservados |
| `movimento` | `transaction` (conceito) | **ADD COLUMNS** (providerBillId, providerBillForecastDate, installmentPlanId) | **Baixo** | Nullable, sem quebra |
| — | `bill_allocation` | **CREATE TABLE** | **Baixo** | Nova, sem dados legacy |
| — | `installment_plan` | **CREATE TABLE** | **Baixo** | Nova |
| — | `installment_instance` | **CREATE TABLE** | **Baixo** | Nova |
| — | `bill_adjustment` | **CREATE TABLE** | **Baixo** | Nova |
| — | `bill_audit_log` | **CREATE TABLE** | **Baixo** | Nova |
| `open_finance_evento` | `provider_webhook_event` | **RENAME + ADD COLUMNS** | **Baixo** | Dados preservados |

### K.2 Plano de migrações (ordem, sem gerar agora)

**MIGRAÇÃO 1 — `bill_allocation` (nova, sem dados legacy)**
```sql
CREATE TABLE bill_allocation (...);
-- + índices
```

**MIGRAÇÃO 2 — `installment_plan` / `installment_instance` (novas)**
```sql
CREATE TABLE installment_plan (...);
CREATE TABLE installment_instance (...);
```

**MIGRAÇÃO 3 — `bill_adjustment` (nova)**
```sql
CREATE TABLE bill_adjustment (...);
```

**MIGRAÇÃO 4 — `bill_audit_log` (nova)**
```sql
CREATE TABLE bill_audit_log (...);
```

**MIGRAÇÃO 5 — estender `movimento` com evidências**
```sql
ALTER TABLE movimento ADD COLUMN provider_bill_id text;
ALTER TABLE movimento ADD COLUMN provider_bill_forecast_date text;
ALTER TABLE movimento ADD COLUMN installment_plan_id uuid REFERENCES installment_plan(id);
CREATE INDEX idx_movimento_provider_bill_id ON movimento(provider_bill_id);
CREATE INDEX idx_movimento_installment_plan_id ON movimento(installment_plan_id);
```

**MIGRAÇÃO 6 — estender `fatura_oficial` → `credit_card_bill`**
```sql
ALTER TABLE fatura_oficial RENAME TO credit_card_bill;
ALTER TABLE credit_card_bill ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'closed';
ALTER TABLE credit_card_bill ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid';
ALTER TABLE credit_card_bill ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'reconciled';
ALTER TABLE credit_card_bill ADD COLUMN versao integer NOT NULL DEFAULT 1;
ALTER TABLE credit_card_bill ADD COLUMN period_start date;
ALTER TABLE credit_card_bill ADD COLUMN period_end date;
-- Backfill period_start/period_end a partir do fechamento do cartão + competencia
```

**MIGRAÇÃO 7 — `credit_card` (nova)**
```sql
CREATE TABLE credit_card (...);
INSERT INTO credit_card SELECT ... FROM cartao;
-- View de compatibilidade para código legado
```

**MIGRAÇÃO 8 — Backfill `bill_allocation` para faturas fechadas (RISCO MÉDIO)**
```sql
-- Job assíncrono, idempotente, com dry-run
-- Para cada fatura fechada:
--   Para cada movimento do ciclo → INSERT bill_allocation(status='confirmed', method='provider_bill_id')
--   Se Σ allocations != totalOficial → INSERT bill_adjustment(unexplained_difference)
-- Validar: Σ allocations + Σ adjustments == total_amount para cada fatura
```

**MIGRAÇÃO 9 — Backfill `installment_plan`/`installment_instance`**
```sql
-- Usar agrupar_series_parcelamento() para detectar planos
-- Criar instâncias virtuais para parcelas futuras não materializadas
-- (Este passo substitui a criação de movimentos `lancai:proj:` — os existentes são
--  marcados como legado/ignoráveis, e a projeção passa a vir das instâncias virtuais)
```

### K.3 Riscos e compatibilidade de migração

| Migração | Dados atuais | Migração necessária | Risco | Rollback |
|---|---|---|---|---|
| 1-4 (tabelas novas) | — | — | **Baixo** | DROP TABLE |
| 5 (ADD COLUMNs em movimento) | Colunas nullable | SQL instantâneo (Postgres ADD COLUMN é metadata-only p/ default null) | **Baixo** | DROP COLUMN |
| 6 (rename + add) | `fatura_oficial` | RENAME é metadata-only; ADD COLUMNs com DEFAULT são rápidas | **Baixo** | RENAME de volta + DROP COLUMN |
| 7 (credit_card) | `cartao` | INSERT SELECT | **Médio** | DROP TABLE + view |
| 8 (backfill allocation p/ fechadas) | ~100k-1M movimentos | Job assíncrono idempotente | **Médio** | TRUNCATE bill_allocation |
| 9 (backfill installment) | `lancai:proj:` + parcelas | Job assíncrono | **Médio** | TRUNCATE installment_plan/instance |

**Princípio:** faturas fechadas **não são reprocessadas**; a lógica de exibição (`aplicar_total_oficial`, `somar_pagamentos_fatura`) permanece idêntica. O backfill de alocação é **aditivo**: cria o vínculo explícito, mas o dashboard continua lendo `fatura_oficial`/`aplicar_total_oficial` até a migração completa.

### K.4 Estratégia de coexistência (legacy fechada × novo forecast)

```
closed bills  →  preservadas (fatura_oficial → credit_card_bill lifecycle=closed)
future/open   →  passam pelo novo Bill Forecast Engine
```

Até que o novo domínio assuma integralmente, `montar_serie_faturas_dashboard` lê:
- fatura fechada: via `fatura_oficial` (autoridade).
- fatura aberta/futura: via `bill_forecast` (piso/central/teto) quando disponível; senão, cai na soma das linhas do ciclo (compatibilidade).

---

## L. TEST PLAN

### L.1 Testes unitários — Bill Forecast Engine

```typescript
describe('BillForecastEngine', () => {
  // Hierarquia de evidências
  it('L0: providerBillId → CONFIRMED / PROVIDER_BILL_ID', () => { ... });
  it('L1: providerBillForecastDate → PREDICTED / PROVIDER_FORECAST', () => { ... });
  it('L2: regra do ciclo local → POSSIBLE / RULE_INFERRED', () => { ... });
  it('L6: sem evidência → UNRESOLVED (não vira adjustment)', () => { ... });

  // Hard constraints
  it('Rejeita cartão incompatível', () => { ... });
  it('Rejeita fatura fechada sem billId', () => { ... });
  it('Rejeita transação cancelada/removida', () => { ... });
  it('Respeita providerBillId conflitante', () => { ... });

  // Piso / Central / Teto
  it('Calcula piso/central/teto corretamente', () => {
    // CONFIRMED=2000, PREDICTED=700, POSSIBLE=300, UNRESOLVED=500
    // → { piso:2000, central:2700, teto:3000 } (UNRESOLVED fora)
  });

  // PENDING → POSTED
  it('PREDICTED → CONFIRMED quando providerBillId chega', () => { ... });

  // Parcelas
  it('Cria InstallmentPlan + N InstallmentInstance virtual (sem movimento)', () => { ... });
  it('Materializa virtual → real sem duplicar', () => { ... });
  it('Projeta parcelas faltantes com datas corretas', () => { ... });
});
```

### L.2 Testes de integração — Pluggy → Forecast

```typescript
describe('Integração Pluggy → Forecast', () => {
  it('Caso 1: compra hoje PENDING sem billId → UNRESOLVED ou POSSIBLE', () => { ... });
  it('Caso 2: compra hoje PENDING com billForecastDate mês seguinte → PREDICTED', () => { ... });
  it('Caso 3: billForecastDate muda → previsão é recalculada', () => { ... });
  it('Caso 4: PENDING → POSTED com billId → CONFIRMED', () => { ... });
  it('Caso 11: compra parcelada 6x → cria 1 plan + 6 instances', () => { ... });
  it('Caso 12: todas as parcelas de uma vez → sem duplicação', () => { ... });
  it('Caso 13: parcelas mês a mês → virtual → real', () => { ... });
  it('Caso 14: parcela futura sem billId → POSSIBLE/PREDICTED', () => { ... });
  it('Caso 17: parcela desaparece e reaparece com outro ID → correlação por fingerprint', () => { ... });
  it('Caso 20: estorno total → abate da fatura', () => { ... });
  it('Caso 22-26: IOF/juros/anuidade/tarifa/câmbio → BillAdjustment', () => { ... });
  it('Caso 36-39: webhook duplicado/fora de ordem/antes/depois do sync', () => { ... });
  it('Caso 40: reprocessamento idempotente', () => { ... });
});
```

### L.3 Testes de regressão — Faturas fechadas (OBRIGATÓRIO)

```typescript
describe('Regression: Closed Bills Unchanged', () => {
  it('Fatura fechada mantém total oficial', () => { ... });
  it('Conciliação: totalOficial = Σ allocations + Σ adjustments', () => { ... });
  it('Pagamento no intervalo fecha→vence ainda funciona', () => { ... });
  it('Status paga/parcial/em_aberto inalterados', () => { ... });
  it('Dashboard fatura fechada mostra mesmo valor', () => { ... });
  it('Ciclo_do_movimento e na_fatura_do_recorte inalterados', () => { ... });
});
```

### L.4 Testes com dados reais anonimizados

- Exportar subset de produção (anonimizado).
- Rodar `BillForecastEngine` e comparar com as faturas fechadas reais.
- Validar: **piso ≤ real ≤ teto** em >95% dos casos.
- Validar: para faturas fechadas, `Σ allocations + Σ adjustments == total_amount` (tolerância: 0,01).

---

## M. RESPOSTAS AO VEREDITO OBRIGATÓRIO

### 1. A arquitetura atual deve ser: **AJUSTADA** (não reescrita)

- **~85% funciona** e é sólido: faturas fechadas (autoridade `total_amount`), pagamentos (intervalo fecha→vence), ciclo do cartão, parcelamento manual, webhook inbox idempotente, fingerprint, imutabilidade do Fato (ADR-009), separação Fato/Conhecimento, múltiplos cartões por `conta_financeira`, IOF, crédito de quitação.
- **~15% está quebrado** e é pontual: falta `BillAllocation`, falta fatura aberta/futura persistida, falta `InstallmentPlan/Instance`, falta `BillForecastEngine` separado, falta classificação de confiança, falta `billId` no adaptador.
- **Reescrever** quebraria o que funciona (faturas fechadas) com risco desnecessário. **Manter como está** deixaria o problema das faturas futuras sem solução.
- **AJUSTAR** é o caminho: adicionar as entidades que faltam, extrair `billId`/`billForecastDate`, criar o `Forecast Engine`, manter o `Reconciliation` e as faturas fechadas intactas.

### 2. A parte de fatura fechada precisa ser alterada? **NÃO** (apenas migração de dados)

- A **lógica** não muda: `fatura_oficial.total` é autoridade; `aplicar_total_oficial` mantém o comportamento; `somar_pagamentos_fatura` idem.
- A **migração de dados**: `fatura_oficial` → `credit_card_bill` com `lifecycle_status='closed'`, `payment_status`/`reconciliation_status` preenchidos; backfill aditivo de `bill_allocation` para as faturas fechadas (job assíncrono, idempotente, dry-run).
- **Não** há necessidade de reescrever `montar_serie_faturas_dashboard` para fatura fechada — apenas garantir que a leitura continue idêntica.

### 3. O problema principal das faturas futuras está em: **MODELAGEM + ALLOCATION** (com DATA como sintoma)

Escolha entre as opções: `DATA` é apenas o **sintoma** (a data deslocada é o mecanismo atual). A **causa-raiz** é:

- **`MODELAGEM`**: não existe `BillAllocation`, `CreditCardBill` aberta, `InstallmentPlan/Instance`. O vínculo transação↔fatura é implícito, calculado na leitura, sem histórico.
- **`ALLOCATION`**: `billId` é ignorado (nem existe no tipo Pluggy), `billForecastDate` é descartado (só vira input de data), não há hierarquia de evidências nem status de previsão.
- **Adicionalmente**, as parcelas futuras são materializadas como **transações falsas** (`lancai:proj:`), o que agrava a poluição do ledger.

**Resposta:** o problema principal é **MODELAGEM + ALLOCATION** (com `DATA` como consequência).

### 4. O modelo `Transaction + BillAllocation + CreditCardBill` resolve o isolamento Movimento/Fatura? **SIM**

- **Transaction** (movimento) = fato financeiro imutável (grupo Fato, trigger).
- **BillAllocation** = vínculo mutável com `status`/`method`/`confidenceScore`, `validFrom`/`validTo`/`isCurrent`, `allocatedAmount` — preservando histórico.
- **CreditCardBill** = container da cobrança (oficial/prevista), com `lifecycle`/`payment`/`reconciliation` status separados.
- **Isso permite:** a mesma transação prevista em Outubro ser confirmada em Novembro **sem perder o histórico**. A alocação atual muda (`valid_to` na antiga, nova `isCurrent`), mas o rastro permanece.

### 5. `InstallmentPlan + InstallmentInstance` é adequado? **SIM**

- Resolve o problema de "parcelas futuras **não geram transactions falsas**" (`isVirtual=true`, sem `movimento`).
- Resolve "virtual → real **sem duplicata**" (mesma instância vira `isVirtual=false`, com `transactionId`).
- Resolve "sem ID universal do provider" via `fingerprint` heurístico (auditável, não é identidade absoluta).
- Mantém a tabela `parcela` para **lançamentos manuais** (não mistura origens).

### 6. `WebhookInbox` é necessário? **JÁ EXISTE** (open_finance_evento)

- Idempotência: `UNIQUE(provedor, evento_id)`.
- Precisa de melhorias (não criação): `status` (`received/processing/processed/failed/dead_letter`), `tentativas`/`proximo_retry`/`dead_letter_em`, **lock por conexão** para eventos fora de ordem, **métricas**.

### 7. `BillAdjustment` está corretamente definido? **SIM, com ressalva de enforcement**

- **Signed amount** (positivo = aumenta fatura, negativo = reduz) ✅.
- **Tipos** (`UNEXPLAINED_DIFFERENCE`, `FEE`, `INTEREST`, `IOF`, `EXCHANGE_VARIATION`, `FINANCE_CHARGE`, `CREDIT`, `OTHER`) ✅.
- **Ressalva:** a regra "transação não identificada → `UNRESOLVED`, não `Adjustment`" precisa ser **enforçada por código** (não por disciplina): o `AdjustmentEngine` não deve ter permissão de criar `UNEXPLAINED_DIFFERENCE` a partir de uma transação não alocada; só de uma diferença real entre `totalAmount` e componentes explicados.

### 8. Há alguma migration perigosa? **SIM: Migração 8 (backfill de allocation para faturas fechadas)**

- **Risco médio.** Precisa ser **job assíncrono, idempotente, com dry-run** e validação `Σ allocations + Σ adjustments == total_amount` para cada fatura.
- **Rollback:** TRUNCATE `bill_allocation`.
- As demais são **baixo risco** (ADD COLUMN nullable, RENAME metadata-only, CREATE TABLE).

### 9. Existe risco de regressão nas faturas fechadas? **NÃO**, se os pré-requisitos forem atendidos

- **Não** alterar a leitura atual (`montar_serie_faturas_dashboard` + `aplicar_total_oficial`).
- **Migração 8** validada com `aplicar_total_oficial()` resultando no mesmo valor.
- **`BillReconciliationEngine`** usando a mesma lógica.
- **Testes de regressão (L.3)** passando em CI antes de cada mudança.

### 10. Qual é o menor conjunto de mudanças necessário para corrigir as faturas futuras?

| Prioridade | Mudança | Esforço | Dependência |
|---|---|---|---|
| **P0** | Criar tabela `bill_allocation` + `bill_audit_log` | 1-2 dias | — |
| **P0** | Estender `movimento` com `provider_bill_id` / `provider_bill_forecast_date` | 0,5 dia | Tabela nova |
| **P0** | Extrair `billId` + `billForecastDate` no `AdaptadorPluggy.traduzir_transacao` e persistir nas colunas novas | 1 dia | Colunas novas |
| **P0** | Criar `BillForecastEngine` separado (extrai de `montar_serie_faturas_dashboard`) | 3-5 dias | Colunas novas |
| **P1** | Implementar classificação `CONFIRMED/PREDICTED/POSSIBLE/UNRESOLVED` | 2 dias | Engine |
| **P1** | Implementar Piso/Central/Teto no dashboard | 2 dias | Engine |
| **P1** | Criar `installment_plan` + `installment_instance` e parar de criar `movimento` `lancai:proj:` | 3-4 dias | Tabelas novas |
| **P2** | Estender `cartao` com `providerCardReference`/`cardType`/adicional/virtual | 2 dias | Tabela |
| **P2** | `BillAdjustment` + `BillAuditLog` | 2 dias | Tabelas novas |
| **P2** | Melhorias no webhook inbox (dead letter, lock, retry) | 1-2 dias | Evento |

**Total estimado: ~17-21 dias de engenharia** (sem QA/testes em produção).

---

## N. CRITÉRIO DE APROVAÇÃO (checklist)

| Critério | Estado atual | Ação |
|---|---|---|
| [x] Faturas fechadas continuam preservadas | ✅ | Preservar leitura; migração aditiva |
| [ ] Faturas futuras possuem Forecast Engine separado | ❌ | Criar `BillForecastEngine` |
| [ ] `billId` é autoridade quando disponível | ❌ | Extrair no adaptador + usar no engine |
| [ ] `billForecastDate` é tratado como previsão (L1) | ⚠️ Parcial | Hierarquia L0 > L1 > L2… |
| [ ] PENDING e POSTED tratados corretamente | ⚠️ Parcial | Atualização deve virar CONFIRMED |
| [ ] Parcelas futuras não geram transactions falsas | ⚠️ Parcial | `isVirtual` em `installment_instance` |
| [ ] Virtual → real é possível | ⚠️ Parcial | `materialize` |
| [ ] `UNRESOLVED` é separado de `Adjustment` | ❌ | Enforcar no AdjustmentEngine |
| [ ] Score não é confundido com verdade | ❌ | `status`/`method`/`score` separados |
| [ ] Webhook é idempotente | ✅ | Já existe |
| [ ] Eventos fora de ordem são suportados | ⚠️ Parcial | Lock por conexão + ordenação |
| [ ] Delete/recreate é tratado | ⚠️ Parcial | Fingerprint reidentifica |
| [ ] Múltiplos cartões são suportados | ✅ | `conta_financeira` |
| [ ] Histórico de alterações é preservado | ⚠️ Parcial | `bill_audit_log` + `valid_from/valid_to` |
| [ ] Reconciliação fechada continua funcionando | ✅ | Preservar lógica |
| [ ] LLM não participa da determinação financeira | ✅ | Já isolado (ADR-012) |
| [ ] Migrations não perdem dados | ✅ | Plano com rollback |
| [ ] Testes cobrem casos extremos | ❌ | Implementar plano L |
