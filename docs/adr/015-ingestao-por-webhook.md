# ADR-015 — A ingestão de Open Finance é reativa a webhook, não puxada por cron

**Status:** aceito

## Contexto

O roadmap e o [13-OPEN_FINANCE.md](../13-OPEN_FINANCE.md) descreviam a sincronização como “o cron chama o endpoint de sync”, e o risco de “sync dentro do request do chat” tinha como mitigação declarada “sync somente por cron”. A escolha era razoável: cron é a infraestrutura mais simples que resolve, e evitar sync no turno de conversa é requisito de experiência.

A pesquisa da API da Pluggy, feita em agosto de 2026 antes de escrever o adaptador, mostrou que a premissa estava errada. A documentação é explícita:

> *Batch process are prohibited due to abusive usage of the API, the sync process is owned and maintained by Pluggy.*

O provedor sincroniza com a instituição por conta própria, a cada 24, 12 ou 8 horas conforme o plano, e anuncia o resultado por webhook. Não existe endpoint para “sincronize agora todas as minhas conexões”: existe `PATCH /items/{id}` para atualização pontual de uma conexão, pensado para o usuário pedir atualização em tempo real, não para varredura periódica.

Ou seja: o desenho original não era apenas subótimo, era proibido pelo contrato de uso.

## Decisão

A ingestão de movimentações de Open Finance é **reativa**. O provedor anuncia, nós consumimos.

1. O webhook do provedor é a porta principal de entrada de Fato.
2. O handler grava o evento bruto, responde 2XX e só então processa — o provedor considera falha qualquer resposta acima de 5 segundos.
3. O handler é idempotente por identificador de evento, porque o provedor retenta até nove vezes.
4. O cron permanece, com papel reduzido: reprocessar lote que falhou e reconciliar o que o webhook não entregou. É rede de segurança, não mecanismo.
5. Atualização pontual de uma conexão existe como ação do usuário (“atualizar agora”), nunca como varredura. Implementação: `ProvedorOpenFinance.solicitar_atualizacao` → Pluggy `PATCH /items/{id}` → API `POST /open-finance/conexoes/:id/atualizar` → botão em `/conexoes`. O Fato só entra no webhook.

O vocabulário de eventos do provedor não sai do módulo: a porta traduz para uma `NotificacaoFonte` nossa antes de qualquer coisa.

## Alternativas consideradas

**Manter o cron puxando, aceitando o risco.** Recusada. Não é uma questão de preferência arquitetural: é uso abusivo declarado pelo provedor, com risco de bloqueio comercial. Nenhuma elegância de desenho compensa isso.

**Webhook como otimização e cron como caminho principal, para não depender de entrega externa.** Recusada. Dois caminhos de ingestão significam duas chances de duplicar Fato e duas implementações da mesma tradução. A deduplicação por `id_externo` protegeria o dado, mas o custo de manutenção não se justifica quando um dos caminhos é proibido.

**Consumir o webhook direto no Core, sem passar pelo módulo.** Recusada. O formato do webhook é proprietário do provedor; deixá-lo tocar o Core violaria o [ADR-011](011-open-finance-isolado.md) na primeira linha de código.

## Consequências

- A regra “sync nunca dentro do turno de conversa” deixa de depender de disciplina: não existe caminho de código que inicie sincronização a partir de uma mensagem.
- A API precisa de um endpoint público HTTPS para receber webhook, com autenticação por header e, se quisermos, filtro por IP de origem. Em desenvolvimento isso exige túnel — `localhost` não é aceito pelo provedor.
- O padrão de gravar o evento bruto antes de processar já existe no projeto, no webhook da Evolution. A idempotência sai de graça dele.
- **Auto-sync é recurso de aplicação em produção.** No sandbox não há sincronização automática, então o desenvolvimento da F2 dispara atualização manual por conexão. O adaptador precisa suportar os dois modos desde o começo, e isso não é código descartável: “atualizar agora” é funcionalidade de produto.
- A observabilidade da seção 7 do documento de Open Finance passa a depender de campos de estado da conexão no provedor, não de um registro nosso de “última execução do cron”.
- Se um dia existir provedor que **exija** ser puxado, ele entra como outra implementação da mesma porta, e o cron volta a ter papel maior para aquele provedor específico. A porta absorve a diferença; o Core não fica sabendo.

Ver [13-OPEN_FINANCE.md](../13-OPEN_FINANCE.md), seções 4 e 8.
