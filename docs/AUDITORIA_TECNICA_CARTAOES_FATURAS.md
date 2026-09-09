AUDITORIA TÉCNICA — MÓDULO DE CARTÕES, FATURAS FUTURAS, PARCELAS E RECONCILIAÇÃO

RESUMO EXECUTIVO

Estado Atual:

- 80% da base funciona: faturas fechadas, parcelamento manual, webhook inbox idempotente, fingerprint, trigger de imutabilidade

- 20% crítico: previsão de faturas futuras, associação transação↔fatura, modelagem de status de previsão

Conclusão: Arquitetura atual deve ser AJUSTADA (não reescrita). Faturas fechadas são preservadas. Foco é corrigir faturas futuras.

A. ESTADO ATUAL

A.1 Arquitetura Atual — Visão Geral

Pluggy

   ↓

Webhook / Sync

   ↓

Ingestão (ServicoIngestaoOpenFinance)

   ↓

MotorFinanceiro (Core)

   ↓

Banco (Postgres/Drizzle)

   ↓

Dashboard / UI

A.2 Schema Atual — Tabelas Principais

Tabela	Colunas Relevantes	Observações

movimento	id, workspace_id, fonte, provedor, id_externo, fingerprint, descricao_fonte, favorecido_fonte, status_fonte, valor, tipo, status (previsto/realizado/cancelado), data_movimento, conta_id, cartao_id, parcela_numero, parcela_total, parcela_compra_em, parcela_compra_valor, tipo_gasto, categoria_id, classificado_por, ignorado_em_relatorio	Fato imutável para fonte = 'open_finance' (trigger proteger_fato_financeiro)

parcela	id, movimento_id, numero_parcela, valor, data_movimento, status	Parcelas de lançamentos manuais; OF projeta como movimentos com id_externo = 'lancai:proj:...'

fatura_oficial	id, workspace_id, cartao_id, id_externo, competencia, total, data_fechamento, data_vencimento	Apenas faturas fechadas do provider

cartao	id, nome, limite, fechamento, vencimento, saldo, sincronizada, conta_financeira_id, dados_plasticos_cifrados	saldo = utilizado agora (inclui parcelas futuras no OF)

conta_financeira	id, usuario_id, instituicao, nome_exibicao, mascara, tipo, perfil, conexao_id	Identidade estável para reatachar (múltiplos cartões/contas)

open_finance_conta_externa	id, conexao_id, id_externo, nome, tipo, conta_id, cartao_id, conta_financeira_id	Mapa conta externa → local

open_finance_evento	id, provedor, evento_id, tipo, payload, processado_em, erro	Webhook inbox com UNIQUE(provedor, evento_id)

A.3 Fluxo de Dados Real — PENDING → POSTED

// 1. Webhook transactions/created (PENDING, sem billId, com billForecastDate)

WebhookPluggy { event: "transactions/created", transactionIds: ["tx-123"] }

    ↓

AdaptadorPluggy.traduzir_transacao()

    ↓

// statusFonte = "pendente" → MotorFinanceiro cria Movimento com status = "previsto"

// billForecastDate usado em data_movimento_parcela() para definir competência

// parcelamento: { numero, total, compraEm, valorTotal }

    ↓

// 2. Webhook transactions/updated (POSTED, com billId)

WebhookPluggy { event: "transactions/updated", transactionIds: ["tx-123"] }

    ↓

ServicoIngestaoOpenFinance.ingerir_alteradas()

    ↓

MotorFinanceiro.atualizar_fatos_da_fonte()

    ↓

// Reidentifica por fingerprint se idExterno mudou

// Atualiza: statusFonte "pendente" → "confirmado", status "previsto" → "realizado"

// Preserva: categoria, tags, observações, tipo_gasto

// billId NÃO é gravado em lugar nenhum hoje (lacuna!)

A.4 Como o Sistema Decide a Fatura de uma Transação (HOJE)

Para faturas FECHADAS (funciona bem):

1. fatura_oficial tem o total do banco (autoridade)

2. aplicar_total_oficial(liquido, oficial) → usa totalOficial se existir

3. somar_pagamentos_fatura() usa competencia_quitacao_fatura() para achar Pix no intervalo fecha→vence

4. status_fatura() classifica: paga | parcial | em_aberto

Para faturas ABERTAS/FUTURAS (PROBLEMA):

1. mes_gasto_do_cartao(): mês atual = ciclo_aberto_em(hoje, fechamento) (ciclo aberto)

2. competencia_ciclo_da_data(compra, fechamento): compra ≤ fecha → mês do fecha; compra > fecha → mês seguinte

3. Para parcelas: ciclo_do_movimento() usa:

- competencia_ciclo_da_data como base

- Se vencimento > fechamento (ex: fecha 12, vence 17): parcela prevista no vencimento volta ao ciclo que fechou

- Se vencimento < fechamento (ex: fecha 30, vence 6): parcela prevista fica no ciclo aberto

- Antecipação de pagamento empurra gasto para ciclo seguinte

4. billForecastDate é usado em data_movimento_parcela() apenas se bater com a competência esperada pelo ciclo local (linha 310-315 em datas.ts)

5. Não existe BillAllocation — a associação é implícita pelo ciclo_do_movimento()

6. Não existe status de previsão (CONFIRMED/PREDICTED/POSSIBLE/UNRESOLVED) — tudo é "previsto" ou "realizado"

B. O QUE JÁ FUNCIONA (DEVE SER PRESERVADO)

Funcionalidade	Localização	Status

