# 11 — Web

O Web novo é um **cockpit financeiro** com assistente de IA integrado, e substitui o MVP de chat.

**Este documento não cobre:** as rotas HTTP consumidas — ver [08-CONTRATOS.md](08-CONTRATOS.md). As fases de entrega — ver [06-ROADMAP.md](06-ROADMAP.md).

> Boa parte deste documento é **TODO**. O conceito do cockpit está decidido; telas, rotas e componentes nunca foram detalhados, e detalhar aqui sem discussão seria inventar decisão de produto.

---

## 1. Estado atual: MVP de chat

O `apps/web` de hoje é uma prova de conceito conversacional. Vai ser desligado, mas três decisões dele permanecem válidas e devem ser carregadas para o Web novo.

### Estrutura

```text
apps/web/src/
├── App.tsx
├── RotaProtegida.tsx
├── layout/{LayoutAutenticado,PainelAssistente}.tsx
├── contexto/ContextoAutenticacao.tsx
├── paginas/{TelaLogin,TelaDashboard,TelaContas,TelaCartoes,TelaCategorias,TelaRegras,TelaConfiguracoes,TelaConexoes,TelaExtrato}.tsx
├── componentes/{JanelaChat,BolhaMensagem,ChipsAtalho}.tsx
├── componentes/ui/{Botao,Campo,Cartao}.tsx
└── lib/{api,supabase,unir-classes,preferencias-painel,invalidacao-dados,formatar,fila-revisao}.ts
```

React com Vite, TypeScript e Tailwind CSS v4. Base no estilo shadcn (CVA + Radix slot/tooltip), gráficos com `recharts`, motion leve com `framer-motion`. Tipografia: Plus Jakarta Sans. O MVP de chat fullscreen foi desligado: a home é o dashboard e o assistente vive no painel.

### Decisões que permanecem

**Autenticação.** O `usuario.id` é literalmente o mesmo UUID do `auth.users.id` do Supabase, sem tabela de vínculo. Após qualquer login ou cadastro bem-sucedido, o frontend chama `POST /usuarios/sincronizar`, que é idempotente. Isso mantém o `MotorFinanceiro` e toda a API agnósticos de como a autenticação é feita.

**O `useChat` do Vercel AI SDK foi descartado de propósito.** Ele espera streaming token a token, mas `POST /chat` devolve uma resposta única já processada pelo backend — a IA só interpreta a intenção, o motor decide. Por isso o estado da conversa é local ao componente, com o identificador de sessão mantido em memória para dar continuidade ao histórico.

**Recarregamento reativo.** O painel de saldos é recarregado automaticamente sempre que o chat processa um registro ou uma correção. O cockpit precisa da mesma propriedade, generalizada: uma ação do assistente atualiza a tela em que o usuário está.

---

## 2. O que o Web novo é

Um cockpit: o usuário vê a situação financeira e age sobre ela, com o assistente disponível o tempo todo.

O assistente **não é uma página**. É um painel lateral (ou inferior, em telas estreitas) persistente durante toda a navegação. O usuário pode perguntar “quanto gastei em restaurantes?” ou afirmar “esse PIX foi pessoal” sem sair da tela em que está.

O painel usa as mesmas intenções e o mesmo Core do WhatsApp. Não existe um segundo pipeline de linguagem natural.

---

## 3. Escopo de telas

### Entram na fase F2, como skeleton
O widget de conexão bancária precisa de tela, então o Web novo começa antes de estar completo:

- Login — feito
- Conexão de Open Finance (`/conexoes`) — feito; o widget mora em `@lancai/open-finance/web`. Com `OPEN_FINANCE_PROVEDOR=duble`, a tela cria conexão e sincroniza lote sem widget (ver [15-OPERACAO.md](15-OPERACAO.md))
- Extrato (`/extrato`) — lista, filtro banco/manual/revisar, classificação inline, parcelamento e status

