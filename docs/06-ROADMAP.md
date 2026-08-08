# 06 — Roadmap

Tudo que é “quando” e “depois”: fases, migração, riscos, backlog técnico e o que fica para o futuro.

**Este documento não cobre:** o que o produto é — ver [05-PRD.md](05-PRD.md). Como a arquitetura funciona — ver [02-ARQUITETURA.md](02-ARQUITETURA.md).

---

## 1. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **F0** | Documentação modular e glossário em `docs/` | Time alinhado |
| **F1** | Schema de Fato e Conhecimento, `TipoFonte`, `workspace_id`, trigger de imutabilidade, APIs separadas | Chat e WhatsApp atuais intactos |
| **F2** | Módulo de Open Finance com Pluggy, ingestão por webhook, Web mínimo com conexão e extrato, bloqueio de criação em conta sincronizada | Extrato do banco aparece e não duplica |
| **F3** | Módulo `conhecimento`: regras manuais, IA quando não há regra, “virar regra?”, memória absorvida | iFood classifica sem chamar modelo |
| **F4** | Web cockpit completo com painel de IA lateral | **Feito** — MVP desligado |
| **F5** | WhatsApp assistente completo: consultas, enriquecimento, alertas | **Feito** no escopo acordado — enriquecimento, resumo baixa confiança e alerta de orçamento pós-OF; catálogo amplo de alertas fica para depois |
| **F6** | Workspace multi-membro | Sócio ou família no mesmo workspace |

### Duas escolhas de ordem que merecem registro

**Open Finance está na F2, antes das regras.** É a maior aposta do produto e o maior desconhecido — consentimento, custo, comportamento da API do provedor — e precisa ser destravado cedo. Motor de regras sem volume de transações sincronizadas entrega pouco valor.

**O Web começa como skeleton na F2**, não nasce inteiro na F4. O widget de conexão bancária precisa de tela; não havia como entregar Open Finance sem alguma interface.

Uma nuance da F2: a **política** que impede o WhatsApp de criar movimentação em conta sincronizada precisa entrar junto com o sync, não depois. Caso contrário, o primeiro dia de Open Finance gera duplicata. O assistente **rico** é F5; a política é F2.

---

## 2. Migração

Estrangulamento incremental, sem reescrita de uma vez:

1. **Schema primeiro.** Adicionar `fonte`, `id_externo`, `workspace_id`, as colunas de Conhecimento e o trigger de imutabilidade. Movimentos existentes viram fonte `whatsapp` ou `manual`, com Fato mutável.
2. **Separar as APIs** de Fato e Conhecimento mantendo `POST /chat` e o webhook da Evolution funcionando.
3. **Política por conta.** Se a conta é sincronizada, criação, correção e exclusão de Fato são bloqueadas — no Core, não no turno de conversa, para valer em qualquer canal. **Feito**, antes do adaptador do provedor: a política não depende de qual provedor será usado, e entrar primeiro garante que o sync nasça dentro dela.
4. **Provedor atrás do módulo.** Pluggy dentro de `modulos/open-finance`, sem o Core saber que existe. **Quase fechado:** a porta, os serviços de ingestão e conexão, as três tabelas do módulo, o webhook, as rotas de `/open-finance`, o dublê, o adaptador, os quatro casos que a instituição impõe (criação, alteração, remoção, parcelamento) e o skeleton do Web (`/conexoes` + `/extrato`) estão prontos. O widget mora em `@lancai/open-finance/web`, não no `apps/web`, para o nome do provedor não vazar. Falta só rodar contra o sandbox — que precisa de credenciais e de um túnel HTTPS para o webhook.
5. **Motor de regras do Conhecimento.** Tabela `regra` tipada + `classificar` (regra → IA com `confianca_ia`), precedência de `classificado_por = usuario`, disparo após ingestão, oferta “virar regra?” (`aprendizado_conversa`), e absorção de `modulos/memoria` em `conhecimento`. **Feito** na F3.
6. **Web novo em paralelo.** **Feito (F4):** shell autenticado, dashboard (`GET /dashboard`), Contas/Cartões/Categorias/Regras/Configurações, extrato com classificação + fila de revisão (`PATCH /conhecimento`), conexões e painel de IA; legado de chat fullscreen removido. O sandbox Pluggy (credenciais + túnel) ainda fecha a F2 — ver checklist em [15-OPERACAO.md](15-OPERACAO.md).
7. **Duplicatas do passado.** **Feito:** na ingestão, casar manuais/WhatsApp com Fatos novos por valor, data ±3 dias e similaridade de descrição; migrar Conhecimento e cancelar o manual via `cancelar_para_conciliacao`.

Compatibilidade: usuário sem Open Finance continua registrando pelo WhatsApp exatamente como hoje. Nenhum passo exige interrupção de serviço.

Detalhe da migração de dados em [07-MODELO_DE_DADOS.md](07-MODELO_DE_DADOS.md).

---

## 3. Riscos

