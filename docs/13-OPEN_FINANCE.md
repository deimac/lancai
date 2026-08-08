# 13 — Open Finance

Open Finance é **uma Fonte Financeira**, não o centro do sistema. Este documento descreve o módulo que a implementa e, principalmente, a fronteira que ele nunca deve atravessar.

**Este documento não cobre:** o contrato de Fonte Financeira em si — ver [08-CONTRATOS.md](08-CONTRATOS.md). A separação entre Fato e Conhecimento — ver [01-DOMINIO.md](01-DOMINIO.md).

---

## 1. O princípio

Nenhum módulo fora de `modulos/open-finance` pode depender de Pluggy ou de qualquer outro provedor. Consequências práticas:

- O Core Financeiro **nunca** conhece Pluggy. Ele recebe `EventoFinanceiroNormalizado` e não sabe de onde veio.
- O campo `provedor` é um rótulo opaco: nenhum `if (provedor === "pluggy")` deve existir fora deste módulo.
- O `apps/web` não tem provedor fixo no código: pergunta à API quais fontes estão ativas e renderiza o widget correspondente.
- As configurações específicas de provedor ficam dentro do módulo, não em coluna compartilhada do Core.

Trocar de provedor no futuro deve significar escrever um adaptador novo e apagar o antigo, sem tocar em mais nada. Esse é o teste da fronteira, e ele só será provado de verdade quando existir um segundo provedor. Ver [ADR-011](adr/011-open-finance-isolado.md).

---

## 2. A porta do provedor

O módulo expõe internamente uma porta `ProvedorOpenFinance`, e o resto do módulo trabalha contra ela. Ela é a **única** superfície do sistema que conhece um provedor concreto. Assinatura implementada em `modulos/open-finance/src/provedor.ts`.

Responsabilidades da porta:

- Iniciar uma conexão e devolver o que o frontend precisa para abrir o widget
- Listar as contas e cartões disponíveis em uma conexão
- Traduzir o lote que o provedor anunciou, e buscar movimentações por identificador
- Informar o estado da conexão, incluindo consentimento expirado
- Interpretar o webhook

A pesquisa da seção 8 mudou a forma da porta em dois pontos.

**Não existe “buscar o que há de novo desde X”.** A ingestão é reativa (8.2): o provedor é dono do sync e anuncia o lote. A porta tem “traduzir este lote” e “buscar estas movimentações”, nada que se pareça com puxar.

**A porta devolve `MovimentacaoExterna`, não `EventoFinanceiroNormalizado`.** Esta é uma correção do que este documento dizia. O adaptador não tem como produzir o evento do Core: ele conhece a conta pelo identificador do provedor e não sabe nada de `workspaceId` nem de `contaId`. Fazer a porta prometer `EventoFinanceiroNormalizado` obrigaria a passar contexto local para dentro do adaptador, que é justamente a fronteira que o [ADR-011](adr/011-open-finance-isolado.md) protege. A tradução acontece em dois passos:

1. O adaptador traduz o formato do provedor em `MovimentacaoExterna` — Fato puro, identificado pela conta **externa**.
2. O serviço de ingestão completa com workspace e conta local, consultando o mapa de contas, e só então entrega `EventoFinanceiroNormalizado` ao Core.

O mapa de contas é o que fica no meio, e é por isso que ele existe: o adaptador sabe traduzir a instituição mas não conhece nossas contas; o Core conhece nossas contas mas não sabe o que é um provedor.

`NotificacaoFonte` é vocabulário nosso — “chegou lote novo”, “estas movimentações mudaram”, “estas foram removidas”, “a conexão precisa de atenção”, “a conexão foi removida”, “ignorada” —, e é o que impede o nome dos eventos da Pluggy de circular fora do módulo. `ReferenciaLote` é `string` sem estrutura de propósito: dar forma a um cursor aqui deixaria o desenho de paginação de um provedor vazar para o módulo.

### O dublê

Existe um `ProvedorDuble` em memória, no código de produção e não só nos testes. Ele prova o fluxo de ingestão ponta a ponta sem contrato assinado, e continua útil depois: o sandbox da Pluggy entrega dado ilustrativo (8.8), que não serve de fixture de teste automatizado.

Em desenvolvimento, com `OPEN_FINANCE_PROVEDOR=duble`, a tela `/conexoes` cria a conexão sem widget (`POST /open-finance/duble/conexoes`) e dispara um lote de amostra (`POST /open-finance/duble/conexoes/:id/sincronizar`) — mesmo pós-processo do webhook (conciliação, classificação, alerta). Checklist em [15-OPERACAO.md](15-OPERACAO.md). Isso **não** substitui o sandbox Pluggy para fechar a F2.

