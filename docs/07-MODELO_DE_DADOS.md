# 07 — Modelo de dados

Estrutura física do banco: o que existe hoje, o que a arquitetura-alvo acrescenta e como a imutabilidade do Fato Financeiro é garantida.

**Este documento não cobre:** o significado de negócio das entidades — ver [01-DOMINIO.md](01-DOMINIO.md). Regras de cálculo sobre esses dados — ver [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md). Interfaces TypeScript e contratos entre módulos — ver [08-CONTRATOS.md](08-CONTRATOS.md).

---

## 1. Convenções

- Todas as tabelas vivem em `pacotes/banco/src/schema`, uma por arquivo, exportadas por `index.ts`.
- Definidas com Drizzle ORM sobre Supabase Postgres.
- Chave primária sempre `uuid` com `defaultRandom()`.
- Nomes de tabela e coluna em `snake_case`, singular. Os campos TypeScript correspondentes usam `camelCase` (`dataMovimento` ↔ `data_movimento`).
- Valores monetários são `numeric(14, 2)` e chegam ao TypeScript **como string**, para não perder precisão. Nunca converter para `float` em cálculo financeiro.
- Datas de calendário são `date` (sem hora); marcas temporais são `timestamp with time zone`.
- Toda tabela de dados tem `data_criacao` e `data_atualizacao`.
- O sistema é append-only: nenhuma rotina executa `DELETE` em `movimento` ou `parcela`. Cancelar significa mudar `status`.

---

## 2. Enums

Arquivo `enums.ts`. Alterar um enum exige migração, então a lista é parte do contrato.

- `perfil`: `pf`, `pj`
- `tipo_categoria`: `receita`, `despesa`, `ambos`
- `tipo_pessoa`: `cliente`, `fornecedor`, `socio`, `funcionario`, `familiar`
- `tipo_movimento`: `receita`, `despesa`, `transferencia`, `reembolso`, `emprestimo`, `estorno`, `retirada`, `aporte`
- `status_movimento`: `previsto`, `realizado`, `cancelado` — usado em `movimento` e em `parcela`
- `acao_auditoria`: `INSERCAO`, `ALTERACAO`, `CANCELAMENTO`
- `status_sessao`: `ativa`, `encerrada`
- `papel_chat`: `usuario`, `sistema`, `ia`
- `modalidade_cartao`: `credito`, `debito`, `multiplo`
- `forma_pagamento`: `pix`, `transferencia`, `boleto`, `dinheiro`, `credito`, `debito`
- `tipo_fonte`: `open_finance`, `manual`, `whatsapp`, `api`, `recorrencia`, `ofx`, `csv`, `pdf` — os três últimos estão reservados e sem implementação
- `status_fonte`: `confirmado`, `pendente` — situação na instituição, não confundir com `status_movimento`
- `classificado_por`: `regra`, `ia`, `usuario`
- `papel_workspace`: `dono`, `editor`, `leitor`
- `status_conexao`: `ativa`, `sincronizando`, `precisa_atencao`, `removida` — vocabulário nosso, traduzido do status do provedor pelo adaptador
- `motivo_atencao`: `credencial_invalida`, `consentimento_revogado`, `aguardando_usuario`, `erro_no_provedor`
- `posicao_painel`: `lateral`, `inferior` — preferência do assistente no cockpit

---

## 3. Tabelas atuais

### `usuario`
`id`, `nome`, `email` (único), `whatsapp_numero` (único, só dígitos, nulo até o primeiro vínculo), `posicao_painel` (`lateral` | `inferior`, padrão `lateral`), `ativo`, `data_criacao`, `data_atualizacao`.

O `id` é o mesmo UUID do `auth.users.id` do Supabase. Não existe tabela de vínculo: após login, o frontend chama `POST /usuarios/sincronizar`, que é idempotente.

### `conta`
`id`, `nome`, `saldo_inicial`, `saldo_atual`, `perfil`, `ativo`, `usuario_id`, `data_criacao`, `data_atualizacao`.

### `cartao`
`id`, `nome`, `limite`, `fechamento` (dia do mês), `vencimento` (dia do mês), `melhor_dia_compra` (dia seguinte ao fechamento), `perfil`, `modalidade`, `ativo`, `final4`, `dados_plasticos_cifrados`, `conta_id` (opcional), `usuario_id`, `data_criacao`, `data_atualizacao`.

Dois campos exigem cuidado:

