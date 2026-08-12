# 15 — Operação

Configuração, deploy, tarefas agendadas e observabilidade. É o documento de quem precisa colocar o LançAI no ar ou entender por que algo parou.

**Este documento não cobre:** a arquitetura de software — ver [02-ARQUITETURA.md](02-ARQUITETURA.md). O comportamento dos provedores de modelo — ver [10-IA.md](10-IA.md).

---

## 1. Variáveis de ambiente

A referência viva é o `.env.example` na raiz. Esta seção explica os grupos e o que exige cuidado.

### Supabase e banco
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `DATABASE_URL`, que é a string de conexão direta do Postgres usada pelo Drizzle.

A chave de service role nunca vai para o frontend.

### API
`PORTA_API` (padrão 3333), `URL_WEB` e `CARTAO_DADOS_KEY`.

`CARTAO_DADOS_KEY` é uma chave AES-256 de 32 bytes em base64, usada para cifrar número, validade e CVV dos cartões. Gerar com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Perder essa chave torna os dados de plástico irrecuperáveis. Trocá-la exige recifrar o que já está gravado.

### Provedores de modelo
`LLM_PROVEDOR_PADRAO` e `LLM_ORDEM_FALLBACK` definem quem responde e em que ordem. Groq é o primeiro; Gemini só entra quando habilitado explicitamente.

Timeouts separados por natureza do provedor: `LLM_TIMEOUT_MS` para nuvem (padrão 20000) e `LLM_TIMEOUT_OLLAMA_MS` para local (padrão 90000), porque um modelo em CPU precisa de folga muito maior.

Health-check opcional: `LLM_HEALTH_TTL_MS` (padrão 45000) e `LLM_HEALTH_PING_MS` (padrão 2500).

Chaves e modelos: `GROQ_API_KEY`, `GEMINI_API_KEY` com `GEMINI_MODEL` preferindo `gemini-2.0-flash`, além de `OPENROUTER_API_KEY` e `OPENAI_API_KEY`.

O Groq usa modelos diferentes por tarefa, o que é uma decisão de custo: um modelo maior para extração e slot-filling, um menor e mais barato para classificação de ramo, mais os modelos de transcrição de áudio e de visão de comprovante.

### Ollama
`OLLAMA_HABILITADO` é `false` por padrão. **O sistema não chama Ollama sem esse flag**, o que mantém a produção isolada de um provedor local lento. Quando habilitado: `OLLAMA_BASE_URL`, `OLLAMA_MODEL` e a inclusão de `ollama` no fim de `LLM_ORDEM_FALLBACK`.

### Evolution
`EVOLUTION_URL`, `EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_INSTANCE` e opcionalmente `EVOLUTION_INSTANCE_API_KEY`.

`WHATSAPP_NUMERO_LANCAI` é o número da instância que **recebe** mensagens, só com dígitos. Não confundir com o número do cliente: os clientes autorizados ficam em `usuario.whatsapp_numero`.

O webhook receptor é `POST /api/webhooks/evolution`.

### Open Finance
`OPEN_FINANCE_PROVEDOR` escolhe o adaptador ativo, entre `pluggy` e `duble`. **Sem ela, a Fonte está desligada** e o webhook responde 503 — é assim que o provedor de mentira não sobe por descuido. Com um valor que não tem adaptador, ou com credencial faltando, a API falha ao montar em vez de cair no dublê: uma Fonte que finge estar conectada ao banco é pior que uma Fonte desligada.

Com `pluggy`, `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` são obrigatórias. São elas que leem dado financeiro: ficam no servidor, nunca no frontend nem em log. O que vai para o navegador é o Connect Token de 30 minutos, que abre o widget e não lê dados.

`OPEN_FINANCE_WEBHOOK_URL` é a URL pública desta API, repassada ao provedor ao criar o token. Precisa ser HTTPS — o provedor recusa localhost, então em desenvolvimento é preciso um túnel.