O formato de webhook do dublê é **deliberadamente diferente** do da Pluggy. Se um teste passa no dublê e falha no adaptador real, o problema está no adaptador — um formato só provaria menos.

Qual provedor está ativo vem de `OPEN_FINANCE_PROVEDOR`, traduzido em adaptador por `criar_provedor_open_finance`, dentro do módulo. Sem a variável, a Fonte está desligada e o webhook responde 503. Com um valor sem adaptador, ou com credencial faltando, a montagem **falha** em vez de cair no dublê: uma Fonte que finge estar conectada ao banco é pior do que uma Fonte desligada.

O adaptador da Pluggy já existe e implementa a porta inteira — detalhe em 8.10.

---

## 3. Fluxo de conexão

1. O Web pede à API a lista de fontes disponíveis e recebe um descritor do provedor ativo.
2. A API pede ao módulo um token de conexão.
3. O Web abre o widget do provedor com esse token.
4. O provedor devolve o resultado da conexão.
5. O módulo grava a conexão e apresenta as contas encontradas.
6. O usuário associa cada conta externa a uma conta local, nova ou existente.
7. As contas associadas passam a ter `sincronizada` verdadeiro, o que muda o comportamento do WhatsApp — ver [12-WHATSAPP.md](12-WHATSAPP.md).

O passo 1 é o que impede o provedor de vazar para o frontend.

Quem orquestra os passos 2 a 7 é o `ServicoConexaoOpenFinance`, separado do serviço de ingestão de propósito: esta parte é iniciada por uma pessoa numa tela, aquela é iniciada pelo provedor, sem ninguém olhando. Ritmos e modos de falha diferentes.

As rotas correspondentes vivem sob `/open-finance`:

| Rota | Passo | O que faz |
| --- | --- | --- |
| `GET /fonte` | 1 | Descritor do provedor ativo, ou `disponivel: false` |
| `POST /conexoes/token` | 2 | Token de curta duração para o widget |
| `POST /conexoes` | 5 | Grava a conexão e devolve as contas encontradas |
| `GET /conexoes` | — | Conexões do workspace, com status e último sync |
| `GET /conexoes/:id` | 6 | Conexão e suas contas externas, associadas ou não |
| `PUT /conexoes/:id/contas/:contaExternaId` | 6 e 7 | Associa a uma conta ou cartão local |
| `DELETE /conexoes/:id/contas/:contaExternaId` | — | Desfaz a associação |

Duas propriedades valem nota. `POST /conexoes` é idempotente por `(provedor, idExterno)`: reabrir o widget na mesma instituição atualiza a conexão que já existe em vez de criar outra, e as associações já feitas sobrevivem à relistagem das contas. O registro **materializa Conta/Cartão no Core** para cada recurso externo ainda sem destino (idempotente por `id_externo` da Fonte). Conta e Cartão continuam entidades do LancAI; a Fonte só dispara a criação. Reassociação manual permanece disponível em Bancos.

Cada rota que toca uma conexão confirma que ela pertence ao workspace de quem pediu, e responde 404 quando não pertence — o mesmo que responderia para conexão inexistente, para não confirmar identificadores a quem os sonda.

O passo 7 tem uma consequência que já está em vigor no Core: conta com `sincronizada` verdadeiro recusa lançamento manual, correção e cancelamento — ver seção 10 de [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md). Por isso quem liga a marca é o Core, via `MotorFinanceiro.definir_sincronizacao`, e não este módulo: a marca muda o que o Core permite, e deixar a Fonte escrever direto na coluna espalharia por dois módulos a autoridade sobre a mesma invariante.

Desassociar desliga a marca e devolve a conta ao uso manual, mas **não** reabre para edição o que já veio da instituição: Fato com fonte `open_finance` é imutável por si só. É isso que impede desconectar o banco de virar caminho para editar extrato. Ainda assim, a tela precisa avisar antes de confirmar a associação — o efeito é imediato e vale para todos os canais.

**A tela.** Vive em `/conexoes` no `apps/web`. Lista conexões com status e último sync, abre o widget, registra o resultado e associa cada conta externa a uma conta ou cartão local — avisando, antes de confirmar, que a associação fecha a conta para lançamento manual.

O widget do provedor **não** mora no `apps/web`. Mora em `modulos/open-finance/src/web/`, exportado como `@lancai/open-finance/web`, separado da entrada de servidor de propósito: aquela puxa Drizzle e serviços; esta só o que o navegador precisa. A tela chama `abrir_widget_conexao(fonte.id, …)` com o rótulo opaco que `GET /fonte` devolveu — do mesmo jeito que o servidor resolve o adaptador por `criar_provedor_open_finance`. Trocar de provedor mexe nesse diretório e em mais nenhum.

