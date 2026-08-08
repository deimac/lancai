# LançAI

Plataforma conversacional de inteligência financeira. O usuário controla toda a sua vida financeira (pessoal e empresarial) apenas conversando em linguagem natural — sem formulários, sem planilhas.

> A IA nunca é o sistema financeiro. Ela é só o interpretador de linguagem. Toda a inteligência financeira mora no `MotorFinanceiro`, no backend.

Comece pela [visão da arquitetura](docs/00-VISAO_DA_ARQUITETURA.md), que é a porta de entrada da documentação e leva a todos os outros documentos.

## Estrutura do monorepo

```text
lancai/
├── docs/                   # Documentação conceitual, ADRs e casos de teste
├── apps/
│   ├── web/                # Frontend conversacional (React + Vite + Tailwind + shadcn/ui)
│   └── api/                # Backend (Fastify + TypeScript)
├── modulos/                # Regras de negócio isoladas
│   ├── financeiro/         # MotorFinanceiro: cálculos, saldos, parcelamento
│   ├── conhecimento/       # Enriquecimento, regras, hábitos (Memoria)
│   ├── open-finance/       # Fonte bancária isolada
│   ├── ia/                 # OrquestradorIA + InterpretadorIntencoes
│   ├── relatorios/         # Consultas e visões de dados
│   └── evolution/          # Transporte WhatsApp
├── pacotes/                # Código compartilhado
│   ├── banco/              # Schema Drizzle + migrations + client Postgres/Supabase
│   └── tipos/              # Schemas Zod / DTOs / contratos IA <-> Motor Financeiro
└── infra/                  # Docker, Coolify, Caddy
```

## Requisitos

- Node.js >= 20
- pnpm >= 10 (`corepack enable` ou `npm i -g pnpm`)
- Uma conta [Supabase](https://supabase.com) (Postgres gerenciado + Auth)
- Pelo menos uma chave de API de provedor de IA (Gemini, Groq, OpenRouter, OpenAI ou uma instância Ollama local)

## Como rodar localmente

```bash
pnpm install
cp .env.example .env      # preencha com suas credenciais Supabase e chaves de IA
pnpm db:generate           # gera as migrations a partir do schema Drizzle
pnpm db:migrate            # aplica as migrations no Postgres do Supabase
pnpm db:seed               # popula categorias padrão
pnpm dev                   # sobe apps/api e apps/web em paralelo
```

- API: http://localhost:3333
- Web: http://localhost:5173

## IA híbrida (cloud + Ollama)

Ordem padrão: **Groq → Gemini 2.0 Flash → Ollama** (`qwen2.5:3b-instruct`).

- Cloud resolve latência e qualidade no dia a dia.
- Ollama é **último fallback** (evita 503 se as APIs caírem). Em VPS sem GPU (ex.: Hostinger KVM2, 2 vCPU / 8 GB) o modelo 3B cabe, mas fica lento — não use como padrão.
- Circuito: após 3 falhas seguidas num provedor, ele fica pausado ~2 minutos.
- Health-check com cache TTL pula provedor morto antes do timeout da mensagem.
- Redis/BullMQ **não** entram no caminho do `/chat` neste estágio (chat síncrono; fila não evita 503 e custa RAM). Detalhes em [`docs/10-IA.md`](docs/10-IA.md) e [`docs/15-OPERACAO.md`](docs/15-OPERACAO.md).

```bash
# Fallback local no Mac (dev) ou na VPS
brew install ollama          # ou: curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b-instruct
# No .env:
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=qwen2.5:3b-instruct
# LLM_ORDEM_FALLBACK=groq,gemini,ollama
```

## Scripts úteis

- `pnpm test` — roda os testes (Vitest) de todos os pacotes/módulos.
- `pnpm lint` / `pnpm format` — checagem e formatação de código.
- `pnpm typecheck` — checagem de tipos em todo o monorepo.

## Filosofia do projeto

Ver [`docs/05-PRD.md`](docs/05-PRD.md). Resumo:

1. O usuário conversa, nunca preenche formulário.
2. Toda informação pode ser corrigida por conversa.
3. Nada é excluído fisicamente — o sistema é *append-only* e auditado.
4. A IA propõe a intenção (JSON); o `MotorFinanceiro` valida e decide.
5. Todo o código — tabelas, classes, funções, rotas — é escrito em português.
