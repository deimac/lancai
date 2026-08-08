# Decisões de Arquitetura (ADRs)

Índice de todas as decisões de arquitetura do LançAI. Uma decisão registrada aqui só muda por outra decisão registrada, nunca por preferência em um PR.

Os ADR-001 a 008 vêm da especificação original e existem como enunciado; o contexto que os motivou não foi registrado na época e **não foi reconstruído**, para não inventar história. Do ADR-009 em diante cada decisão tem arquivo próprio, com contexto, alternativas consideradas e consequências.

| ADR | Decisão | Detalhe |
|---|---|---|
| 001 | Todo nome técnico é escrito em português. | [01-DOMINIO.md](../01-DOMINIO.md) |
| 002 | Toda inteligência e validação financeira reside exclusivamente no `MotorFinanceiro`. | [09-REGRAS_DE_NEGOCIO.md](../09-REGRAS_DE_NEGOCIO.md) |
| 003 | A IA não possui credencial de escrita no banco. Lê contexto e gera intenção em JSON estruturado. | [10-IA.md](../10-IA.md) |
| 004 | O sistema é agnóstico a provedor de LLM através do `OrquestradorIA`, implementado sobre o Vercel AI SDK. | [10-IA.md](../10-IA.md) |
| 005 | Histórico de chat e memória de longo prazo ficam no banco relacional, nunca no contexto volátil da IA. | [10-IA.md](../10-IA.md) |
| 006 | O core do backend é desacoplado, permitindo que a mesma API atenda Web, WhatsApp ou outro canal. | [02-ARQUITETURA.md](../02-ARQUITETURA.md) |
| 007 | Não existe tabela `empresa`; a separação PF/PJ é feita pelo campo `perfil`. | [01-DOMINIO.md](../01-DOMINIO.md) |
| 008 | O cruzamento PF/PJ é puramente classificatório, sem gerar lançamento de mútuo ou dívida. | [09-REGRAS_DE_NEGOCIO.md](../09-REGRAS_DE_NEGOCIO.md) |
| 009 | Todo `movimento` separa Fato Financeiro de Conhecimento do LançAI, e o Fato é imutável quando vem de instituição. | [009](009-fato-vs-conhecimento.md) |
| 010 | Toda movimentação entra como `EventoFinanceiroNormalizado`, produzido por uma Fonte Financeira. | [010](010-fonte-financeira-porta-unica.md) |
| 011 | Open Finance é apenas uma Fonte Financeira; nenhum módulo fora dele depende de provedor. | [011](011-open-finance-isolado.md) |
| 012 | IA e WhatsApp podem enriquecer, nunca criar, alterar ou excluir Fato de conta sincronizada. | [012](012-limites-de-escrita-da-ia.md) |
| 013 | `workspace_id` existe em todas as tabelas de dados desde a primeira migração. | [013](013-workspace-id-desde-a-primeira-migracao.md) |
| 014 | Seis módulos e nenhuma infraestrutura nova. Event bus, plugins, microsserviços e fila estão fora de escopo. | [014](014-seis-modulos-sem-infra-nova.md) |
| 015 | A ingestão de Open Finance é reativa a webhook do provedor; cron só reprocessa e reconcilia. | [015](015-ingestao-por-webhook.md) |

---

## Como registrar um ADR novo

Um ADR é necessário quando a decisão é difícil de reverter, atravessa mais de um módulo ou contraria uma decisão anterior. Escolha de biblioteca ou refatoração local não precisa de ADR.

Formato: contexto, decisão, alternativas consideradas, consequências. O contexto deve explicar o problema real que existia, não a solução escolhida.

Numeração sequencial, sem reaproveitar número. Um ADR revogado permanece no índice marcado como revogado, com link para o que o substituiu.