O dublê não tem widget, e isso é o que se quer: ele prova ingestão sem instituição real. Em desenvolvimento, `incluirSandbox` liga as instituições de mentira do ambiente de teste do provedor; sem isso não há o que conectar no sandbox.

---

## 4. Fluxo de sincronização

A sincronização é **iniciada pelo provedor**, não por nós. A pesquisa da seção 8.2 mostrou que a Pluggy é dona do sync e proíbe processo em lote do cliente; o desenho abaixo reflete isso. Ver [ADR-015](adr/015-ingestao-por-webhook.md).

1. O provedor sincroniza com a instituição no seu próprio ritmo e avisa por webhook.
2. A API interpreta o corpo, grava o evento bruto e responde imediatamente, antes de processar.
3. O módulo busca as movimentações do lote, paginando até o fim, e completa cada uma com workspace e conta local.
4. O Core deduplica por `id_externo` e grava o Fato, com `fonte` igual a `open_finance` e `fatoImutavel` verdadeiro.
5. No composition root, `conhecimento.classificar` aplica regras; o que nenhuma regra cobrir vai para a IA (`ClassificadorCategoria`), com `confianca_ia` registrada. Fail-open se a LLM falhar. Em seguida, se houver despesa e orçamento em 80%/100%, o composition root pode avisar no WhatsApp (`avisar_orcamentos_apos_movimentos`) — falha de alerta não desfaz o Fato.

Os passos 1 a 4 estão implementados em `ServicoIngestaoOpenFinance`, com a etapa síncrona separada da assíncrona: `receber` interpreta e grava, `processar` busca e ingere. A separação não é estética — é o que faz a idempotência funcionar, porque o registro do `eventoId` precisa acontecer antes de qualquer trabalho.

Um cron continua existindo, com papel menor: reprocessar lote que falhou. É rede de segurança, não o mecanismo. Falha no processamento fica gravada na coluna `erro` do evento; `POST /cron/open-finance-reprocessar` (Bearer `CRON_SECRET`) relê o payload, chama `processar` de novo e enriquece no composition root. Ver [15-OPERACAO.md](15-OPERACAO.md).

### Onde a movimentação pousa

Toda movimentação ingerida entra na categoria **“Não classificado”**, criada por workspace na primeira ingestão. Ela é diferente de “Outros”: “Outros” é escolha do usuário, “Não classificado” é a ausência de escolha. Juntar as duas tornaria impossível listar o que ainda falta classificar, que é exatamente a fila de trabalho do Conhecimento na F3.

Movimentação de conta externa que ninguém associou a uma conta local é **descartada**, e a contagem aparece no resumo da ingestão. Associar conta é ato do usuário; o webhook não cria conta sozinho.

**O sync nunca roda dentro do turno de conversa.** Um usuário mandando mensagem não pode ficar esperando uma chamada a banco — e, com a ingestão dirigida por webhook, não existe nem caminho de código para isso acontecer.

### Saldo de conta sincronizada

Em conta conectada, o saldo exibido é o que a **instituição informa** (`balance` da conta no provedor), tratado como Fato. A soma das movimentações fica como detalhe auditável, não como verdade.

Isso resolve a divergência que a seção 10 listava como risco, e tem uma consequência de implementação: para conta sincronizada, o Core **atribui** o saldo que veio do provedor em vez de acumulá-lo a partir dos eventos, como faz no lançamento manual. Enquanto o adaptador não existir, `ingerir_eventos` ainda acumula.

---

## 5. Dados internos do módulo

Três tabelas, criadas na migração `0009_open_finance`. A fronteira do [ADR-011](adr/011-open-finance-isolado.md) é de dependência de código, não de arquivo: elas vivem no schema único do Drizzle como todas as outras, e o que as mantém internas é nenhum outro módulo as ler.

- **`open_finance_conexao`:** provedor, identificador externo, status, motivo de atenção, último sync, expiração do consentimento e configurações. Guarda também `criado_por`, porque a ingestão precisa de um autor para o Fato e para a auditoria — webhook não tem usuário logado.
- **`open_finance_conta_externa`:** identificador da conta no provedor para conta ou cartão local. Sem uma linha aqui a movimentação não tem onde pousar.
- **`open_finance_evento`:** o webhook como chegou, com unicidade em `(provedor, evento_id)`. É essa unicidade que torna a retentativa inofensiva — a Pluggy manda até nove vezes o mesmo evento. A decisão é gravar e deixar o banco resolver a corrida, em vez de consultar antes de inserir: duas entregas simultâneas passariam pela consulta e seriam processadas em dobro.

O `perfil` do Fato (`pf` ou `pj`) não é coluna daqui: sai do tipo do workspace, pessoal ou empresa.

**Configurações por conexão** ficam em `configuracoes`, um jsonb — por exemplo importar transações pendentes e qual campo do provedor usar como favorecido. São conceitos de provedor, e é justamente por isso que não são colunas do Core.

