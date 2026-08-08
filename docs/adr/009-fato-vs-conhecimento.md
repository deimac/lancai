# ADR-009 — Fato Financeiro e Conhecimento do LançAI são separados

**Status:** aceito

## Contexto

O LançAI nasceu com o `movimento` totalmente editável: qualquer campo podia ser alterado por conversa, e a IA propunha correções sobre qualquer coisa. Isso funcionava porque toda movimentação era digitada pelo próprio usuário — não havia outra fonte de verdade com que conflitar.

Com Open Finance, passa a existir. Uma transação sincronizada representa o que a instituição financeira afirma ter acontecido. Se a IA puder alterar o valor, a data ou a conta desse registro, o extrato do LançAI deixa de bater com o extrato do banco, e o produto perde exatamente a propriedade que justifica conectar a conta.

Ao mesmo tempo, o banco nunca vai saber que aquele PIX foi pessoal, que o fornecedor é José Silva Marketing ou que a compra pertence ao projeto Itália. Esse conhecimento é o valor que o LançAI acrescenta e precisa ser livremente editável.

As duas metades têm, portanto, requisitos opostos de mutabilidade dentro do mesmo registro.

## Decisão

Todo `movimento` é composto por dois grupos de dados com regras distintas:

- **Fato Financeiro** — valor, data, conta ou cartão, descrição de origem, favorecido de origem, identificador da transação e status na fonte. **Imutável** quando `fonte = 'open_finance'`. Escrito somente pelo Core Financeiro, a partir de uma Fonte Financeira.
- **Conhecimento do LançAI** — categoria, pessoa, perfil, tags, observações, quem classificou, confiança da IA e marcação de ignorar em relatório. **Sempre mutável.** Escrito por usuário, regras ou IA.

A garantia é imposta em três camadas independentes:

1. Nomes de coluna agrupados por natureza.
2. APIs distintas: `CoreFinanceiro` não aceita categoria nem tag; `ServicoConhecimento` não aceita valor, data nem conta.
3. Trigger no Postgres que rejeita `UPDATE` em coluna de Fato quando a fonte é uma instituição.

## Alternativas consideradas

**Duas tabelas 1:1, uma de fato e uma de enriquecimento.** Recusada. Daria separação física, mas cobraria um join em todo relatório, listagem de extrato e consulta da IA. A garantia obtida seria equivalente à do trigger, que custa muito menos. A separação física parecia mais rigorosa e na prática só transferia o custo para todas as leituras.

**Apenas convenção de código, sem trigger.** Recusada. A invariante é um pilar do produto; depender de disciplina em revisão de PR significa que um dia ela quebra silenciosamente.

**Manter tudo editável e resolver conflito por regra de precedência.** Recusada. Torna impossível responder “este número veio do banco?”, que é a pergunta central de confiança.

## Consequências

- Um formulário no Web que faça `PUT` do movimento inteiro viola a invariante mesmo com o backend correto. A interface precisa oferecer campos de Conhecimento separadamente.
- Quando o usuário quer “apagar” um gasto vindo do banco, a saída é `ignorado_em_relatorio`, não exclusão.
- Estornos e correções feitos pela instituição chegam como Fato novo, vindo da fonte, e não como edição do Fato existente.
- O histórico de classificação usa a tabela `auditoria` que já existe, sem mecanismo próprio de versionamento.
- Exige teste de invariante, incluindo tentativa de escrita direta no banco para validar o trigger.

Ver [01-DOMINIO.md](../01-DOMINIO.md), [07-MODELO_DE_DADOS.md](../07-MODELO_DE_DADOS.md) e [08-CONTRATOS.md](../08-CONTRATOS.md).