- `final4` guarda apenas os últimos quatro dígitos, em claro, para identificação na interface.
- `dados_plasticos_cifrados` é um payload AES-256-GCM em base64 contendo número, validade e CVV. **Nunca** deve ser devolvido em listagem pública; só após validação de senha no chat.

`conta_id` é a conta preferencial para pagar a fatura, e é opcional: o pagamento pode usar qualquer conta no momento do lançamento.

### `categoria`
`id`, `nome`, `tipo` (`tipo_categoria`), `ativo`, `usuario_id`, `data_criacao`, `data_atualizacao`.

Uma categoria tem significado especial: **“Não classificado”**, criada no seed e, se faltar, na primeira ingestão de uma Fonte. É onde toda movimentação vinda de fora pousa antes de o Conhecimento classificá-la. Não é “Outros”: “Outros” é escolha do usuário, “Não classificado” é a ausência de escolha, e juntar as duas tornaria impossível listar o que ainda falta classificar.

### `pessoa`
`id`, `nome`, `tipo` (`tipo_pessoa`), `ativo`, `usuario_id`, `data_criacao`, `data_atualizacao`.

### `movimento`
`id`, `descricao`, `valor`, `tipo`, `status` (padrão `realizado`), `perfil`, `forma_pagamento` (anulável), `data_movimento`, `data_lancamento`, `conta_id` (opcional), `cartao_id` (opcional), `categoria_id` (obrigatório), `pessoa_id` (opcional), `usuario_id`, `data_criacao`, `data_atualizacao`, `criado_por`, `alterado_por` (opcional).

`conta_id` e `cartao_id` são individualmente opcionais, mas o `MotorFinanceiro` exige pelo menos um dos dois.

Do lado do Fato existem ainda `fonte`, `provedor`, `id_externo`, `descricao_fonte`, `favorecido_fonte`, `status_fonte` e as quatro colunas de parcelamento informado pela instituição: `parcela_numero`, `parcela_total`, `parcela_compra_em` e `parcela_compra_valor`, nulas em tudo que não é parcela de cartão.

### `parcela`
`id`, `movimento_id`, `numero_parcela`, `valor`, `data_movimento` (vencimento projetado), `status`, `data_criacao`, `data_atualizacao`.

Esta tabela é **só do lado manual**: um movimento pai e N filhas, projetadas a partir do fechamento do cartão. Compra parcelada que vem de Open Finance não passa por aqui — a instituição entrega cada parcela como transação independente, e cada uma vira um Fato próprio, com o parcelamento nas colunas `parcela_*` do próprio `movimento`. Ver seção 8.7 de [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).

### `orcamento`
`id`, `usuario_id`, `categoria_id` (nulo significa teto mensal geral), `valor_limite`, `mes_referencia` (primeiro dia do mês, quando não recorrente), `recorrente_mensal` (padrão `true`), `ativo`, `data_criacao`, `data_atualizacao`.

### `recorrencia`
Definida no mesmo arquivo de `orcamento`. Representa assinatura ou despesa recorrente mensal, o que é diferente de parcela de cartão.

`id`, `usuario_id`, `descricao`, `valor`, `tipo` (padrão `despesa`), `categoria_id`, `conta_id` (opcional), `cartao_id` (opcional), `dia_do_mes`, `ativa`, `ultima_geracao` (último mês gerado, formato `YYYY-MM`, garante idempotência do cron), `data_criacao`, `data_atualizacao`.

### `memoria`
`id`, `workspace_id`, `chave`, `valor` (texto), `usuario_id`, `data_criacao`, `data_atualizacao`.

Par chave/valor de hábitos/preferências. Persistido pelo `Memoria` dentro de `modulos/conhecimento` (absorvido na F3).

### `auditoria`
`id`, `tabela`, `registro_id`, `acao`, `estado_anterior` (JSON), `estado_atual` (JSON), `alterado_por`, `data_criacao`.

Esta é a **única** trilha de histórico do sistema. A arquitetura-alvo reutiliza `auditoria` para o histórico de classificação, em vez de criar mecanismo próprio de versionamento.

### `sessao`
`id`, `usuario_id`, `status` (`status_sessao`), `data_criacao`, `data_atualizacao`.

### `chat`
`id`, `sessao_id`, `papel` (`papel_chat`), `conteudo`, `intencao_detectada` (JSON, opcional), `data_criacao`.

### `evolution_evento`
`id`, `evento`, `instancia`, `payload` (JSONB, sem o campo `apikey`), `data_evento`, `data_criacao`.

Eventos brutos do webhook da Evolution, sem processamento. Serve para depuração e idempotência.