**Retenção do payload (LGPD):** após `OPEN_FINANCE_RETENCAO_DIAS` (padrão **30**), o corpo bruto de eventos **processados com sucesso** é substituído por um stub `{ _lancai: { payloadPurgadoEm, retencaoDias } }`. A linha permanece — a unicidade de `(provedor, evento_id)` continua bloqueando retentativa tardia. Eventos com `erro` não são tocados (o reprocesso ainda precisa do payload). Cron: `POST /cron/open-finance-retencao`.

---

## 6. Deduplicação e o passado

### Deduplicação corrente
A chave é `id_externo`. Se o Fato já existe, o sync **não** cria outro: no máximo atualiza `status_fonte`, por exemplo quando algo sai de pendente para confirmado.

Criação e atualização estão implementadas, por portas separadas do Core. `ingerir_eventos` só cria; `atualizar_fatos_da_fonte` só altera o que já existe, e é a única operação que abre o escape hatch do trigger (`SET LOCAL "lancai.sincronizacao"`), dentro da própria transação.

A separação é deliberada e vale registrar o porquê. A janela de recoleta de 4 a 7 dias faz o lote normal retrazer o que já entrou; se `ingerir_eventos` também atualizasse, todo sync reescreveria Fato, e a mudança de verdade — a pendente que virou confirmada — ficaria escondida no meio do barulho. Pela porta de alteração passa só o que a fonte declarou ter mudado, em `transactions/updated`.

Três garantias moldam essa porta:

- **O Conhecimento não é tocado.** Categoria, pessoa, tags, observações, perfil, `ignorado_em_relatorio` e a `descricao` que o usuário vê seguem intactos. O banco corrigiu o extrato dele, não a opinião dele sobre o extrato.
- **Fato idêntico não escreve nada.** Comparar campo a campo antes de gravar é o que impede a janela de recoleta de encher a auditoria de linha sem diferença.
- **Movimento cancelado não ressuscita.** Anúncio da fonte não desfaz cancelamento: saber se cabe reabrir exigiria saber por que foi cancelado, e a fonte não sabe.

O saldo é recalculado pela diferença entre o efeito anterior e o novo, o que cobre de uma vez mudança de valor, inversão de tipo e — o caso mais comum — pendente que entra no saldo ao ser confirmada.

O que a alteração **não** faz: acompanhar a `descricao` que o usuário vê. Se o banco reescreve `descricao_fonte` de "COMPRA CARTAO" para "IFOOD" e o usuário nunca renomeou, ele continua vendo o texto velho. Seguir automaticamente seria o Core decidindo Conhecimento, que é o que o Pilar 1 proíbe; a decisão cabe ao módulo `conhecimento`, na F3.

### Casamento com o passado
Na primeira sincronização de uma conta, é esperado que existam lançamentos manuais representando os mesmos gastos, criados por conversa antes de o banco estar conectado.

A regra: casar por valor, data próxima (±3 dias) e similaridade de descrição. Ao casar, o **Conhecimento do lançamento manual migra para o Fato do banco** — categoria, pessoa, perfil, tags e observações são preservados — e o lançamento manual é cancelado, nunca apagado.

**Implementado** no composition root (`conciliar_manuais_com_fatos_criados`), **antes** da classificação automática; o Core expõe `MotorFinanceiro.cancelar_para_conciliacao` (escapa a política de conta sincronizada porque é operação do sistema).

Sem isso, o usuário vê o gasto duas vezes no primeiro dia e perde confiança no produto.

### Transferência entre contas próprias
Quando as duas pontas de uma transferência aparecem no sync, elas devem ser reconhecidas como uma única transferência, não como uma despesa e uma receita independentes.

---

## 7. Observabilidade

Sem isso o usuário perde confiança no que o produto chama de “fato”. É requisito, não melhoria:

- Último sync bem-sucedido por conexão — gravado em `ultimo_sync_em` ao fim de cada lote; `/conexoes` mostra data absoluta + relativo (“há 2 h”)
- Atraso desde o último sync — na UI, destaque a partir de 36 h em conexão ativa (sandbox sem auto-sync também acusa, de propósito)
- Erro de consentimento visível na interface, com caminho para reconectar — status, motivo e botão Reconectar em `/conexoes`; aviso se o consentimento expira em ≤14 dias
- Contagem de Fatos do último lote — gravada em `open_finance_conexao.ultimo_resumo_ingestao` e exibida em `/conexoes` (“3 novos · 1 duplicata”); o log da API mantém o detalhe por evento

---

## 8. Adaptador Pluggy

Pesquisa feita em agosto de 2026 sobre a documentação oficial. Três achados contrariaram o que este documento assumia — estão marcados como **correção**.

