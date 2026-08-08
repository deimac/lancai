# ADR-014 — Seis módulos e nenhuma infraestrutura nova

**Status:** aceito

## Contexto

A primeira versão da arquitetura-alvo propunha treze módulos — incluindo `fontes`, `enriquecimento`, `regras`, `notificacoes`, `jobs`, `workspace` e `importadores` — mais um event bus interno e uma fila dedicada com Redis para os jobs de sincronização.

Cada peça tinha justificativa isolada plausível. Somadas, produziam uma arquitetura que um time pequeno não consegue manter: treze pacotes com build, dependência e teste próprios, um barramento de eventos sem consumidor, uma fila para um job horário, e módulos criados vazios “para o futuro”.

O filtro aplicado na revisão foi único, aplicado item por item: **isso resolve um problema real dos próximos 12 a 24 meses, ou apenas deixa a arquitetura mais sofisticada?**

## Decisão

A arquitetura tem **seis módulos**: `financeiro`, `conhecimento`, `open-finance`, `ia`, `relatorios` e `evolution`, mais `apps/api`, `apps/web` e os pacotes `tipos` e `banco`.

Nenhuma infraestrutura além da atual. Estão **explicitamente fora de escopo**:

- Event bus interno
- Framework de plugins
- Microsserviços
- Redis ou fila dedicada
- Módulos criados vazios

Consolidações feitas:

- A entrada de ingestão vive em `financeiro`; o desacoplamento vem do contrato em `pacotes/tipos`.
- `conhecimento` reúne enriquecimento, regras e memória, espelhando a separação Fato/Conhecimento na estrutura de pastas.
- Alertas são serviço em `apps/api` enquanto houver um único canal.
- Tarefas agendadas usam endpoint de cron com agendador externo.
- Workspace é coluna de escopo, não módulo.
- `modulos/importadores` será criado quando OFX e CSV entrarem no roadmap.

Cada item fora de escopo está em [06-ROADMAP.md](../06-ROADMAP.md) com a **condição concreta** que o destrava — event bus com três ou mais consumidores, fila quando o volume de sync não couber em cron, módulo de notificações no segundo canal.

## Alternativas consideradas

**Manter os treze módulos, argumentando que separar é sempre mais limpo.** Recusada. Separação tem custo de manutenção real e benefício apenas quando as partes evoluem em ritmos diferentes ou têm consumidores distintos. Nenhuma das separações removidas atendia a esses critérios.

**Adotar event bus já, para não precisar refatorar depois.** Recusada. Com um único consumidor, um barramento é indireção sem ganho, e torna o fluxo mais difícil de seguir num depurador. Introduzi-lo depois é uma refatoração localizada, não uma reescrita.

**Usar Redis e fila para o sync de Open Finance desde o início.** Recusada. Um job horário idempotente cabe em cron. A fila adicionaria um serviço para operar, competiria por memória na VPS e não resolveria nenhuma falha que o cron já não resolva.

## Consequências

- O código é mais fácil de seguir: menos saltos entre pacotes para entender um fluxo.
- Alguns arquivos ficarão maiores do que ficariam com módulos separados. Isso é aceito conscientemente.
- Quando uma condição de destrave for atingida, a promoção é uma refatoração localizada e prevista — não uma surpresa.
- Este ADR é a resposta padrão a propostas de adicionar camada, módulo ou serviço: mostre a condição concreta atendida.
- O risco real é a erosão silenciosa, um módulo por vez, cada um com boa justificativa isolada. As justificativas registradas em [02-ARQUITETURA.md](../02-ARQUITETURA.md) existem para que reverter exija contra-argumento, não apenas preferência.

Ver [03-MODULOS.md](../03-MODULOS.md) e [15-OPERACAO.md](../15-OPERACAO.md).