### Feito na F4 (shell do cockpit)
- **Layout autenticado** com sidebar (Início, Contas, Cartões, Categorias, Regras, Extrato, Bancos, Configurações)
- **Dashboard** com resumo do mês, gastos por categoria, fluxo de saldo, recentes e alerta de “Não classificado” — dados via `GET /dashboard` (sem cálculo financeiro no web)
- **Contas** (`/contas`): lista com saldo, perfil, badge “Sincronizada”, criar conta manual
- **Cartões** (`/cartoes`): lista com limite, fechamento/vencimento, badge “Sincronizado”, criar cartão manual
- **Categorias** (`/categorias`): lista agrupada por tipo, destaque de “Não classificado”, criar categoria
- **Regras** (`/regras`): lista `trecho → categoria`, criar, pausar/ativar; API `GET/POST/PATCH /regras`
- **Configurações** (`/configuracoes`): nome, vínculo WhatsApp, posição do painel (gravada em `usuario.posicao_painel` via `PATCH /usuarios/:id`; `localStorage` só como cache)
- **Painel de IA persistente**: posição `lateral` ou `inferior`, expansível/recolhível; preferência em `localStorage`
- **Extrato** (`/extrato`): classificação inline via `PATCH /conhecimento`, badge `classificado_por` / confiança, explicação (“regra «IFOOD»”, “IA 72%”, “você em dd/mm/aaaa”), fila `?fila=revisar` (não classificado + IA abaixo de 0,7)
- Extrato e Conexões no shell; legado `PainelSaldos` / home chat removidos

Inspiração visual: dashboards densos e usáveis (ex. Securo) — **conceitos apenas**, zero código de terceiros.

### Adiadas
Patrimônio, metas, grupos e divisão de despesas, planejamento, integrações e relatórios avançados. Estão em [06-ROADMAP.md](06-ROADMAP.md) como evolução futura.

A lista da F4 é **fechada**. O risco registrado é o escopo do Web explodir para reproduzir todas as telas de um produto de referência antes de entregar valor.

---

## 4. Regras de arquitetura do frontend

Poucas, e não negociáveis:

- **Nenhuma lógica financeira no Web.** Cálculo, validação e regra ficam no backend. A tela exibe e pede.
- **Nenhum provedor de Open Finance fixo no código.** O Web pergunta à API quais fontes estão ativas e renderiza o widget correspondente. Ver [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).
- **Fato é somente leitura na interface.** Valor, data, conta e descrição de origem de uma movimentação sincronizada não têm campo editável. O que a tela oferece é enriquecer.
- **Escrita de Conhecimento é sempre explícita.** Categoria, pessoa, perfil, tags e observações usam o endpoint de Conhecimento, nunca um formulário que envie o movimento inteiro de volta.

Essa última regra é a tradução na interface do [ADR-009](adr/009-fato-vs-conhecimento.md): um formulário que faz `PUT` do objeto completo violaria a invariante mesmo com o backend correto.

---

## 5. Elementos de interface que a arquitetura pressupõe

Não são sugestões de design; são consequências de decisões já tomadas:

- **Indicador de conta sincronizada**, para o usuário entender por que não pode editar aquele lançamento. A mensagem de produto é “esta conta é sincronizada, o assistente só classifica”.
- **Fila de baixa confiança**, listando o que a IA classificou com pouca certeza para revisão rápida.
- **Estado do sync** — `/conexoes`: status, motivo, último sync com atraso relativo, aviso se >36 h, consentimento próximo do fim, reconectar, **Atualizar agora** (Pluggy) ou lote de mentira (dublê).
- **Oferta de virar regra** depois de uma classificação manual (via chat; confirmação “sim”/“não”).

---

## 6. Invalidação de dados (cockpit)

Cada mutação chama `invalidar(...escopos)` no layout (`apps/web/src/lib/invalidacao-dados.ts`). Escopos: `dashboard`, `contas`, `cartoes`, `categorias`, `regras`, `extrato`, `conexoes`. A tela só recarrega quando um dos escopos que ela lê avança; o chat que altera saldos usa `tudo`.

## 7. TODO (pós-F4 / polish)

F4 do cockpit está entregue. Itens úteis, sem bloquear a fase:

- Sandbox Pluggy ponta a ponta — checklist em [15-OPERACAO.md](15-OPERACAO.md) (fecha F2)

Feito neste polish: invalidação por escopo; a11y do painel (landmark, Escape, foco no abrir/fechar, `aria-label` nos controles e na nav mobile).