### 8.1 Autenticação e endpoints

Base `https://api.pluggy.ai`. Duas credenciais, com papéis distintos:

| Token | Como obter | Validade | Para quê |
|---|---|---|---|
| API Key | `POST /auth` com `clientId` e `clientSecret` | 2 horas | Backend: ler dados, configurar webhook, criar e atualizar item |
| Connect Token | `POST /connect_token` usando a API Key | 30 minutos | Frontend: abrir o widget. **Não** lê dados |

A API Key vai no header `X-API-KEY`. A separação encaixa no fluxo da seção 3: o Web nunca vê a credencial que lê dados, só o token de 30 minutos.

Endpoints que o adaptador usa:

- `GET /items/{id}` — estado da conexão
- `GET /accounts?itemId=` — contas e cartões da conexão
- `GET /v2/transactions?accountId=` — transações, paginação por cursor, 500 por página
- `GET /consents?itemId=` — permissões e expiração
- `PATCH /items/{id}` — “Atualizar agora” (`POST /open-finance/conexoes/:id/atualizar`); sync pontual, sem coleta de extrato no request (ADR-015)

O `GET /transactions` de paginação por página está **deprecado e sai em 31/12/2026**. Nascer direto no `/v2` não é otimização, é evitar migração já agendada.

Dois detalhes de paginação que moldaram o adaptador. O campo de continuação chama-se `next` e vem como **query string relativa** (`?accountId=...&after=...`), não como cursor solto; o adaptador reconstrói o caminho, o que deixa `coletar_lote` indiferente a se a referência veio do webhook ou da página anterior. E `accountId` é **obrigatório** em `/v2/transactions`, inclusive quando se filtra por `ids` — por isso `coletar_por_ids`, que recebe o item e não a conta, varre as contas da conexão. Buscar por identificador solto não existe na API, e deduzir a conta a partir do identificador da transação seria chute.

### 8.2 Correção: o sync não é nosso, e cron para isso é proibido

Este documento dizia “o cron chama o endpoint de sync”. A Pluggy é explícita no contrário:

> *Batch process are prohibited due to abusive usage of the API, the sync process is owned and maintained by Pluggy.*

A Pluggy sincroniza sozinha a cada 24, 12 ou 8 horas conforme o plano — e **auto-sync existe só em aplicação de produção**, não em sandbox. Nós não puxamos: reagimos ao webhook.

O que sobra para o nosso cron é reprocessar lote que falhou (`POST /cron/open-finance-reprocessar`). Isso é rede de segurança, não o mecanismo. Ver [ADR-015](adr/015-ingestao-por-webhook.md).

A consequência boa: a regra “sync nunca dentro do turno de conversa” fica trivial de respeitar, porque a ingestão não é mais iniciada por nós em momento nenhum.

### 8.3 Eventos que interessam

De todos os eventos, cinco importam para a ingestão:

| Evento | O que trazer | O que fazer |
|---|---|---|
| `transactions/created` | `createdTransactionsLinkV2` ou `createdTransactionsLink` | Paginar o link e ingerir. É a porta principal |
| `transactions/updated` | `transactionIds` | Buscar por `ids` e atualizar o Fato (usa o escape hatch do trigger) |
| `transactions/deleted` | `transactionIds` | **Decisão aberta** — ver 8.6 |
| `item/error` | `error.code` | `USER_AUTHORIZATION_REVOKED` e `LOGIN_ERROR` viram pedido de reconexão na interface |
| `item/deleted` | `itemId` | A Pluggy apaga item de sandbox parado por 30 dias e conector depreciado após 30 dias |

Regras de entrega que moldam o handler:

- Responder **2XX em menos de 5 segundos** e processar depois. Processar antes de responder gera retentativa da própria Pluggy.
- Até 9 tentativas: 3 imediatas, 3 após 15 minutos, 3 após 2 horas. O handler precisa ser idempotente por `eventId`.
- Webhook aceita header próprio de autenticação, configurável só por API. IP de origem `52.67.145.81`.
- Só dispara quando há mudança: silêncio não significa falha.

O webhook da Evolution já estabeleceu o padrão de gravar o evento bruto antes de processar (`evolution_evento`). O de Pluggy segue o mesmo, e a idempotência por `eventId` sai de graça disso.

**Armadilha do link de transações.** Em aplicação criada antes de 2 de junho de 2026, `createdTransactionsLink` aponta para o `/transactions` depreciado e o link de V2 vem em `createdTransactionsLinkV2`. Em aplicação criada depois, `createdTransactionsLink` já é V2 e o campo extra não vem. O adaptador prefere `createdTransactionsLinkV2` quando existe, o que cobre os dois casos sem configuração — seguir o primeiro campo cegamente levaria a ingestão para o endpoint que sai em 31/12/2026.