Não existe tabela `empresa` — ver [01-DOMINIO.md](01-DOMINIO.md) e [ADR-007](adr/README.md).

---

## 4. Estado-alvo do `movimento`: Fato e Conhecimento

Esta é a mudança central da fase F1.

### 4.1 Decisão: uma tabela, dois grupos de colunas

Foi considerado separar Fato e Conhecimento em duas tabelas 1:1 e **recusado**: o custo seria um join em todo relatório, listagem de extrato e consulta da IA, em troca de uma garantia que se obtém mais barato.

```text
movimento
  -- FATO (imutável quando fonte = 'open_finance')
  id, workspace_id, fonte, provedor, id_externo
  valor, data_movimento, conta_id, cartao_id
  descricao_fonte, favorecido_fonte, status_fonte

  -- CONHECIMENTO (sempre mutável)
  categoria_id, pessoa_id, perfil, tags, observacoes
  classificado_por, confianca_ia, ignorado_em_relatorio
```

As colunas atuais permanecem. `tipo`, `status`, `forma_pagamento`, `data_lancamento`, `criado_por` e `alterado_por` seguem existindo com o mesmo papel.

### 4.2 As três camadas que garantem a imutabilidade

A invariante do [ADR-009](adr/009-fato-vs-conhecimento.md) não depende de disciplina do desenvolvedor. Ela é imposta em três níveis independentes:

1. **Nomes de coluna** agrupados: quem lê o schema vê onde está a fronteira.
2. **APIs distintas**: `CoreFinanceiro` não aceita categoria nem tag; `ServicoConhecimento` não aceita valor, data nem conta. Ver [08-CONTRATOS.md](08-CONTRATOS.md).
3. **Trigger no Postgres**: rejeita `UPDATE` em qualquer coluna do grupo Fato, e também `DELETE`, quando `fonte = 'open_finance'`. O banco recusa a escrita errada mesmo que o código erre. O erro sai com SQLSTATE `LA001`, para que o Core o traduza em erro de domínio sem depender do texto da mensagem.

A terceira camada é o que torna a garantia real. Ela veio junto com a migração da F1, em `0008_trigger_imutabilidade_fato.sql`.

**A sincronização é a única exceção.** A instituição muda de opinião: uma transação pendente é confirmada, um valor é ajustado. Se o trigger fosse absoluto, ele bloquearia justamente quem tem autoridade sobre o Fato. Por isso existe `SET LOCAL "lancai.sincronizacao" = 'on'`, e só dentro dessa transação o trigger libera a escrita. O escopo `LOCAL` faz a porta fechar sozinha no fim — não existe estado a limpar nem risco de vazar para outra requisição.

Quem declara é o **Core**, em `atualizarFatosDaFonte`, e não o módulo `open-finance`. O comentário da migração 0008 diz o contrário porque foi escrito antes de a porta existir; a autoridade ficou onde já estava toda a escrita de movimento, e o módulo pede em vez de escrever. Continua valendo a parte que importa: é a única linha de código no sistema que declara essa chave, e chega-se a ela por exatamente duas portas — `atualizar_fatos_da_fonte` e `remover_fatos_da_fonte`, ambas restritas ao que a instituição anunciou.

`DELETE` não tem porta, e não vai ter. Quando a instituição desfaz uma transação, `status_fonte` passa a `removido` e o movimento é cancelado: a linha fica, o saldo volta, e a auditoria de algo que existiu não é destruída.

### 4.3 Colunas novas de Fato

- `fonte` — enum novo `tipo_fonte`: `open_finance`, `manual`, `whatsapp`, `api`, `recorrencia`, e os reservados `ofx`, `csv`, `pdf`.
- `provedor` — texto anulável. Rótulo opaco, como `pluggy`. O Core armazena e nunca interpreta.
- `id_externo` — identificador da transação na instituição ou hash do arquivo importado. Anulável. É a chave de deduplicação.
- `descricao_fonte` — descrição original, nunca reescrita.
- `favorecido_fonte` — favorecido informado pela instituição, anulável.
- `status_fonte` — `confirmado` ou `pendente`.

### 4.4 Colunas novas de Conhecimento