Valores válidos hoje: `pluggy` e `duble`.

`OPEN_FINANCE_WEBHOOK_SEGREDO` é o segredo esperado no header `X-Lancai-Webhook`. **Sem ela a rota fica fechada**, mesmo com provedor ativo: webhook aberto é porta para gravar Fato falso no extrato de alguém. Com o dublê a UI dispara a ingestão pela API (`/open-finance/duble/...`) e **não** precisa do webhook externo — o segredo só importa quando o provedor real posta em `/api/webhooks/open-finance`.

O webhook receptor é `POST /api/webhooks/open-finance` (alias `POST /api/webhooks/pluggy` para o Dashboard Pluggy). Ele responde 2XX antes de processar, e a Pluggy exige isso em menos de cinco segundos — ver seção 8.3 de [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).

As rotas de conexão vivem sob `/open-finance` e respondem 503 quando a Fonte está desligada, com exceção de `GET /open-finance/fonte`, que responde `disponivel: false` — é assim que a interface sabe não oferecer o botão de conectar em vez de oferecer um botão que quebra.

### Checklist: dublê local (sem Pluggy)

Use isto para validar associação, ingestão, classificação, conciliação e extrato sem credenciais nem túnel. **Não fecha a F2** — o sandbox Pluggy ainda é obrigatório para o adaptador real.

1. No `.env`: `OPEN_FINANCE_PROVEDOR=duble` (sem `PLUGGY_*`).
2. `pnpm dev`. Em `/conexoes`, **Conectar banco de mentira**.
3. Associar a conta externa a uma conta/cartão local (aceita o aviso de sincronização).
4. **Sincronizar lote de mentira** — grava 3 Fatos de amostra (mercado, Uber, salário), classifica e atualiza o último sync.
5. Conferir em `/extrato` (e fila `?fila=revisar` se a IA estiver desligada ou abaixo do limiar).

As rotas `POST /open-finance/duble/conexoes` e `POST /open-finance/duble/conexoes/:id/sincronizar` só existem com o dublê; com Pluggy respondem 404.

### Checklist: sandbox Pluggy (fecha F2)

1. Criar conta no dashboard Pluggy e copiar `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` (API Keys do sandbox).
2. No `.env`: `OPEN_FINANCE_PROVEDOR=pluggy`, as duas chaves, `OPEN_FINANCE_WEBHOOK_SEGREDO` (string longa aleatória) e `OPEN_FINANCE_WEBHOOK_URL=https://<túnel>/api/webhooks/open-finance`.
3. Subir um túnel HTTPS apontando para a API local (ex.: Cloudflare Tunnel / ngrok → `localhost:3333`). Localhost puro é recusado pelo provedor.
4. `pnpm dev` (API + web). Em `/conexoes`, conectar o conector **Pluggy Bank** com `user-ok` / `password-ok` e MFA `123456`.
5. Associar conta externa → conta/cartão local; confirmar movimentos no `/extrato` e classificação (regra/IA/fila Revisar).
6. Em `/conexoes`, **Atualizar agora** (`POST /open-finance/conexoes/:id/atualizar`): tenta `PATCH /items/{id}` (best-effort; itens **Meu Pluggy** recusam com `MeuPluggy item cant be updated` e o LançAI ignora) e **sempre importa** o extrato via GET (365 dias). Itens Meu Pluggy sincronizam no app Meu Pluggy; o LançAI só lê. Webhook continua o caminho ideal em Production; o cron `open-finance-importar-historico` (stale + lookback) cobre silêncio em Meu Pluggy/sandbox.
7. Casos de falha úteis: `user-locked`, `user-logged` (credencial / sessão) — a UI deve cair em `precisa_atencao` com motivo legível.

### Checklist: Coolify + Pluggy Connect real (Nubank PF)

Variáveis **só no serviço da API** (nunca no Web / nunca com prefixo `VITE_`):