| Risco | Mitigação |
|---|---|
| Fato e Conhecimento se misturarem no código | APIs separadas, trigger no banco e teste de invariante |
| Usuário quer “apagar” um gasto vindo do banco | `ignorado_em_relatorio`; o Fato permanece |
| Duplicata entre o WhatsApp antigo e o sync novo | Casamento na primeira sincronização, com migração do Conhecimento |
| Consentimento e custo do provedor | Ambiente de desenvolvimento do provedor, reconexão clara, sync idempotente |
| Escopo do Web explodir | A lista de telas da F4 é fechada; o resto é evolução futura |
| Sync dentro do request do chat | Ingestão reativa a webhook do provedor: não existe caminho de código que inicie sync a partir de uma mensagem ([ADR-015](adr/015-ingestao-por-webhook.md)) |
| Regra sobrescrever escolha do usuário | `classificado_por = 'usuario'` tem precedência |
| Sync sem observabilidade | **Feito na UI:** `/conexoes` mostra status, motivo, último sync com atraso, aviso se >36 h, consentimento, reconectar e contagem do último lote (`ultimo_resumo_ingestao`) |
| Webhook processado duas vezes | Unicidade de `(provedor, evento_id)` no banco, gravada antes de qualquer processamento — o provedor retenta até nove vezes |
| Alteração na fonte sobrescrever o Conhecimento | `atualizar_fatos_da_fonte` toca só campo de Fato; categoria, pessoa, tags e descrição do usuário ficam intactas, e o teste do Core trava isso |
| Remoção na fonte apagar histórico | Nada é apagado: `status_fonte` vira `removido`, `status` vira `cancelado` e o saldo volta. A operação é idempotente, porque o provedor retenta até nove vezes |
| Licença AGPL do projeto de referência | Zero código copiado; apenas conceitos |
| Time pequeno com muitos módulos | Seis módulos e nenhuma infraestrutura nova |
| Workspace complicar cedo demais | Um workspace implícito até a F6 |

---

## 4. Backlog técnico

Gaps conhecidos do pipeline de linguagem natural, levantados a partir do código. Não são bugs: são pontos onde o custo ou a precisão podem melhorar.

1. ~~**Slot de lançamento sem merge determinístico dos dados parciais.**~~ **Feito:** `normalizar_intencao_movimento` mescla `dados_parciais` pendentes; atalho aceita resposta curta (“50”, “na C6”).
2. ~~O atalho de lançamento recusa frases com “reais” ou “dia N”~~ **Feito:** atalho aceita `reais` e `dia N` (mês de `dataAtual`).
3. ~~Consulta por estabelecimento sem período sempre vai para a LLM.~~ **Feito:** atalho usa mês atual + `filtros.descricao` (Uber, iFood, etc.); categoria sem período continua na IA.
4. ~~Correção de valor ou descrição não tem atalho determinístico.~~ **Feito:** “corrige o almoço para 20”, “muda a descrição do uber para …” / “muda o almoço para jantar”.
5. ~~`NAO_RECONHECIDA` está sobrecarregada~~ **Feito:** cancelamentos/orientação usam `MENSAGEM_INFO`; `NAO_RECONHECIDA` fica só para fora do domínio.
6. ~~As visões `fluxo`, `futuro`, `evolucao` e `parcelamentos` têm pouca cobertura de atalho.~~ **Feito:** atalho em `interpretar_consulta_rapida` (período padrão no ModuloRelatorios).
7. ~~O classificador às vezes escolhe `outro` em frases de gasto vagas.~~ **Feito:** `ramo_heuristico_mensagem` força `registrar` (“fiz mercado”, “gastei no uber”); prompt do classificador reforçado.
8. ~~O limite de itens no histórico precisa de UX melhor do que pedir um intervalo menor.~~ **Feito:** paginação com `deslocamento` + atalho “mais”/“continuar”; rodapé sugere “mais” (período menor fica opcional).
9. Documentação antiga afirmava que o WhatsApp era futuro, quando o código já o tinha — corrigido nesta reorganização.

Contexto de cada item em [10-IA.md](10-IA.md).

---

## 5. Oportunidades

- **Conciliação conversacional.** **Feito** na ingestão: casa manual↔banco e migra Conhecimento.
- **Explicabilidade.** **Feito no extrato:** regra (trecho), IA (confiança) ou você (`classificado_em`).
- **Fila de baixa confiança.** **Feito:** `?fila=revisar` no extrato + `POST /cron/resumo-baixa-confianca` no WhatsApp.
- **IA em dois níveis de custo.** **Feito:** regra determinística primeiro, modelo apenas no que sobra.
- **Reprocesso de webhook falho.** **Feito:** `POST /cron/open-finance-reprocessar`.
- **Retenção LGPD do payload OF.** **Feito:** anonimiza após 30 dias (`POST /cron/open-finance-retencao`).
- **Workspace consolidando PF e PJ** sem perder a separação por perfil.
- **API pública como fonte `api`.** Integração futura entra pela mesma porta, sem porta nova.

---

## 6. Evoluções futuras

Cada item tem uma **condição concreta** que o destrava. Antes dela, entrar é sofisticação, não solução.

| Item | Entra quando |
|---|---|
| Event bus interno | Houver três ou mais consumidores de evento |
| Módulo de notificações próprio | Existir um segundo canal, como e-mail ou push |
| Fila dedicada e processo de worker | O processamento de um lote de webhook não couber no tempo entre notificações |
| `modulos/importadores` para OFX, CSV e PDF | A importação de arquivo entrar no roadmap. Os valores já estão reservados em `TipoFonte`, e essa é toda a preparação necessária |
| Colunas dedicadas de projeto, centro de custo, cliente, fornecedor e subcategoria | `tags` deixar de ser suficiente |
| Metas, grupos e divisão de despesas | Depois do cockpit estável |
| Patrimônio e investimentos | Depois de metas |
| Templates de workspace, como MEI ou casal | Houver mais de um perfil de uso recorrente |
| Segundo provedor de Open Finance | Necessidade comercial. É a prova real do isolamento do módulo |
| Multi-moeda | Houver usuário com conta em outra moeda |
| Calendário, notas fiscais, OCR e automações | Depois da F6 |

Ver também a lista de fora de escopo em [02-ARQUITETURA.md](02-ARQUITETURA.md) e [ADR-014](adr/014-seis-modulos-sem-infra-nova.md).