Além dos cinco, `item/waiting_user_input` e `item/waiting_user_action` também viram pedido de atenção: o segundo é o caso de autorização no aplicativo do banco ou leitura de QR code.

### 8.4 Mapeamento para `EventoFinanceiroNormalizado`

| Campo nosso | Campo Pluggy | Observação |
|---|---|---|
| `idExterno` | `id` | Estável — é por `id` que os webhooks de update e delete se referem à transação |
| `descricaoFonte` | `descriptionRaw ?? description` | A Pluggy já separa original de limpo, exatamente como Fato e Conhecimento |
| `descricao` inicial | `description` | Versão limpa da Pluggy é um bom ponto de partida para o Conhecimento |
| `valor` | `Math.abs(amount)` | `amount` vem com sinal; nosso schema exige positivo e a direção está em `tipo` |
| `tipo` | `type` | `DEBIT` → despesa, `CREDIT` → receita. A Pluggy já normaliza a inversão do cartão: compra é sempre `DEBIT` |
| `statusFonte` | `status` | `POSTED` → confirmado, `PENDING` → pendente |
| `ocorridoEm` | `date` | Vem em ISO com hora; nós guardamos só a data |
| `favorecidoFonte` | `merchant.name` ou `paymentData.receiver.name` | Qual usar é configuração por conexão, e é conceito de provedor — fica no módulo |
| `provedor` | fixo `"pluggy"` | Rótulo opaco, ninguém fora do módulo interpreta |

Campos que **não** viram Fato e viram matéria-prima de Conhecimento na F3: `category` e `categoryId` (sugestão, nunca fonte — [ADR-011](adr/011-open-finance-isolado.md)), `merchant.cnpj` e `cnae`, `paymentData.paymentMethod` (PIX, TED, DOC, TEV, BOLETO, que conversa com nosso `forma_pagamento`) e `operationType`.

A janela de recoleta confirma que a deduplicação da F1 não era zelo excessivo: cada sync retraz de 4 a 5 dias em conector direto e 7 dias em conector regulado, e a criação do item importa **até 365 dias** de histórico. Reingestão sobreposta é o caso normal, não a exceção.

### 8.5 Consentimento: risco menor do que assumíamos

A Pluggy pede consentimento **sem expiração** por padrão; `consentExpiresAt` nulo significa que não expira. Alguns conectores fogem disso — Inter PJ expira em um ano. O usuário pode revogar pelo app do banco a qualquer momento, e aí os endpoints de dados passam a devolver vazio.

Renovar não cria item novo: é `PATCH` no item existente, ou o widget em modo de atualização com `updateItem`, e `forceAskForCredentials: true` quando se quer forçar a digitação da credencial. O item volta a `SUCCESS` com novo `consentExpiresAt`.

Para a observabilidade da seção 7, os campos são `status`, `executionStatus`, `statusDetail`, `lastUpdatedAt`, `nextAutoSyncAt` e `consentExpiresAt`.

### 8.6 Transação apagada na fonte: desaparecimento registrado

`transactions/deleted` existe: a Pluggy remove transações depois do merge de dados. Nosso trigger **proíbe** `DELETE` em movimentação de `open_finance`, e proibir isso foi decisão consciente ([ADR-009](adr/009-fato-vs-conhecimento.md)).

**Decidido:** desaparecimento registrado. `status_fonte` passa a `removido` e `status` passa a `cancelado`. O saldo volta, a linha permanece no histórico, e nada do Conhecimento é perdido.

A divisão entre as duas colunas é o ponto. `status_fonte = 'removido'` é o que a instituição afirma, e por isso é Fato — a mesma coluna protegida pelo mesmo trigger. `status = 'cancelado'` é a nossa consequência disso. Nenhuma marca de Conhecimento é inventada para carregar essa informação, o que evita que o Core escreva na metade mutável do registro.

As alternativas foram descartadas por motivo explícito. Apagar de verdade contradiz o ADR-009 e destrói a auditoria de algo que de fato existiu. Ignorar deixaria no relatório um gasto que o banco diz não existir — o pior dos dois mundos, porque o número fica errado sem ninguém saber por quê.

A operação é idempotente, e isso importa mais aqui do que na criação: o provedor retenta até nove vezes, e devolver o saldo duas vezes seria um erro difícil de perceber e pior de corrigir. Quem já está `removido` é contado e ignorado, e movimento que alguém já havia cancelado tem `status_fonte` atualizado sem novo ajuste de saldo, porque o saldo dele já tinha voltado.

Remoção de transação que nunca ingerimos — conta não associada na época — não é erro: o estado desejado já é o estado.

### 8.7 Parcela do cartão chega como transação independente