- `tags` — array de texto.
- `observacoes` — texto anulável.
- `classificado_por` — `regra`, `ia` ou `usuario`. Tem uso imediato: impede que uma regra sobrescreva a classificação feita à mão e sustenta a explicabilidade.
- `regra_id` — FK anulável para `regra`. Preenchida quando a classificação veio de uma regra; `ON DELETE SET NULL` se a regra sumir.
- `classificado_em` — quando a origem da classificação mudou pela última vez (explicabilidade: “você ensinou em 03/08”).
- `confianca_ia` — numérico anulável entre 0 e 1. Uma coluna só, difícil de retroalimentar depois, que habilita a fila de revisão de baixa confiança. Não há sistema de scoring por trás.
- `ignorado_em_relatorio` — booleano. É a saída para quando o usuário quer “apagar” algo vindo do banco: esconde das agregações sem tocar no Fato.

Ficam **adiadas**, por ausência de caso de uso concreto — `tags` cobre a necessidade inicial: subcategoria, projeto, centro de custo, cliente, fornecedor e reembolsável como colunas dedicadas. Ver [06-ROADMAP.md](06-ROADMAP.md).

### 4.5 As duas descrições

`movimento` já tinha `descricao`, e o Fato exige `descricao_fonte`. As duas convivem, e a F1 resolveu a quem cada uma pertence:

- `descricao_fonte` é **Fato**. É o que a instituição mandou (`COMPRA CARTAO 1234 SUPERMERCADO XY`) ou o que foi digitado na criação. Nunca é reescrita e o trigger a protege.
- `descricao` é **Conhecimento**. É a versão enxuta que aparece na conversa e na interface (`Mercado`), editável a qualquer momento, inclusive em conta sincronizada.

A consequência prática é boa: dizer "renomeia esse lançamento para Mercado" funciona em conta sincronizada, porque só o Conhecimento muda. O original continua auditável ao lado.

---

## 5. Tabelas novas

### `workspace`
`id`, `nome`, `tipo` (`pessoal` ou `empresa`), `data_criacao`, `data_atualizacao`.

### `workspace_membro`
`id`, `workspace_id`, `usuario_id`, `papel` (`dono`, `editor`, `leitor`), `data_criacao`, `data_atualizacao`, com unicidade em (`workspace_id`, `usuario_id`).

### `regra`
Builder de condições e ações. A linha ainda tem `workspace_id` (onde foi criada), mas o motor trata regras como **gerais do usuário**: matching e “aplicar a existentes” consideram todos os workspaces em que o usuário é dono. Migrações `0013_regra` e `0023_regra_builder`.

`id`, `workspace_id`, `origem` (`manual` | `aprendizado_conversa`), `ativa`, `nome`, `logica_condicoes` (`e` | `ou`), `condicoes` (jsonb), `acoes` (jsonb), `data_criacao`, `data_atualizacao`.

Colunas legadas (`condicao_tipo`, `condicao_valor`, `categoria_id`, `perfil`) permanecem anuláveis para compatibilidade/backfill; o motor e a API leem o formato novo.

**`condicoes`:** array de `{ campo, operador, valor }`. Campos: `descricao`, `valor`, `data`, `tipo`, `conta`, `cartao`. Operadores: `comeca_com`, `contem`, `nao_contem`, `igual`, `diferente`, `termina_com`, `regex`. Descrição casa em `descricao` + `descricao_fonte` + `favorecido_fonte`.

**`acoes`:** array de `{ tipo, ... }` — `definir_categoria`, `definir_beneficiario`, `adicionar_tags_notas`, `ignorar_transacao`, e `definir_perfil` (legado/backfill). Sem prioridade numérica: entre regras que casam, condição mais específica primeiro, depois `data_criacao` ASC.

**JSONB justificado:** várias condições com E/OU e ações heterogêneas não cabem em colunas tipadas sem explode de schema; o Zod da API valida o formato.

### Tabelas do módulo de Open Finance

Criadas na migração `0009_open_finance`. Pertencem a `modulos/open-finance` e **nenhum outro módulo as lê** — a fronteira do [ADR-011](adr/011-open-finance-isolado.md) é de dependência de código, não de localização de arquivo, então elas ficam no schema único do Drizzle como todas as outras.

- **`open_finance_conexao`:** `id`, `workspace_id`, `criado_por`, `provedor`, `id_externo`, `instituicao`, `status`, `motivo_atencao`, `consentimento_expira_em`, `ultimo_sync_em`, `ultimo_resumo_ingestao` (jsonb), `configuracoes` (jsonb), `data_criacao`, `data_atualizacao`, com unicidade em (`provedor`, `id_externo`).

  `criado_por` existe porque a ingestão precisa de autor para o Fato e para a auditoria, e webhook não tem usuário logado.

