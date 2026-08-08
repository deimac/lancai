# 04 — Glossário

Consulta rápida. Uma linha por termo, com link para o documento que aprofunda.

**Este documento é deliberadamente raso.** Se uma definição aqui começar a crescer, ela pertence ao [01-DOMINIO.md](01-DOMINIO.md) e aqui deve ficar apenas o resumo.

---

## Conceitos centrais

| Termo | Definição | Aprofunda em |
|---|---|---|
| **Fato Financeiro** | O que a instituição informou: valor, data, conta, descrição original, identificador da transação. Imutável quando vem de instituição. | [01](01-DOMINIO.md) |
| **Conhecimento do LançAI** | O que o LançAI ou o usuário sabe sobre um Fato: categoria, pessoa, perfil, tags, observações. Sempre mutável. | [01](01-DOMINIO.md) |
| **Fonte Financeira** | Qualquer origem de movimentação. Todas produzem o mesmo objeto interno. | [08](08-CONTRATOS.md) |
| **Core Financeiro** | `modulos/financeiro`. Único componente com autoridade para gravar Fato. | [03](03-MODULOS.md) |
| **Conta sincronizada** | Conta ou cartão vinculado a uma conexão de Open Finance. Define o comportamento do assistente. | [01](01-DOMINIO.md) |
| **Workspace** | Escopo que agrupa usuários, contas e conhecimento. Permite CPF, CPF do sócio e CNPJ juntos. | [01](01-DOMINIO.md) |
| **Enriquecer** | Escrever Conhecimento sobre um Fato existente. Única escrita permitida à IA em conta sincronizada. | [09](09-REGRAS_DE_NEGOCIO.md) |
| **Fluxo cruzado** | Movimento cujo `perfil` difere do `perfil` da conta ou cartão usados. Só classificatório. | [09](09-REGRAS_DE_NEGOCIO.md) |
| **Perfil** | `pf` ou `pj`. Substitui a inexistente tabela `empresa`. | [01](01-DOMINIO.md) |

## Pipeline de linguagem natural

| Termo | Definição | Aprofunda em |
|---|---|---|
| **Intenção** | Objeto JSON tipado que a IA produz a partir da mensagem. Nunca texto livre interpretado à mão. | [08](08-CONTRATOS.md) |
| **Atalho determinístico** | Reconhecimento por padrão, sem chamar LLM. Reduz custo e latência. | [10](10-IA.md) |
| **Ramo do classificador** | Agrupamento de intenções usado para reduzir o schema enviado ao modelo. | [10](10-IA.md) |
| **Slot-filling** | Completar uma intenção incompleta perguntando um campo por vez. | [09](09-REGRAS_DE_NEGOCIO.md) |
| **Normalizador** | Etapa pós-IA que aplica defaults, enxuga descrição e converte intenção incompleta em pergunta. | [10](10-IA.md) |
| **Resolvedor** | Traduz nomes em texto livre para identificadores reais. Não calcula nada. | [10](10-IA.md) |
| **Desambiguação** | Lista numerada quando vários movimentos combinam com a referência do usuário. | [09](09-REGRAS_DE_NEGOCIO.md) |
| **Intenção pendente** | Intenção parcial guardada entre turnos, aguardando o campo que falta. | [10](10-IA.md) |

## Verbos com significado técnico

| Termo | Definição | Aprofunda em |
|---|---|---|
| **Registrar** | Criar um Fato novo. Só em conta não sincronizada ou via Fonte Financeira. | [01](01-DOMINIO.md) |
| **Corrigir** | Alterar campos de um Fato mutável. Nunca cancela. | [09](09-REGRAS_DE_NEGOCIO.md) |
| **Cancelar** | Mudar `status` para `cancelado`. O sistema nunca executa `DELETE`. | [09](09-REGRAS_DE_NEGOCIO.md) |
| **Ignorar em relatório** | Esconder das agregações sem apagar o Fato. Saída para “apagar” algo vindo do banco. | [09](09-REGRAS_DE_NEGOCIO.md) |
| **Sincronizar** | Trazer Fatos de uma instituição por uma Fonte Financeira. | [13](13-OPEN_FINANCE.md) |
| **Classificar** | Atribuir categoria, por regra, por IA ou pelo usuário. | [09](09-REGRAS_DE_NEGOCIO.md) |

## Infraestrutura e provedores

| Termo | Definição | Aprofunda em |
|---|---|---|
| **Provedor de IA** | Serviço de LLM. Groq é o padrão; Gemini, Ollama, OpenRouter e OpenAI são fallback. | [10](10-IA.md) |
| **Circuito aberto** | Estado em que um provedor é pausado após falhas seguidas. | [10](10-IA.md) |
| **Provedor de Open Finance** | Serviço de agregação bancária. Pluggy é o primeiro. Rótulo opaco para o Core. | [13](13-OPEN_FINANCE.md) |
| **Evolution API** | Transporte de WhatsApp. Cliente fino, sem domínio. | [12](12-WHATSAPP.md) |