O cartão informa cada parcela como sua própria transação, com `creditCardMetadata.installmentNumber`, `totalInstallments`, `totalAmount` e `purchaseDate`. Nosso modelo veio do lado manual: um `movimento` pai e N linhas em `parcela`.

**Decidido e implementado:** cada parcela é um Fato próprio, e a tabela `parcela` não é alimentada pela ingestão. Tentar reconstruir o pai a partir das parcelas é adivinhação, e adivinhação não produz Fato.

Os quatro metadados viram quatro colunas de Fato em `movimento` — `parcela_numero`, `parcela_total`, `parcela_compra_em` e `parcela_compra_valor` —, nulas em tudo que não é parcela. Duas escolhas dentro disso merecem registro:

- **O valor da compra é guardado, não calculado.** Parcela desigual existe: 3x de R$ 33,34 + R$ 33,33 + R$ 33,33 não multiplica.
- **Número e total são obrigatórios; valor e data da compra, não.** Sem número e total não dá para dizer "3 de 10", e o resto sozinho não informa nada. Mas nem todo conector preenche valor e data, e perder o parcelamento inteiro por falta deles seria pior do que registrar só "3 de 10".

Agrupar as parcelas de uma mesma compra continua sendo trabalho do **Conhecimento**, na F3 — estas colunas são a matéria-prima dele. Capturar agora e agrupar depois foi deliberado: recuperar os metadados mais tarde exigiria recoletar até 365 dias de histórico.

As quatro entraram na lista de colunas que o trigger protege, e o verificador de trigger tem caso para duas delas. Coluna de Fato esquecida nessa lista fica silenciosamente editável, e esse é o tipo de descuido que não deve depender de alguém lembrar.

### 8.8 Ambiente de desenvolvimento e custo

Sandbox gratuito, sem cartão e sem aprovação comercial, pelo conector “Pluggy Bank”. Credenciais de teste `user-ok` / `password-ok`, MFA `123456`, e usuários dedicados para cada falha (`user-locked`, `user-logged`, entre outros) — dá para testar consentimento rejeitado e login travado sem simulacro nosso. Item de sandbox parado 30 dias é apagado, e o dado do sandbox é ilustrativo: não serve de fixture de teste automatizado.

O preço não é público e varia por contrato — cobrança por conexão, por chamada ou por usuário ativo, conforme o plano, e conector direto é faturado à parte do regulado. Estimativas de terceiros falam em algo na casa de R$ 2.500 por mês no plano de entrada, o que **não** foi confirmado com a Pluggy e não deve ser tratado como número firme.

O que isso implica no roadmap: a F2 inteira cabe no sandbox, exceto o auto-sync, que só existe em produção. Até assinar, o gatilho é **Atualizar agora** na UI (ou o equivalente no dublê: **Sincronizar lote de mentira**).

### 8.9 O que ficou de fora

Pagamentos (Pix, Pix Automático, ITP), investimentos, identidade e oportunidades. A Pluggy oferece, o LançAI não usa, e nenhum deles deve entrar por tabela ou coluna “já que estamos aqui”.

### 8.10 O adaptador implementado

Três arquivos em `modulos/open-finance/src/pluggy/`, divididos pelo que muda por motivo diferente:

| Arquivo | Responsabilidade |
| --- | --- |
| `cliente.ts` | Autenticação e transporte: troca de credencial por API Key, cache, header e erro de HTTP |
| `traducao.ts` | Funções puras que traduzem conta, transação, status e código de erro |
| `adaptador.ts` | Implementa a porta, monta URL e lê webhook |

A separação não é cerimônia: `traducao.ts` é a parte que mais erra em silêncio e a que menos precisa de infraestrutura para verificar. Deixá-la pura significa que um teste de mapeamento não carrega mock de login junto.

**Autenticação.** A API Key vale 2 horas e é renovada aos 100 minutos, para que uma chave não expire no meio da paginação de 365 dias de histórico. Resposta 401 ou 403 invalida a chave e repete a requisição **uma vez**; repetir em laço transformaria credencial errada em tempestade contra o provedor. Chamadas concorrentes compartilham um único login em curso.

**Tradução de erro.** É o ponto onde errar custa mais caro, porque confundir credencial inválida com instabilidade manda a pessoa esperar quando ela precisa reconectar. Os casos de Open Finance da Pluggy são fechados e mapeiam assim:

| Código do provedor | Motivo nosso |
| --- | --- |
| `INVALID_CREDENTIALS`, `INVALID_CREDENTIALS_MFA`, `ACCOUNT_LOCKED` | `credencial_invalida` |
| `USER_AUTHORIZATION_REVOKED`, `USER_AUTHORIZATION_NOT_GRANTED` | `consentimento_revogado` |
| `USER_AUTHORIZATION_PENDING`, `USER_INPUT_TIMEOUT`, `ACCOUNT_NEEDS_ACTION` | `aguardando_usuario` |
| `SITE_NOT_AVAILABLE`, `CONNECTION_ERROR`, `ERROR`, e o resto | `erro_no_provedor` |