```env
OPEN_FINANCE_PROVEDOR=pluggy
PLUGGY_CLIENT_ID=<Application Pluggy>
PLUGGY_CLIENT_SECRET=<Application Pluggy>
OPEN_FINANCE_WEBHOOK_URL=https://<dominio-api-https>/api/webhooks/open-finance
OPEN_FINANCE_WEBHOOK_SEGREDO=<string longa aleatória>
```

Web (já existentes): `VITE_API_URL=https://<dominio-api-https>`, `VITE_SUPABASE_*`.

**Dashboard Pluggy (Application):**

1. Webhook URL (produção): `https://api.lancai.xploreia.com/api/webhooks/pluggy` — deve coincidir com `OPEN_FINANCE_WEBHOOK_URL` (HTTPS obrigatório). O path `/api/webhooks/open-finance` é alias do mesmo handler.
2. Header customizado `X-Lancai-Webhook` = o mesmo valor de `OPEN_FINANCE_WEBHOOK_SEGREDO` (sem isso a API responde 401).
3. Eventos: `all` ou pelo menos `item/created`, `item/updated`, `transactions/created`, `transactions/updated`, `transactions/deleted`.
4. O Connect Token usa `clientUserId = usuarioId` LançAI (não workspace).

**Smoke após deploy:**

1. `GET https://<api>/open-finance/fonte` → `{ "id": "pluggy", "disponivel": true }` (ou só `disponivel` conforme response).
2. Pelo Web: `/conexoes` → **+ Conectar conta ou cartão** → Pluggy Connect → Nubank → autorizar.
3. Detalhe da conexão mostra instituição, contas/cartões; **Atualizar agora** traz transações (lista no detalhe + Extrato, `fonte=open_finance`).

Domínio da API e do Web em HTTPS. O fluxo de produto definitivo é Pluggy Connect no app; Meu Pluggy é só ferramenta de teste (abaixo).

### Checklist: Meu Pluggy → LançAI (teste com dados reais em Development)