- **`open_finance_conta_externa`:** `id`, `conexao_id`, `id_externo`, `nome`, `tipo`, `conta_id`, `cartao_id`, `data_criacao`, `data_atualizacao`, com unicidade em (`conexao_id`, `id_externo`).

  `conta_id` e `cartao_id` são opcionais e mutuamente exclusivos na prática. Sem um dos dois preenchido, a movimentação daquela conta é descartada na ingestão: associar conta é ato do usuário.

- **`open_finance_evento`:** `id`, `provedor`, `evento_id`, `tipo`, `payload` (jsonb), `processado_em`, `erro`, `data_criacao`, com unicidade em (`provedor`, `evento_id`). Após ~30 dias o `payload` vira stub LGPD; a linha permanece.

  A unicidade é o mecanismo de idempotência, e o `INSERT` vem antes de qualquer processamento. Consultar-antes-de-inserir seria mais legível e estaria errado: duas entregas simultâneas do mesmo evento passariam pela consulta e processariam em dobro.

A foreign key de `conexao_id` foi nomeada à mão (`open_finance_conta_externa_conexao_fk`) porque o nome que o Drizzle deriva passa de 63 caracteres e o Postgres o truncaria, deixando snapshot e banco divergentes.

Detalhamento do módulo em [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).

---

## 6. `workspace_id`

`workspace_id` entra em todas as tabelas de dados na primeira migração da F1, mesmo antes de existir qualquer interface de workspace.

Esta é a **única** antecipação aceita na arquitetura, porque é barata agora e proibitivamente caro depois: retrofitar escopo de tenancy em um banco com dados de produção é uma migração de risco. Ver [ADR-013](adr/013-workspace-id-desde-a-primeira-migracao.md).

Até a fase F6, um workspace é criado automaticamente por usuário.

---

## 7. Migração dos dados existentes

Aplicada na F1. Os movimentos que já existiam passaram a ter:

- `fonte` igual a `manual`. O registro atual não distingue o que entrou por conversa do que entrou por cadastro, e inventar essa distinção retroativamente seria pior do que assumir o valor mais conservador.
- `provedor` e `id_externo` nulos
- Fato mutável, porque não vieram de instituição
- `descricao_fonte` preenchida com a `descricao` da época
- `classificado_por` igual a `usuario`
- `workspace_id` apontando para o workspace pessoal criado para o dono

Nenhum dado foi perdido. Sequência completa em [06-ROADMAP.md](06-ROADMAP.md).

---

## 8. Como as migrações são escritas

Escrever o SQL à mão em `drizzle/NNNN_nome.sql`, separando comandos com `--> statement-breakpoint`, e registrar a entrada correspondente em `drizzle/meta/_journal.json`. O `db:migrate` aplica o que está no journal e ainda não está registrado no banco, comparando apenas o campo `when`.

A escrita à mão dá controle sobre coisas que o gerador não expressa — backfill entre `ADD COLUMN` e `SET NOT NULL`, índices parciais, triggers, renomear constraint em vez de recriá-la — que é exatamente o que a F1 e a F2 precisaram.

### O snapshot, que estava quebrado e foi consertado

Por muito tempo `drizzle/meta` tinha apenas o snapshot da `0000`, porque as migrações `0001` a `0008` foram todas manuais e nenhuma deixou snapshot. Consequência: `drizzle-kit generate` diffava o schema atual contra um estado de meses atrás e produzia uma migração tentando recriar tudo — foi exatamente o que aconteceu na primeira tentativa de gerar a `0009`.

Isso foi corrigido. A `0009` trouxe um snapshot que retrata o schema **completo**, então o gerador voltou a ter uma base correta: hoje `pnpm --filter @lancai/banco db:generate` responde *“No schema changes”*, e a partir daqui ele passa a produzir diffs corretos.

O uso recomendado é híbrido, e o gerador vira ferramenta de conferência mais do que de autoria:

1. Alterar o schema em TypeScript.
2. Rodar `db:generate` e **ler** o SQL produzido. Ele mostra o que o Drizzle acha que falta.
3. Se o SQL estiver correto e completo, aproveitar. Se não — e no caso de backfill, trigger ou renomeação ele não estará —, escrever o arquivo à mão e apagar o gerado.
4. Manter o snapshot gerado e ajustar o `tag` no journal para um nome descritivo. **O snapshot é o que precisa sobreviver**, mesmo quando o SQL é descartado: é ele que mantém a próxima geração honesta.

O passo 4 é o que estava faltando antes, e é a razão de o estado ter divergido. Rodar `db:generate` depois de aplicar uma migração e confirmar que ele não vê diferença é a forma barata de saber que schema, snapshot e banco continuam concordando.