Duas escolhas de valor padrão merecem registro, porque as duas erram de propósito para o mesmo lado. Status de item desconhecido vira `precisa_atencao`, não `ativa`: um aviso a mais custa pouco, e fazer o usuário confiar num extrato que parou de atualizar custa muito. Status de transação desconhecido, ao contrário, vira `confirmado`: `POSTED` é a esmagadora maioria, e tratar o desconhecido como pendente esconderia o gasto do saldo.

**Token de conexão.** Criado com `clientUserId` igual ao `workspaceId` — e não ao usuário, porque é o workspace que delimita os dados (ADR-013) e na F6 mais de uma pessoa vê a mesma conexão. Vai junto `avoidDuplicates: true`, que faz o provedor recusar conectar duas vezes a mesma credencial, e o `webhookUrl`, que amarra os eventos ao item recém-criado sem depender de configuração no painel do provedor.

**Como o adaptador é escolhido.** Por `OPEN_FINANCE_PROVEDOR`, traduzido em adaptador por `criar_provedor_open_finance`, que vive **dentro** do módulo. Deixar a montagem em `apps/api` obrigaria a aplicação a nomear o provedor e a conhecer suas variáveis de ambiente — e foi exatamente isso que o teste de isolamento pegou na primeira tentativa. Os adaptadores concretos não são exportados pelo `index`: quem quiser um pede pelo nome.

**O que estes testes não provam.** Que o adaptador funciona contra a Pluggy. Os corpos usados nos testes vêm da documentação oficial, o que é bem melhor do que formato inventado, mas continua sendo o formato que a Pluggy **documenta** — não o que ela devolve. Falta rodar contra o sandbox (checklist em [15-OPERACAO.md](15-OPERACAO.md)), e é o passo que fecha a F2.

---

## 9. Conceitos aproveitados de projeto de referência

O projeto Securo foi analisado como referência conceitual. O que vale reusar como ideia:

- Registro de provedores ativado por credencial em variável de ambiente
- Sync periódico combinado com sync manual sob demanda
- Deduplicação por identificador externo e casamento aproximado com lançamentos manuais
- Configurações por conexão
- Motor de regras de categorização com reaplicação em lote
- Experiência de uso do dashboard, contas, extrato e conexão bancária
- Detecção de transferência entre contas do próprio usuário

### O limite da licença

**Zero código copiado.** O projeto de referência é AGPL-3.0, o que é incompatível com um SaaS fechado. Também não se aproveita a stack (Python, FastAPI, Celery, SQLAlchemy), nem Redis e Celery como requisito de infraestrutura, nem self-host como premissa de produto.

E, conceitualmente, há uma divergência de fundo: naquele modelo toda transação é igualmente editável. Aqui, Fato vindo de instituição é imutável. Ver [ADR-009](adr/009-fato-vs-conhecimento.md).

---

## 10. Riscos

Atualizados após a pesquisa da seção 8. Dois riscos diminuíram, um foi resolvido e dois nasceram.

- **Consentimento.** *Menor do que se pensava.* A Pluggy pede consentimento sem expiração por padrão; o risco real é revogação pelo usuário no app do banco e conector que expira em um ano, como Inter PJ. Mitigação: monitorar `consentExpiresAt` e `item/error`, com caminho claro de reconexão.
- **Custo.** Preço não é público e varia por contrato; conector direto fatura à parte do regulado. Mitigação: sandbox gratuito cobre a F2 inteira menos o auto-sync, então a assinatura pode esperar o produto estar pronto.
- **Sync pesado.** *Menor do que se pensava.* Não somos nós que puxamos, e processo em lote é proibido pelo provedor. Mitigação: handler que responde em menos de 5 segundos e processa depois, idempotente por `eventId`.
- **Divergência de saldo.** *Resolvido.* O saldo da instituição é o exibido e é Fato; a soma das movimentações é detalhe auditável. Ver seção 4.
- **Transação apagada na fonte.** *Novo, contido.* `transactions/deleted` colide com a imutabilidade do Fato. Decisão pendente na seção 8.6; até lá o evento é gravado sem alterar nada, então nenhum dado se perde enquanto se decide.
- **Parcela como transação independente.** *Novo.* O cartão entrega parcela por parcela, e nosso modelo de parcelamento nasceu do lado manual. Direção recomendada na seção 8.7.
- **Dependência de provedor único.** Mitigada pela porta, mas só comprovada com o segundo provedor. A pesquisa reforça o risco: o widget e o formato de webhook são proprietários, então trocar de provedor é reescrever o adaptador, não trocar credencial.