Faturas fechadas com fatura_[oficial.total](http://oficial.total) como autoridade	montar-dashboard.ts:584-598, pagamento-fatura.ts:588-598	✅ Funciona

Conciliação: totalOficial = Σ linhas + ajustes	aplicar_total_oficial()	✅ Funciona

Pagamentos de fatura: intervalo fecha→vence, deduplica débito+crédito	soma_cobrada_do_vencimento(), competencia_cobranca_casa()	✅ Funciona

Ciclo do cartão: intervalo_ciclo_fatura(), competencia_ciclo_da_data()	pagamento-fatura.ts:162-209	✅ Testado extensivamente

Parcelamento manual: tabela parcela + registrar_parcelamento()	motor-financeiro.ts:1297-1311	✅ Funciona

Parcelas OF projetadas: lancai:proj:... + completar_parcelas_projetadas()	servico-ingestao.ts:695-828	✅ Funciona

Reidentificação por fingerprint quando idExterno muda	motor-financeiro.ts:219-232, 690-700	✅ Funciona

Webhook inbox idempotente: open_finance_evento UNIQUE(provedor, evento_id)	0009_open_finance.sql:43-53	✅ Funciona

Separação Fato vs Conhecimento (trigger imutabilidade)	0012_parcelamento_da_fonte.sql:18-55	✅ Funciona

Múltiplos cartões por conexão (conta_financeira)	0024_conta_financeira.sql	✅ Funciona

Selo no extrato: "Compra em ago → Fatura set"	selo_fatura_ciclo()	✅ Funciona

Dashboard: gráfico faturas com status paga/parcial/em_aberto/aberta/prevista	CardFaturasDashboard.tsx	✅ Funciona

C. O QUE ESTÁ QUEBRADO / FALTANDO (FOCO: FATURAS FUTURAS)

C.1 Lacunas Críticas na Previsão de Faturas Futuras

Problema	Evidência no Código	Impacto

Não existe BillAllocation — associação transação↔fatura é implícita	movimento não tem bill_id; ciclo_do_movimento() decide sozinho	Não rastreia mudança de previsão → confirmação

billId do Pluggy é ignorado	traduzir_transacao() não extrai creditCardMetadata.billId	Perde evidência oficial L0 (PROVIDER_BILL_ID)

billForecastDate tratado como fallback, não evidência L1	data_movimento_parcela(): forecast só usado se bater com ciclo local	Não respeita hierarquia: billId > billForecastDate > regra

Não há status de previsão (CONFIRMED/PREDICTED/POSSIBLE/UNRESOLVED)	Dashboard mostra "prevista" binário	UI não distingue certeza da estimativa

Não há Piso/Previsão Central/Teto	montar_serie_faturas_dashboard() soma tudo ou nada	Usuário vê valor único, não faixa

Parcelas futuras OF não têm billForecastDate individual	projetar-parcelas.ts projeta datas via projetar_data_parcela() sem forecast	Cada parcela deveria ter sua previsão

Transação PENDING sem billForecastDate = UNRESOLVED, mas vira "previsto"	traduzir_status_transacao(): PENDING → "pendente" → status "previsto"	Falsa certeza

Mudança PENDING→POSTED não dispara recálculo de previsão explícito	atualizar_fatos_da_fonte() atualiza status, mas não reavalia alocação	Previsão não "vira confirmação" explicitamente

Não existe InstallmentPlan / InstallmentInstance	Parcelas OF são movimentos soltos; agrupamento heurístico em agrupar_series_parcelamento()	Não modela "compra parcelada" como entidade

C.2 Problemas de Modelagem

// ATUAL: Transação carrega tudo misturado

interface Movimento {

  // Fato

  id_externo, fonte, provedor, descricao_fonte, status_fonte, valor, tipo, data_movimento

  // Parcelamento (Fato)

  parcela_numero, parcela_total, parcela_compra_em, parcela_compra_valor

  // Conhecimento

  descricao, categoria_id, tags, observacoes, classificado_por, confianca_ia

  // Fatura (IMPLÍCITA - não existe)

  // bill_id NÃO EXISTE

  // allocation_status NÃO EXISTE

}

C.3 Casos Extremos Não Cobertos (do Requisito §34)

Caso	Cobertura Atual

Caso 1: Compra hoje, PENDING, sem billId	Vira "previsto" sem evidência

Caso 2: Compra hoje, PENDING, billForecastDate = mês seguinte	Usado se bater com ciclo local

Caso 3: billForecastDate muda	Não rastreado (atualização sobrescreve)

Caso 4: PENDING → POSTED	Atualiza status, mas não reavalia alocação

Caso 5: billId aparece posteriormente	IGNORADO — não é gravado

Caso 11-17: Parcelas (aparecem juntas, mês a mês, virtual→real)	Parcial: completar_parcelas_projetadas() + cancelar_projetadas_substituidas()

Caso 27-29: Múltiplos cartões, adicional, virtual	conta_financeira suporta, mas cartao não distingue adicional/virtual

D. COMPARAÇÃO: ATUAL vs MODELO PROPOSTO

Conceito Proposto	Existe Atual?	Onde/Como	Ação

CreditCard (entidade explícita)	✅ Parcial	cartao table + conta_financeira	Estender: adicionar provider_card_reference, masked_number, holder

Transaction (fato financeiro puro)	✅	movimento (grupo Fato)	Separar Conhecimento (já separado em colunas)

BillAllocation (vínculo transação↔fatura)	❌	NÃO EXISTE	CRIAR tabela bill_allocation

CreditCardBill (fatura)	✅ Parcial	fatura_oficial (só fechadas)	Estender para faturas abertas/futuras

InstallmentPlan	❌	Heurística em agrupar_series_parcelamento()	CRIAR

InstallmentInstance	❌	Movimentos soltos + parcela (manual)	CRIAR

BillAdjustment	❌	ajuste em aplicar_total_oficial() só no dashboard	CRIAR tabela

BillAuditLog	✅ Parcial	auditoria table (genérica)	Estender para alocação/previsão

ProviderWebhookEvent (inbox)	✅	open_finance_evento	✅ Já existe

Bill Forecast Engine	❌	Lógica espalhada em ciclo_do_movimento, montar_serie_faturas_dashboard	CRIAR engine separado

Bill Reconciliation Engine	✅ Parcial	montar_serie_faturas_dashboard + aplicar_total_oficial	Separar do Forecast Engine

Status Previsão: CONFIRMED/PREDICTED/POSSIBLE/UNRESOLVED	❌	Binário: previsto/realizado	CRIAR enum + lógica

Hierarquia evidências L0-L6	❌	Ciclo local manda sobre forecast	IMPLEMENTAR

Piso / Central / Teto	❌	Valor único por fatura	CRIAR

E. TARGET ARCHITECTURE — ARQUITETURA FINAL RECOMENDADA

┌─────────────────────────────────────────────────────────────────────────────┐

│                         PLUGGY / PROVIDERS                                  │

└─────────────────────────────────┬───────────────────────────────────────────┘

                                  │

                                  ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                      PROVIDER ADAPTER (PluggyAdapter)                       │

│  - Normaliza: TransacaoPluggy → EventoFinanceiroNormalizado                │

│  - Extrai: billId, billForecastDate, installmentNumber, purchaseDate       │

│  - NÃO decide alocação de fatura                                           │

└─────────────────────────────────┬───────────────────────────────────────────┘

                                  │

                                  ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                      WEBHOOK INBOX (ProviderWebhookEvent)                   │

│  - Idempotência: UNIQUE(provider, eventId)                                  │

│  - Payload bruto preservado por 30 dias                                     │

│  - Status: received | processing | processed | failed | dead_letter         │

└─────────────────────────────────┬───────────────────────────────────────────┘

                                  │

                                  ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                    TRANSACTION ENGINE (Ingestão + Normalização)             │

│  - Upsert Transaction (Fato) por idExterno + fingerprint                   │

│  - Lifecycle: PENDING → POSTED → (REMOVED)                                 │

│  - Deduplicação: mesmo idExterno | mesmo fingerprint                       │

│  - Correlação delete+recreate (mesma compra, novo ID)                      │

│  - Gera Transaction.raw_provider_snapshot (JSON)                           │

└─────────────────────────────────┬───────────────────────────────────────────┘

                                  │

               ┌──────────────────┼──────────────────┐

               ▼                  ▼                  ▼

┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐

│  INSTALLMENT ENGINE │ │ BILL FORECAST ENGINE │ │ BILL RECONCILIATION │

│                     │ │                      │ │    ENGINE           │

│ - Detecta parcelado │ │ - Para cada fatura   │ │ - Fatura fechada    │

│ - Cria Plan         │ │   aberta/futura:     │ │ - [bill.total](http://bill.total) =      │

│ - Cria Instances    │ │   * Hard constraints │ │   Σ allocations     │

│ - Virtual → Real    │ │   * Candidate gen    │ │   + Σ adjustments   │

│ - fingerprint       │ │   * Classification   │ │ - Não altera total  │

│   agrupamento       │ │   * Floor/Central/   │ │   oficial           │

└─────────────────────┘ │     Ceiling          │ └─────────────────────┘

                        └─────────────────────┘

               ┌──────────────────┼──────────────────┐

               ▼                  ▼                  ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                         BILL ALLOCATION ENGINE                              │

│  - BillAllocation: transaction_id, bill_id, status, method, confidence     │

│  - Status: CONFIRMED (L0) | PREDICTED (L1) | POSSIBLE (L2-L4) | UNRESOLVED │

│  - Método: PROVIDER_BILL_ID | PROVIDER_FORECAST | RULE_INFERRED | etc.     │

│  - Histórico: valid_from, valid_to, is_current                             │

│  - allocated_amount (snapshot na reconciliação)                            │

└─────────────────────────────────┬───────────────────────────────────────────┘

                                  │

                                  ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                         ADJUSTMENT ENGINE                                   │

│  - BillAdjustment: bill_id, type, signed_amount, description               │

│  - Types: UNEXPLAINED_DIFFERENCE | FEE | INTEREST | IOF | EXCHANGE | etc.  │

│  - NÃO usado para esconder UNRESOLVED                                      │

└─────────────────────────────────┬───────────────────────────────────────────┘

                                  │

                                  ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                          AUDIT ENGINE                                       │

│  - BillAuditLog: allocation_change, forecast_change, reconciliation,       │

│    manual_intervention, version, origin                                     │

└─────────────────────────────────┬───────────────────────────────────────────┘

                                  │

                                  ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                           PERSISTÊNCIA (POSTGRES)                           │

│  Tabelas novas/alteradas:                                                  │

│  - credit_card (estende cartao)                                            │

│  - transaction (estende movimento - separar Fato/Conhecimento)             │

│  - credit_card_bill (estende fatura_oficial)                               │

│  - bill_allocation (NOVA)                                                  │

│  - installment_plan (NOVA)                                                 │

│  - installment_instance (NOVA)                                             │

│  - bill_adjustment (NOVA)                                                  │

│  - bill_audit_log (NOVA / estende auditoria)                               │

│  - provider_webhook_event (EXISTE: open_finance_evento)                    │

└─────────────────────────────────────────────────────────────────────────────┘

F. TARGET DATA MODEL — SCHEMA RECOMENDADO

F.1 Tabelas Novas

-- Entidade explícita de cartão (estende cartao atual)

CREATE TABLE credit_card (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id uuid NOT NULL REFERENCES conta(id),

  conta_financeira_id uuid REFERENCES conta_financeira(id),

  provider_card_reference text,

  masked_number text,

  holder text,

  card_type text, -- 'titular' | 'adicional' | 'virtual'

  metadata jsonb DEFAULT '{}',

  created_at timestamptz DEFAULT now(),

  updated_at timestamptz DEFAULT now(),

  UNIQUE (conta_financeira_id, provider_card_reference)

);

-- Fatura (estende fatura_oficial para cobrir abertas/futuras)

CREATE TABLE credit_card_bill (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id uuid NOT NULL REFERENCES workspace(id),

  credit_card_id uuid NOT NULL REFERENCES credit_card(id),

  provider_bill_id text,

  competencia text NOT NULL, -- YYYY-MM (mês do fechamento)

  period_start date NOT NULL,

  period_end date NOT NULL,

  close_date date NOT NULL,

  due_date date NOT NULL,

  total_amount numeric(14,2), -- oficial do banco (só quando fechada)

  lifecycle_status text NOT NULL DEFAULT 'open', -- 'open' | 'closed'

  payment_status text NOT NULL DEFAULT 'unpaid', -- 'unpaid' | 'partial' | 'paid'

  reconciliation_status text DEFAULT 'unreconciled', -- 'unreconciled' | 'reconciled' | 'disputed'

  version integer DEFAULT 1,

  created_at timestamptz DEFAULT now(),

  updated_at timestamptz DEFAULT now(),

  UNIQUE (credit_card_id, competencia)

);

-- Vínculo Transação ↔ Fatura (O CORAÇÃO DA MUDANÇA)

CREATE TABLE bill_allocation (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  transaction_id uuid NOT NULL REFERENCES movimento(id),

  bill_id uuid NOT NULL REFERENCES credit_card_bill(id),

  status text NOT NULL, -- 'confirmed' | 'predicted' | 'possible' | 'unresolved'

  method text NOT NULL, -- 'provider_bill_id' | 'provider_forecast' | 'rule_inferred' | 'historical_inferred' | 'matching' | 'math_validation'

  confidence_score integer, -- 0-100, informativo apenas

  allocated_amount numeric(14,2), -- snapshot do valor alocado na reconciliação

  valid_from timestamptz DEFAULT now(),

  valid_to timestamptz,

  is_current boolean DEFAULT true,

  created_at timestamptz DEFAULT now(),

  updated_at timestamptz DEFAULT now(),

  UNIQUE (transaction_id, bill_id, is_current) WHERE is_current

);

-- Plano de parcelamento (agrupa parcela 1/N)

CREATE TABLE installment_plan (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id uuid NOT NULL REFERENCES workspace(id),

  credit_card_id uuid NOT NULL REFERENCES credit_card(id),

  provider_installment_key text, -- fingerprint heurístico

  description text NOT NULL,

  total_amount numeric(14,2) NOT NULL,

  total_installments integer NOT NULL,

  purchase_date date NOT NULL,

  first_installment_date date,

  provider_metadata jsonb DEFAULT '{}',

  fingerprint text, -- hash determinístico para correlação

  created_at timestamptz DEFAULT now(),

  updated_at timestamptz DEFAULT now()

);

-- Instância de parcela (cada N/N)

CREATE TABLE installment_instance (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  plan_id uuid NOT NULL REFERENCES installment_plan(id),

  installment_number integer NOT NULL,

  amount numeric(14,2) NOT NULL,

  due_date date NOT NULL,

  is_virtual boolean DEFAULT true, -- true = projetada, false = real do provider

  provider_transaction_id text, -- idExterno da transação real

  transaction_id uuid REFERENCES movimento(id), -- quando materializada

  created_at timestamptz DEFAULT now(),

  updated_at timestamptz DEFAULT now(),

  UNIQUE (plan_id, installment_number)

);

-- Ajustes de fatura (diferenças explicadas)

CREATE TABLE bill_adjustment (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  bill_id uuid NOT NULL REFERENCES credit_card_bill(id),

  type text NOT NULL, -- 'unexplained_difference' | 'fee' | 'interest' | 'iof' | 'exchange_variation' | 'finance_charge' | 'credit' | 'other'

  amount numeric(14,2) NOT NULL, -- SIGNED: positivo = aumenta fatura, negativo = reduz

  description text,

  source_transaction_id uuid REFERENCES movimento(id),

  created_at timestamptz DEFAULT now(),

  created_by uuid REFERENCES usuario(id)

);

-- Auditoria específica de fatura/alocação

CREATE TABLE bill_audit_log (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  bill_id uuid REFERENCES credit_card_bill(id),

  allocation_id uuid REFERENCES bill_allocation(id),

  adjustment_id uuid REFERENCES bill_adjustment(id),

  action text NOT NULL, -- 'allocation_changed' | 'forecast_updated' | 'reconciled' | 'adjusted' | 'manual_intervention'

  previous_state jsonb,

  new_state jsonb,

  origin text NOT NULL, -- 'system' | 'provider' | 'user' | 'llm_explanation'

  version integer,

  created_at timestamptz DEFAULT now(),

  created_by uuid REFERENCES usuario(id)

);

F.2 Alterações em Tabelas Existentes

Tabela	Alteração	Motivo

movimento	Adicionar provider_bill_id (text), provider_bill_forecast_date (text)	Guardar evidências brutas L0/L1

movimento	Adicionar installment_plan_id (uuid)	Vincular ao plano de parcelamento

fatura_oficial	Renomear para credit_card_bill + estender colunas	Unificar fechadas + abertas + futuras

cartao	Estender para credit_card (nova tabela)	Suporte a adicional/virtual/múltiplos por conta

parcela	Manter para lançamentos manuais; OF usa installment_instance	Não misturar origens

G. FUTURE BILL ENGINE — ALGORITMO COMPLETO

G.1 Pseudo-Fluxo

async function forecastOpenBills(creditCardId: string, asOfDate: Date): Promise<BillForecast[]> {

  // 1. CARREGAR FATURAS ABERTAS/FUTURAS

  const openBills = await loadOpenBills(creditCardId, asOfDate);

  // Retorna: [{ billId, competencia, periodStart, periodEnd, closeDate, dueDate, lifecycleStatus }]

  

  // 2. CARREGAR TRANSAÇÕES CANDIDATAS (PENDING + POSTED sem billId + previstas)

  const candidateTransactions = await loadCandidateTransactions(creditCardId, openBills);

  // Inclui: status=PENDING, status=POSTED sem billId, status=PREVISTO, parcelas virtuais

  

  // 3. EVIDÊNCIAS DO PROVIDER

  const providerEvidence = extractProviderEvidence(candidateTransactions);

  // L0: transações com billId → CONFIRMED

  // L1: transações com billForecastDate → PREDICTED

  // L2+: sem evidência direta → regras

  

  // 4. HARD CONSTRAINTS (eliminam candidatos impossíveis)

  const constrained = applyHardConstraints(candidateTransactions, openBills);

  // - account/cartão incompatível

  // - período impossível (compra após fechamento da fatura)

  // - status incompatível (cancelada, removida)

  // - parcela incompatível (número > total)

  // - provider bill conflictante (billId aponta outra fatura)

  // - fatura já encerrada incompatível

  // - timezone/data incompatível

  

  // 5. CANDIDATE GENERATION

  const candidates = generateCandidates(constrained, openBills);

  // Para cada transação, lista de faturas possíveis com evidências

  

  // 6. WEIGHTED MATCHING

  const allocations = weightedMatching(candidates);

  // Score por método:

  // L0 PROVIDER_BILL_ID: 100

  // L1 PROVIDER_FORECAST: 90-95 (confiança baseada em histórico do banco)

  // L2 RULE_INFERRED (ciclo local): 70-85

  // L3 HISTORICAL_INFERRED: 60-75

  // L4 MATCHING (descrição/valor): 40-60

  // L5 MATH_VALIDATION (subset sum validação): +5 bonus

  // L6 UNRESOLVED: 0

  

  // 7. CLASSIFICATION

  const classified = classifyAllocations(allocations);

  // CONFIRMED: method = PROVIDER_BILL_ID

  // PREDICTED: method = PROVIDER_FORECAST + confidence >= 80

  // POSSIBLE: method in (RULE_INFERRED, HISTORICAL_INFERRED, MATCHING) + confidence >= 50

  // UNRESOLVED: tudo o mais

  

  // 8. FLOOR / CENTRAL / CEILING

  const forecast = computeFloorCentralCeiling(openBills, classified);

  // PISO = Σ CONFIRMED

  // CENTRAL = PISO + Σ PREDICTED

  // TETO = CENTRAL + Σ POSSIBLE

  // UNRESOLVED NÃO entra em nenhum

  

  // 9. PERSISTIR PROJEÇÃO (materialized view ou tabela)

  await persistForecast(forecast);

  

  return forecast;

}

G.2 Hard Constraints (Exemplos)

function applyHardConstraints(tx: Transaction, bills: Bill[]): Bill[] {

  return bills.filter(bill => {

    // 1. Cartão compatível

    if (tx.creditCardId !== bill.creditCardId) return false;

    

    // 2. Período: compra deve estar no ciclo da fatura

    const purchaseDate = tx.purchaseDate || tx.postedDate;

    if (purchaseDate < bill.periodStart || purchaseDate > bill.periodEnd) return false;

    

    // 3. Status válido

    if (tx.status === 'cancelled' || tx.statusFonte === 'removido') return false;

    

    // 4. Parcela: se tem parcelaNumero, fatura deve comportar

    if (tx.installmentNumber && tx.installmentNumber > 1) {

      // Verifica se a parcela N cabe no ciclo da fatura

      const expectedBill = computeBillForInstallment(tx);

      if (expectedBill !== bill.competencia) return false;

    }

    

    // 5. Provider bill conflict

    if (tx.providerBillId && tx.providerBillId !== bill.providerBillId) return false;

    

    // 6. Fatura já fechada: só aceita se billId bate

    if (bill.lifecycleStatus === 'closed' && !tx.providerBillId) return false;

    

    return true;

  });

}

G.3 Weighted Matching

interface CandidateScore {

  billId: string;

  transactionId: string;

  method: AllocationMethod;

  baseScore: number;

  modifiers: ScoreModifier[];

  finalScore: number;

}

const METHOD_BASE_SCORES: Record<AllocationMethod, number> = {

  'provider_bill_id': 100,

  'provider_forecast': 90,

  'rule_inferred': 75,

  'historical_inferred': 65,

  'matching': 50,

  'math_validation': 0, // só bonus

  'unresolved': 0,

};

function weightedMatching(candidates: Candidate[]): Allocation[] {

  // Para cada transação, escolhe a melhor fatura candidata

  // Se empate, usa tie-breakers: 

  // 1. Maior baseScore

  // 2. Menor distância temporal

  // 3. Parcela número 1 tem prioridade

  // 4. Histórico do usuário (banco específico)

}

H. CLOSED BILL ENGINE — PRESERVAÇÃO DO EXISTENTE

Regra: Não alterar o que já funciona.

// EXISTENTE (mantém)

function reconcileClosedBill(bill: CreditCardBill): ReconciliationResult {

  // 1. Autoridade: [bill.total](http://bill.total)_amount (do provider)

  const officialTotal = [bill.total](http://bill.total)_amount;

  

  // 2. Componentes explicados

  const allocations = await getBillAllocations([bill.id](http://bill.id), { status: 'confirmed' });

  const adjustments = await getBillAdjustments([bill.id](http://bill.id));

  

  const explainedSum = sum([allocations.map](http://allocations.map)(a => a.allocatedAmount)) 

                     + sum([adjustments.map](http://adjustments.map)(a => a.amount));

  

  // 3. Diferença

  const difference = officialTotal - explainedSum;

  

  // 4. Se diferença > tolerância → UNEXPLAINED_DIFFERENCE adjustment

  //    NÃO altera [bill.total](http://bill.total)_amount

  //    NÃO cria transação fantasma

  

  return { officialTotal, explainedSum, difference, isReconciled: Math.abs(difference) <= 0.01 };

}

Migração: Faturas fechadas existentes em fatura_oficial → credit_card_bill com lifecycle_status = 'closed', reconciliation_status = 'reconciled'.

I. INSTALLMENT ENGINE — VIRTUAL → REAL

// 1. DETECÇÃO (quando chega transação com parcelamento)

async function detectInstallmentPlan(tx: Transaction): Promise<InstallmentPlan | null> {

  if (!tx.installmentNumber || !tx.installmentTotal) return null;

  

  // Fingerprint heurístico (Pluggy não dá ID único do parcelamento)

  const fingerprint = computeInstallmentFingerprint({

    creditCardId: tx.creditCardId,

    purchaseDate: tx.purchaseDate,

    totalInstallments: tx.installmentTotal,

    totalAmount: tx.installmentTotalAmount,

    merchant: tx.merchantName,

  });

  

  // Busca plano existente

  let plan = await findPlanByFingerprint(fingerprint);

  

  if (!plan) {

    // Cria novo plano

    plan = await createInstallmentPlan({

      creditCardId: tx.creditCardId,

      description: tx.description,

      totalAmount: tx.installmentTotalAmount,

      totalInstallments: tx.installmentTotal,

      purchaseDate: tx.purchaseDate,

      fingerprint,

      providerMetadata: tx.rawProviderSnapshot,

    });

    

    // Cria TODAS as instâncias (1 a N) como VIRTUAL

    for (let n = 1; n <= tx.installmentTotal; n++) {

      await createInstallmentInstance({

        planId: [plan.id](http://plan.id),

        installmentNumber: n,

        amount: tx.amount, // valor da parcela

        dueDate: computeDueDate(plan, n),

        isVirtual: true,

      });

    }

  }

  

  return plan;

}

// 2. MATERIALIZAÇÃO (quando parcela real chega do provider)

async function materializeInstallmentInstance(

  planId: string, 

  installmentNumber: number, 

  realTransaction: Transaction

): Promise<void> {

  const instance = await getInstallmentInstance(planId, installmentNumber);

  

  if (instance.isVirtual) {

    // Atualiza instância virtual → real

    await updateInstallmentInstance([instance.id](http://instance.id), {

      isVirtual: false,

      providerTransactionId: realTransaction.providerTxId,

      transactionId: [realTransaction.id](http://realTransaction.id),

      amount: realTransaction.amount, // valor real pode diferir ligeiro

      dueDate: realTransaction.postedDate, // data real do provider

    });

    

    // Cria BillAllocation CONFIRMED para a fatura correspondente

    await createBillAllocation({

      transactionId: [realTransaction.id](http://realTransaction.id),

      billId: await findOrCreateBillForDate(realTransaction.postedDate),

      status: 'confirmed',

      method: 'provider_bill_id', // ou provider_forecast se billId vier depois

      confidenceScore: 100,

    });

  } else {

    // Já real: pode ser atualização de valor/data

    await updateInstallmentInstance([instance.id](http://instance.id), {

      amount: realTransaction.amount,

      dueDate: realTransaction.postedDate,

    });

  }

}

// 3. LIMPEZA: remove instâncias virtuais órfãs quando série se consolida

async function cleanupOrphanVirtualInstances(planId: string): Promise<void> {

  // Implementado hoje em: ids_projetadas_orfas_apos_uniao()

}

J. WEBHOOK ARCHITECTURE

J.1 Estrutura Atual (Já Boa)

-- EXISTE: open_finance_evento

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

J.2 Melhorias Necessárias

Melhoria	Implementação

Dead Letter Queue	Adicionar tentativas (int), proximo_retry (timestamptz), dead_letter_em

Ordenação	Processar por data_criacao ASC; transactions/updated antes de created se mesmo ID

Reprocessamento	Job cron que pega erro IS NOT NULL AND dead_letter_em IS NULL AND tentativas < 3

Métricas	Contadores: received, processed, failed, retried, dead_letter por provedor/tipo

J.3 Fluxo de Processamento Robusto

async function processWebhookEvent(event: ProviderWebhookEvent): Promise<void> {

  // 1. Idempotência: já processado com sucesso?

  if (event.processedAt && !event.error) return;

  

  // 2. Lock por conexão (evita concorrência mesmo item)

  await withLock`webhook:${event.connectionId}`, async () => {

    try {

      // 3. Interpretar

      const notification = adapter.interpretNotification(event.payload);

      

      // 4. Recoleta estado atual do provider se necessário

      // (para transactions/updated, buscar transação completa)

      const freshData = notification.type === 'movimentacoes_alteradas'

        ? await adapter.coletarPorIds(event.connectionId, notification.idsExternos)

        : null;

      

      // 5. Normalizar

      const eventos = adapter.normalize(freshData || notification);

      

      // 6. Ingestão (já idempotente por idExterno + fingerprint)

      await ingestionService.process(eventos);

      

      // 7. RECALCULAR PREVISÕES AFETADAS (incremental!)

      await forecastEngine.recalculateAffectedBills(eventos);

      

      // 8. Marcar sucesso

      await markEventProcessed([event.id](http://event.id));

    } catch (error) {

      await markEventFailed([event.id](http://event.id), error);

      // Retry será pego pelo cron

    }

  });

}

K. MIGRATION PLAN

K.1 Análise de Gap (Schema Atual → Target)

Tabela Atual	Tabela Target	Migração	Risco	Compatibilidade

cartao	credit_card	CREATE + COPY + FK swap	Médio	View de compatibilidade

fatura_oficial	credit_card_bill	ALTER TABLE + ADD COLUMNS	Baixo	Dados preservados

movimento	transaction (view)	ADD COLUMNS (bill_id, forecast, plan_id)	Baixo	Colunas nullable

—	bill_allocation	CREATE TABLE	Baixo	Nova, sem dados legacy

—	installment_plan	CREATE TABLE	Baixo	Nova

—	installment_instance	CREATE TABLE	Baixo	Nova

—	bill_adjustment	CREATE TABLE	Baixo	Nova

auditoria	bill_audit_log	CREATE TABLE (ou estender)	Baixo	Nova

open_finance_evento	provider_webhook_event	RENAME + ADD COLUMNS	Baixo	Dados preservados

K.2 Plano de Migrações (Ordem)

-- MIGRAÇÃO 1: Nova tabela bill_allocation (sem dados legacy)

CREATE TABLE bill_allocation (...);

-- MIGRAÇÃO 2: Novas tabelas installment_plan / installment_instance

CREATE TABLE installment_plan (...);

CREATE TABLE installment_instance (...);

-- MIGRAÇÃO 3: Nova tabela bill_adjustment

CREATE TABLE bill_adjustment (...);

-- MIGRAÇÃO 4: Nova tabela bill_audit_log

CREATE TABLE bill_audit_log (...);

-- MIGRAÇÃO 5: Estender movimento com colunas de alocação/parcelamento

ALTER TABLE movimento ADD COLUMN provider_bill_id text;

ALTER TABLE movimento ADD COLUMN provider_bill_forecast_date text;

ALTER TABLE movimento ADD COLUMN installment_plan_id uuid REFERENCES installment_plan(id);

-- Índices para performance

CREATE INDEX idx_movimento_provider_bill_id ON movimento(provider_bill_id);

CREATE INDEX idx_movimento_installment_plan_id ON movimento(installment_plan_id);

-- MIGRAÇÃO 6: Estender fatura_oficial → credit_card_bill

ALTER TABLE fatura_oficial RENAME TO credit_card_bill;

ALTER TABLE credit_card_bill ADD COLUMN lifecycle_status text DEFAULT 'closed';

ALTER TABLE credit_card_bill ADD COLUMN payment_status text DEFAULT 'paid';

ALTER TABLE credit_card_bill ADD COLUMN reconciliation_status text DEFAULT 'reconciled';

ALTER TABLE credit_card_bill ADD COLUMN version integer DEFAULT 1;

ALTER TABLE credit_card_bill ADD COLUMN period_start date;

ALTER TABLE credit_card_bill ADD COLUMN period_end date;

-- Backfill period_start/period_end a partir de competencia + fechamento do cartão

-- MIGRAÇÃO 7: Criar credit_card (nova) e migrar cartao

CREATE TABLE credit_card (...);

INSERT INTO credit_card SELECT ... FROM cartao;

-- Views de compatibilidade para código legado

CREATE VIEW cartao_compat AS SELECT ... FROM credit_card JOIN ...;

-- MIGRAÇÃO 8: Popular bill_allocation para faturas fechadas existentes

-- Para cada fatura_oficial (agora credit_card_bill lifecycle=closed):

--   Para cada movimento no ciclo da fatura:

--     INSERT bill_allocation (transaction_id, bill_id, status='confirmed', method='provider_bill_id', confidence=100)

--   Ajuste = total_oficial - soma_alocacoes → bill_adjustment se > 0.01

-- MIGRAÇÃO 9: Popular installment_plan/instance a partir de movimentos parcelados existentes

-- Usar agrupar_series_parcelamento() para detectar planos

-- Criar instâncias virtuais para parcelas futuras não materializadas

K.3 Dados Existentes — Estimativas

Métrica	Estimativa	Impacto Migração

Movimentos (movimento)	~100k-1M	ADD COLUMN nullable = instantâneo

Faturas oficiais	~1k-10k	Backfill allocation = job assíncrono

Cartões	~1k-10k	CREATE TABLE + INSERT = rápido

Parcelas (tabela parcela)	~10k-100k	Manter; OF não usa esta tabela

Webhooks processados	~10k-100k	Rename table = metadata only

L. TEST PLAN

L.1 Testes Unitários (Motor de Previsão)

describe('BillForecastEngine', () => {

  // Hierarquia de evidências

  it('L0: billId → CONFIRMED', () => {

    const tx = { providerBillId: 'bill-123', status: 'POSTED' };

    const bill = { providerBillId: 'bill-123' };

    expect(classify(tx, bill)).toEqual({ status: 'confirmed', method: 'provider_bill_id', score: 100 });

  });

  

  it('L1: billForecastDate → PREDICTED', () => {

    const tx = { providerBillForecastDate: '2026-10', status: 'PENDING' };

    const bill = { competencia: '2026-10' };

    expect(classify(tx, bill)).toEqual({ status: 'predicted', method: 'provider_forecast', score: 90 });

  });

  

  it('L2: Regra ciclo local → PREDICTED/POSSIBLE', () => {

    const tx = { purchaseDate: '2026-09-15', status: 'PENDING' };

    const bill = { competencia: '2026-10', closeDate: '2026-10-10' };

    expect(classify(tx, bill).method).toBe('rule_inferred');

  });

  

  // Hard constraints

  it('Rejeita cartão incompatível', () => { ... });

  it('Rejeita compra após fechamento', () => { ... });

  it('Rejeita fatura fechada sem billId', () => { ... });

  

  // Floor/Central/Ceiling

  it('Calcula piso/central/teto corretamente', () => {

    const bill = { 

      allocations: [

        { status: 'confirmed', amount: 2000 },

        { status: 'predicted', amount: 700 },

        { status: 'possible', amount: 300 },

        { status: 'unresolved', amount: 500 },

      ]

    };

    expect(computeForecast(bill)).toEqual({

      floor: 2000,

      central: 2700,

      ceiling: 3000,

    });

  });

  

  // PENDING → POSTED

  it('Atualiza PREDICTED → CONFIRMED quando billId chega', async () => {

    const allocation = await engine.allocate(txPending, bill);

    expect(allocation.status).toBe('predicted');

    

    // Simula webhook updated

    await engine.updateAllocation(txPosted, bill);

    expect(allocation.status).toBe('confirmed');

    expect(allocation.method).toBe('provider_bill_id');

  });

  

  // Parcelas

  it('Cria InstallmentPlan + N InstallmentInstance virtual', () => { ... });

  it('Materializa virtual → real sem duplicar', () => { ... });

  it('Projeta parcelas faltantes com datas corretas', () => { ... });

});

L.2 Testes de Integração

describe('Integração Pluggy → Forecast', () => {

  it('Caso 1: Compra hoje PENDING sem billId', () => { ... });

  it('Caso 2: Compra hoje PENDING com billForecastDate mês seguinte', () => { ... });

  it('Caso 4: PENDING → POSTED com billId', () => { ... });

  it('Caso 11: Compra parcelada 6x', () => { ... });

  it('Caso 12: Todas parcelas aparecem de uma vez', () => { ... });

  it('Caso 13: Parcelas aparecem mês a mês', () => { ... });

  it('Caso 17: Parcela desaparece e reaparece com outro ID', () => { ... });

  it('Caso 36: Webhook duplicado', () => { ... });

  it('Caso 37: Webhook fora de ordem', () => { ... });

  it('Caso 38: Webhook antes do sync', () => { ... });

  it('Caso 39: Sync antes do webhook', () => { ... });

});

L.3 Testes de Regressão (Faturas Fechadas)

describe('Regression: Closed Bills Unchanged', () => {

  it('Fatura fechada mantém total oficial', () => { ... });

  it('Conciliação: total = soma alocações + ajustes', () => { ... });

  it('Pagamento no intervalo fecha→vence ainda funciona', () => { ... });

  it('Status paga/parcial/em_aberto inalterados', () => { ... });

  it('Dashboard fatura fechada mostra mesmo valor', () => { ... });

});

L.4 Testes com Dados Reais Anonimizados

- Exportar subset de dados de produção (anonimizado)

- Rodar forecast engine e comparar com valores reais das faturas fechadas

- Validar: PISO ≤ real ≤ TETO em >95% dos casos

M. VEREDITO FINAL OBRIGATÓRIO

1. Arquitetura atual: AJUSTADA (não reescrita)

Por quê: 

- 80% da base já existe e funciona (faturas fechadas, parcelamento, webhook inbox, fingerprint, idempotência)

- Lacunas são pontuais: BillAllocation, InstallmentPlan/Instance, BillForecastEngine separado, status de previsão

- Reescrita total quebraria faturas fechadas e traria risco desnecessário

2. Fatura fechada precisa ser alterada? NÃO

Apenas migração de dados para nova tabela credit_card_bill com lifecycle_status='closed'. Lógica de reconciliação (aplicar_total_oficial, somar_pagamentos_fatura) permanece idêntica.

3. Problema principal das faturas futuras está em: MODELAGEM + ALLOCATION

- Modelagem: Não existe BillAllocation explícita → associação implícita e não rastreável

- Allocation: billId ignorado, billForecastDate tratado como fallback, sem hierarquia de evidências

- Previsão: Engine misturado com reconciliação; não gera Piso/Central/Teto; não distingue CONFIRMED/PREDICTED/POSSIBLE

4. Modelo Transaction + BillAllocation + CreditCardBill resolve isolamento Movimento/Fatura? SIM

- Transaction (movimento) = fato financeiro imutável

- BillAllocation = vínculo mutável com status/método/confiança/histórico

- CreditCardBill = container da cobrança (oficial ou prevista)

- Permite: mesma transação prevista em Outubro → confirmada em Novembro sem perder histórico

5. InstallmentPlan + InstallmentInstance é adequado? SIM

- Resolve: parcelas futuras não geram transactions falsas (is_virtual)

- Resolve: virtual → real sem duplicata (mesma instância, is_virtual: false)

- Resolve: fingerprint heurístico para agrupar sem ID universal do provider

- Mantém: tabela parcela para lançamentos manuais (não misturar origens)

6. WebhookInbox é necessário? JÁ EXISTE (open_finance_evento)

Precisa apenas: dead letter, retry counters, métricas, ordenação garantida.

7. BillAdjustment está corretamente definido? SIM, com ressalva

- signed amount (positivo=aumenta, negativo=reduz) ✅

- Tipos bem definidos ✅

- Regra crítica: NÃO usar para esconder UNRESOLVED → auditoria deve enforcar

8. Há alguma migration perigosa? MIGRAÇÃO 8 (backfill allocation) é a única de risco médio

- Job assíncrono, idempotente, com dry-run

- Validar: Σ allocations + adjustments = total_oficial para cada fatura fechada

- Rollback: DROP TABLE bill_allocation + restaurar view compatibilidade

9. Existe ressão nas faturas fechadas? NÃO, se:

- Migration 8 validada com aplicar_total_oficial() resultado idêntico

- BillReconciliationEngine usa mesma lógica atual

- Testes de regressão (L.3) passam em CI

10. Qual é o menor conjunto de mudanças necessário para corrigir as faturas futuras?

Prioridade	Mudança	Esforço

P0	Criar bill_allocation + popular para faturas fechadas	2-3 dias

P0	Criar BillForecastEngine separado (extrai de montar_serie_faturas_dashboard)	3-5 dias

P0	Extrair billId e billForecastDate no adaptador Pluggy	1 dia

P1	Implementar status CONFIRMED/PREDICTED/POSSIBLE/UNRESOLVED	2 dias

P1	Implementar Piso/Central/Teto no dashboard	2 dias

P1	Criar installment_plan + installment_instance + migrar parcelas OF	3-4 dias

P2	Estender credit_card (adicional/virtual)	2 dias

P2	BillAdjustment + BillAuditLog	2 dias

P2	Melhorias webhook inbox (dead letter, retry)	1 dia

Total estimado: ~16-21 dias de engenharia (não inclui testes/QA).

N. CRITÉRIOS DE APROVAÇÃO (Checklist Final)

Critério	Status Atual	Ação Necessária

[ ] Faturas fechadas continuam preservadas	✅	Migração apenas de dados

[ ] Faturas futuras têm Forecast Engine separado	❌	Criar BillForecastEngine

[ ] billId é autoridade quando disponível	❌	Extrair no adaptador + usar no engine

[ ] billForecastDate tratado como previsão (L1)	⚠️ Parcial	Hierarquia L0>L1>L2...

[ ] PENDING e POSTED tratados corretamente	⚠️ Parcial	Atualização deve virar CONFIRMED

[ ] Parcelas futuras não geram transactions falsas	⚠️ Parcial	is_virtual em installment_instance

[ ] Virtual → real possível	⚠️ Parcial	materializeInstallmentInstance()

[ ] UNRESOLVED separado de Adjustment	❌	Enforcar no AdjustmentEngine

[ ] Score não confundido com verdade	❌	Status + Method + Score separados

[ ] Webhook idempotente	✅	Já existe

[ ] Eventos fora de ordem suportados	⚠️ Parcial	Lock por conexão + ordenação

[ ] Delete/recreate tratado	⚠️ Parcial	Fingerprint reidentifica

[ ] Múltiplos cartões suportados	✅	conta_financeira já existe

[ ] Histórico de alterações preservado	⚠️ Parcial	bill_audit_log + valid_from/to

[ ] Reconciliação fechada funciona	✅	Preservar lógica atual

[ ] LLM não participa da determinação financeira	✅	Já isolado

[ ] Migrations não perdem dados	✅	Plano com rollback

[ ] Testes cobrem casos extremos	❌	Implementar plano L

FIM DA AUDITORIA

Agora, com o modo "build" ativo e o arquivo não existindo no disco, vou apresentar o plano de implementação arquivo por arquivo, focando nas mudanças necessárias para corrigir as faturas futuras sem quebrar as faturas fechadas.

O plano segue as 5 fases definidas na auditoria, começando pela fundamentação e progredindo incrementalmente.