Enquanto a Application Pluggy estiver em sandbox/Development, o [Meu Pluggy](https://meu.pluggy.ai/api-guide) funciona como proxy LGPD dos seus próprios bancos (Nubank etc.).

1. Conta no Meu Pluggy → conectar Nubank (e o que for).
2. No Dashboard Pluggy da **mesma Application** cujas chaves estão no Coolify, vincular/proxyar o item Meu Pluggy.
3. Webhook já cadastrado: `https://api.lancai.xploreia.com/api/webhooks/pluggy` + header `X-Lancai-Webhook` + eventos `all`.
4. Copiar o `itemId` do item (Dashboard / `GET /items` com API Key).
5. **Reset financeiro do usuário de teste** (recomendado antes da 1ª ingestão), para não misturar contas manuais com sincronizadas:

```bash
# na raiz, com DATABASE_URL no ambiente
USUARIO_ID=<uuid-do-usuario> CONFIRMAR=1 pnpm --filter @lancai/banco db:reset-financeiro
```

Mantém login, workspaces e categorias. Apaga movimentos, parcelas, conexões OF, contas e cartões desse usuário; zera vínculos de orçamento/recorrência.

6. Registrar o item no LançAI (webhook **não** cria conexão sozinho). Comandos também em [`pacotes/banco/scripts/registrar-item-pluggy.md`](../pacotes/banco/scripts/registrar-item-pluggy.md):

```bash
curl -X POST https://api.lancai.xploreia.com/open-finance/conexoes \
  -H 'Content-Type: application/json' \
  -d '{"usuarioId":"<uuid>","conexaoExterna":"<itemId>"}'
```

Ou em `/contas` → aba **Bancos** → **Reatachar** (recomendado se já existem Contas/Cartões).

7. Web → Contas → **Atualizar agora** (menu do banco) → conferir Extrato com `fonte=open_finance`.

#### Meu Pluggy: itemId novo (dois caminhos)

| Caminho | Quando | O que faz |
|---------|--------|-----------|
| **Reatachar** (`POST /open-finance/conexoes/reatachar`) | Perdeu o item e o Meu Pluggy gerou **novo** itemId; quer manter Contas/Cartões e categorias | Pareia recursos externos → destinos locais; GET extrato; **só cria** o que for novo (`id_externo` + skip semântico data/valor/descrição). Não sobrescreve categorias. |
| **Excluir** (hard-delete em Contas/Cartões) | Quer limpar tudo e começar de novo | Apaga conta/cartão + extrato OF (usa `SET LOCAL lancai.sincronizacao=on`). Irreversível. |

UI: hub `/contas` com abas Contas · Cartões · Bancos (`/conexoes` redireciona para `#bancos`).

Credenciais: as mesmas `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` da Application que enxerga o item. `OPEN_FINANCE_WEBHOOK_URL` deve ser a URL `/pluggy` acima.

### Cron
`CRON_SECRET`, enviado como `Authorization: Bearer <CRON_SECRET>`.

### Frontend
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_API_URL`. Tudo que tem prefixo `VITE_` vai para o bundle e é público — nunca colocar segredo aqui.

---

## 2. Desenvolvimento local

```bash
pnpm install
cp .env.example .env   # preencher as chaves que você tem
pnpm dev
```

Para usar o Ollama no Mac:

```bash
brew install ollama
ollama pull qwen2.5:3b-instruct
ollama serve
```

E no `.env`: `OLLAMA_HABILITADO=true`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=qwen2.5:3b-instruct` e `LLM_ORDEM_FALLBACK=groq,gemini,ollama`.

Com o Ollama no ar, o fallback local responde em cerca de 20 a 40 segundos no modelo 3B.

### Forçar só o Ollama, para teste

```bash
LLM_PROVEDOR_PADRAO=ollama
LLM_ORDEM_FALLBACK=ollama
# comentar ou esvaziar GROQ_API_KEY e GEMINI_API_KEY
```

Reiniciar a API e enviar uma mensagem que force o modelo, por exemplo “como está a evolução dos meus gastos?”, que não é reconhecida por atalho.

### Testes
Rodar sempre de dentro de cada pacote, nunca da raiz. Ver [14-TESTES.md](14-TESTES.md).

---

## 3. Produção

Stack de infraestrutura: Docker, Coolify, VPS Hostinger e Caddy.

### Deploy da API no Coolify (Nixpacks)

O serviço da API usa `nixpacks.toml` na raiz: install com `pnpm install --frozen-lockfile`, build com `pnpm build:api` (typecheck), start com `pnpm start:api` (`tsx`).

No painel Coolify deste serviço:

1. **Build Command** vazio (usa o `nixpacks.toml`) ou explicitamente `pnpm build:api`.
2. Não use `pnpm build:all` nem o build do Vite neste serviço — a Web é outro app.
3. O script raiz `pnpm build` aponta para `pnpm build:api` (defesa se o painel ainda mandar `pnpm build`).
4. `package.json` permite scripts de build do `esbuild` (`pnpm.onlyBuiltDependencies`) — o `tsx` depende disso em runtime.

### Ollama no servidor
O plano de referência é uma KVM2 com 2 vCPU e 8 GB. Se for habilitar o Ollama lá:

1. Instalar pelo script oficial ou por Docker
2. `ollama pull qwen2.5:3b-instruct`, que consome de 2 a 3,5 GB de memória em uso
3. Usar as mesmas variáveis da API
4. Manter Groq e Gemini como caminhos principais; o Ollama só evita indisponibilidade total

**Não usar modelo de 7B ou maior como provedor único nesse plano** — aperta a memória junto com a API Node.

---

## 4. Tarefas agendadas

O padrão do projeto é **endpoint HTTP protegido, chamado por agendador externo**, hoje o do Coolify. Não há fila nem worker dedicado.

- `POST /cron/recorrencias` materializa as recorrências do dia. A idempotência vem de `ultima_geracao` na tabela `recorrencia`, que guarda o último mês gerado.
- `POST /cron/resumo-baixa-confianca` envia pelo WhatsApp o resumo diário da fila de revisão (não classificado + IA abaixo de 0,7). Idempotência por usuário/dia no hábito `resumo_baixa_confianca_dia`. Agendar 1×/dia (ex. 20h). `?dryRun=1` lista sem enviar.
- `POST /cron/open-finance-reprocessar` — rede de segurança Open Finance: reprocessa `open_finance_evento` com `erro` preenchido (não substitui o webhook; [ADR-015](adr/015-ingestao-por-webhook.md)). Idempotente via `id_externo`. Após sucesso, aplica classificação/conciliação como no webhook. `?dryRun=1` só lista; `?limite=N` (máx. 200, padrão 50). Agendar a cada 15–60 min. Sem Fonte ativa responde `fonteAtiva: false` sem erro.
- `POST /cron/open-finance-importar-historico` — **importa extrato via GET** (já coletado no provedor). **Não** chama `PATCH /items` nem sync em lote (proibido pela Pluggy). Cobre Meu Pluggy (item que recusa update via API) e webhooks silenciosos. Atualiza saldos institucionais + `importar_historico` + pós-processo (classificação/conciliação). Idempotente via `id_externo`. Só processa conexões **stale** (`OPEN_FINANCE_STALE_AFTER_MINUTES`, padrão 240). Lookback GET: `OPEN_FINANCE_SYNC_LOOKBACK_DAYS` (padrão 14; primeira sync = 365). Lock em memória por conexão (não cruza com “Atualizar agora”). Logs `SYNC_START` / `SYNC_OK` / `SYNC_FAIL` / `SYNC_SKIP_FRESH` / `SYNC_SKIP_LOCKED`. `?dryRun=1` lista candidatas stale; `?limite=N` (máx. 200, padrão 50). **Agendar a cada 1–2 h** no Coolify (ou 6 h se volume baixo). Sem Fonte ativa responde `fonteAtiva: false` sem erro.
- `POST /cron/open-finance-retencao` — LGPD: anonimiza payload de eventos OF processados com sucesso há mais de `OPEN_FINANCE_RETENCAO_DIAS` (padrão 30). Mantém a linha por idempotência. Agendar 1×/dia.

Toda tarefa agendada precisa ser idempotente: o agendador pode chamar duas vezes.

#### Coolify — importar histórico OF (a cada 1–2 h)

No agendador do serviço da API:

```bash
curl -sS -X POST "https://api.lancai.xploreia.com/cron/open-finance-importar-historico" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Cron sugerido: `0 */2 * * *` (a cada 2 h UTC). Alternativa leve: `0 */6 * * *`. Smoke: `?dryRun=1` lista candidatas stale sem importar.

**Checklist ops (confirmar no Coolify):**

1. Job HTTP `POST .../cron/open-finance-importar-historico` com Bearer `CRON_SECRET`.
2. Env da API: `OPEN_FINANCE_STALE_AFTER_MINUTES=240`, `OPEN_FINANCE_SYNC_LOOKBACK_DAYS=14`.
3. Após um tick: logs com `SYNC_*`; resposta JSON com `importadas` / `puladasFrescas` / `falhas`.

#### Meu Pluggy vs Production (auto-sync)

| | Meu Pluggy / Development | Pluggy Production |
|--|--------------------------|-------------------|
| Quem atualiza o banco | App / proxy Meu Pluggy | Auto-sync Pluggy (24/12/8 h conforme plano) |
| `PATCH /items/{id}` | Recusado (`MeuPluggy item cant be updated`) — LançAI trata como no-op | Aceito em “Atualizar agora” pontual |
| Papel do LançAI | **Consumir** (GET + webhook se chegar) | Webhook principal + GET/cron como rede de segurança |
| O que o cron não faz | Não força o banco a syncar; só lê o que já foi coletado | Idem — nunca faz batch de PATCH |

Se os dados no LançAI estão velhos com Meu Pluggy: sincronize no app Meu Pluggy, depois use **Atualizar agora** ou aguarde o cron GET.

---

## 5. Por que não há fila

Decisão registrada, com as condições para revisá-la.

`POST /chat` é síncrono: recebe, interpreta e responde na mesma conexão. Colocar Redis e uma fila nesse caminho:

1. Não corrige indisponibilidade de provedor de modelo — o worker falharia igual
2. Obriga a redesenhar a interface com identificador de job e polling ou websocket
3. Compete por memória na VPS com a API e, se habilitado, o Ollama
4. Só compensa com vários workers ou réplicas, que ainda não é o caso

Fila entra quando houver multi-instância, relatório pesado, processamento de webhook em volume, ou um fluxo do tipo “pense e avise depois”. Ver [06-ROADMAP.md](06-ROADMAP.md) e [ADR-014](adr/014-seis-modulos-sem-infra-nova.md).

Para Open Finance a fila é ainda menos necessária do que se pensava: o webhook grava o evento bruto e responde, e o processamento acontece depois na mesma instância. O que faz o papel de fila é a tabela `open_finance_evento` — evento registrado, `processado_em` nulo, `erro` preenchido quando falha. Fila de verdade entra se o volume de webhook não couber nisso.

---

## 6. Observabilidade

### Provedores de modelo
Circuit breaker abre após 3 falhas seguidas e pausa o provedor por cerca de 2 minutos. Em produção o health-check é fail-open: um ping falho não bloqueia a tentativa. Se todos os provedores estiverem em circuito aberto, há uma limpeza e nova tentativa.

### WhatsApp
Todo evento do webhook é gravado em `evolution_evento`, sem o campo de credencial. É a primeira coisa a olhar quando uma mensagem “não chegou”.

### Sync de Open Finance
Requisito, não melhoria: último sync bem-sucedido por conexão, atraso desde então, erro de consentimento visível na interface com caminho para reconectar, e contagem de Fatos criados e ignorados por duplicata em cada execução. Sem isso o usuário perde confiança no que o produto chama de fato.

Onde olhar hoje: `open_finance_evento` guarda todo webhook recebido, com `processado_em` e `erro` — é o equivalente de `evolution_evento` e a primeira coisa a checar quando uma transação “não apareceu”. `open_finance_conexao` guarda `status`, `motivo_atencao`, `ultimo_sync_em` e `ultimo_resumo_ingestao` — a tela `/conexoes` mostra status, atraso, contagem do último lote e reconectar. O log da rota ainda traz o detalhe por evento.

### Auditoria
`auditoria` é a trilha de tudo que mudou em `movimento` e `parcela`, com estado anterior e atual. É a fonte para investigar “por que esse valor está diferente”.

---

## 7. Segurança operacional

- `SUPABASE_SERVICE_ROLE_KEY` e `CARTAO_DADOS_KEY` são os dois segredos mais sensíveis. Não vão para o frontend nem para log.
- Dados de plástico ficam cifrados em `dados_plasticos_cifrados` e só são devolvidos após validação de senha no chat. Nunca em listagem.
- O payload bruto de Open Finance contém dado financeiro identificável; após 30 dias (configurável) o cron de retenção o substitui por stub — ver [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).
- Endpoints de cron são protegidos por `CRON_SECRET`.

---

## 8. TODO

- Procedimento de backup e restauração do banco
- Rotação de chaves, especialmente `CARTAO_DADOS_KEY`
- Alarme quando o cron não roda
- Ambiente de staging
- Limites de taxa por usuário nas rotas de chat
