# 01 — Domínio

A linguagem do negócio do LançAI: quais entidades existem, o que cada uma significa e como nomear qualquer coisa no projeto.

**Este documento não cobre:** estrutura física das tabelas, tipos de coluna e migrações — ver [07-MODELO_DE_DADOS.md](07-MODELO_DE_DADOS.md). Fórmulas e regras de cálculo, incluindo o cruzamento PF/PJ — ver [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md). Definições de uma linha para consulta rápida — ver [04-GLOSSARIO.md](04-GLOSSARIO.md).

---

## 1. Os dois conceitos centrais

Toda movimentação no LançAI é composta por duas metades com regras opostas. Essa é a distinção mais importante do domínio.

### Fato Financeiro

É o que a instituição financeira informou. Responde “o que aconteceu”.

Compõem o Fato: valor, data da movimentação, conta ou cartão, descrição original, favorecido original, identificador da transação na instituição e status na fonte.

Quando a origem é uma instituição financeira, o Fato é **imutável**. Ninguém — nem a IA, nem o WhatsApp, nem a interface Web — cria, altera ou exclui um Fato sincronizado. Ele só é escrito pelo Core Financeiro, a partir de uma Fonte Financeira.

### Conhecimento do LançAI

É o que o LançAI ou o usuário sabe *sobre* aquele Fato. Responde “o que aquilo significa”.

Compõem o Conhecimento: categoria, pessoa relacionada, perfil (PF/PJ), tags, observações, quem classificou, confiança da IA e a marcação de ignorar em relatório.

O Conhecimento é **sempre mutável**. É a única coisa que a IA e o WhatsApp podem escrever quando a conta é sincronizada. O verbo para essa escrita é **enriquecer**.

> O banco fornece o fato. O LançAI fornece o significado. É essa separação que torna o produto confiável: o extrato nunca muda porque a IA achou algo.

---

## 2. Fonte Financeira

Toda movimentação entra no sistema por uma **Fonte Financeira**. Uma fonte é uma origem de dados, não um canal de interface.

Fontes previstas: Open Finance, lançamento manual, WhatsApp, API, recorrência e, no futuro, OFX, CSV e PDF.

Duas consequências de domínio:

1. Todas as fontes produzem exatamente o mesmo objeto interno. O Core Financeiro nunca sabe de onde a movimentação veio nem qual provedor a trouxe.
2. **Open Finance é apenas uma fonte**, nunca o centro do sistema. Trocar de provedor não deve tocar em nada além do módulo de Open Finance.

---

## 3. Conta sincronizada

Uma conta ou cartão é **sincronizado** quando está vinculado a uma conexão de Open Finance.

Essa é a única propriedade que muda o comportamento do assistente conversacional:

- Conta sincronizada: o WhatsApp e a IA apenas enriquecem. Não registram, não corrigem valor, não excluem.
- Conta não sincronizada: o registro por conversa funciona normalmente, como sempre funcionou.

---

## 4. Workspace

Um **workspace** é o escopo que agrupa usuários, contas, cartões, movimentações e todo o conhecimento aprendido.

Ele existe para que múltiplos contextos compartilhem a mesma inteligência: meu CPF, o CPF do sócio e o CNPJ da empresa no mesmo workspace, com as mesmas regras, a mesma memória e o mesmo assistente.

Papéis de membro: `dono`, `editor` e `leitor`.

Até a fase F6 existe um workspace criado automaticamente por usuário, sem interface de convite. O escopo, porém, já existe nos dados desde a primeira migração (ver [ADR-013](adr/013-workspace-id-desde-a-primeira-migracao.md)).

---

## 5. Entidades

### `usuario`
Pessoa que acessa o sistema. O identificador é o mesmo UUID do `auth.users.id` do Supabase, sem tabela de vínculo.

### `conta`
Local com saldo disponível: Nubank, Caixa, Carteira. Nunca “account”. Tem `perfil` e pode ser sincronizada.

### `cartao`
Cartão de pagamento, com `modalidade`: `credito`, `debito` ou `multiplo`. Crédito usa limite e fatura; débito baixa o saldo da conta vinculada. Sem conta vinculada é crédito; com conta vinculada é múltiplo por padrão.

### `categoria`
Classificação da movimentação: Alimentação, Combustível, Transporte. Pertence ao Conhecimento, não ao Fato.

### `pessoa`
Cliente, fornecedor, sócio, funcionário ou familiar ligado a uma movimentação.

### `movimento`
Qualquer evento financeiro. Nunca “transação”. É a entidade que carrega as duas metades: as colunas de Fato e as colunas de Conhecimento.

### `parcela`
Desdobramento de um movimento parcelado. Cada parcela tem número, valor e vencimento projetado.

### `orcamento`
Limite de gasto, geral ou por categoria.

### `memoria`
Hábitos e preferências aprendidos do usuário (chave/valor). Vive no módulo `conhecimento`. Pertence ao sistema, nunca ao contexto volátil da IA.

### `regra`
Condição simples que resulta em uma ação de classificação, como “descrição contém IFOOD” resultando em “categoria Restaurantes”. Origem `manual` ou `aprendizado_conversa`.

### `auditoria`
Registro imutável de alterações, com estado anterior e estado atual.

### `sessao` e `chat`
Sessão de conversa e as mensagens trocadas dentro dela, incluindo a intenção detectada em cada turno.

### Entidades do módulo de Open Finance
Conexão com o provedor e mapa de contas externas. Vivem dentro do módulo e não vazam para o Core — ver [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).

---

## 6. `perfil`: pessoa física e pessoa jurídica

**Não existe tabela `empresa`.** A separação entre finanças pessoais e empresariais é feita inteiramente pelo campo `perfil`, com valores `pf` e `pj`, presente em `conta`, `cartao` e `movimento`.

A consequência de domínio é que um gasto pessoal pode ser pago por uma conta da empresa e vice-versa: o `perfil` do movimento e o `perfil` da conta ou cartão usados são independentes. Quando divergem, existe um **fluxo cruzado**.

O cruzamento é apenas classificatório, para fins de relatório. Ele não gera lançamento de mútuo ou dívida entre pessoa física e empresa. A regra de cálculo está em [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md).

Ver [ADR-007](adr/README.md) e [ADR-008](adr/README.md).

---

## 7. Padrão de nomes

**Regra crítica:** é proibido misturar inglês e português em qualquer nome técnico — tabelas, colunas, classes, funções, rotas de API e nomes de arquivo. Tudo em português. Ver [ADR-001](adr/README.md).

### Convenção de caixa

- Classes e entidades: `PascalCase` — `Movimento`, `Conta`, `MotorFinanceiro`, `InterpretadorIntencoes`, `OrquestradorIA`.
- Funções e métodos: `snake_case` iniciando por verbo — `criar_movimento()`, `calcular_saldo()`, `interpretar_mensagem()`.
- Variáveis e colunas do banco: `snake_case`.
- Tabelas: singular, minúsculo, `snake_case`.

### Campos padrão

`id`, `nome`, `descricao`, `valor`, `saldo`, `saldo_inicial`, `saldo_atual`, `tipo`, `status`, `perfil`, `modalidade`, `forma_pagamento`, `ativo`, `categoria_id`, `cartao_id`, `conta_id`, `usuario_id`, `pessoa_id`, `workspace_id`, `data_movimento`, `data_lancamento`, `data_criacao`, `data_atualizacao`, `criado_por`, `alterado_por`.

### Anglicismos aceitos

Termos que já se consolidaram como vocabulário de domínio e permanecem em inglês: `chat`, `status`, `pix`, `workspace`, `tags`.

---

## 8. Vocabulário de ação

Verbos com significado técnico preciso. Usar o verbo errado em um PR ou em uma issue muda o que se está pedindo.

- **Registrar** — criar um Fato novo. Só possível em conta não sincronizada ou via Fonte Financeira.
- **Enriquecer** — escrever Conhecimento sobre um Fato existente. Sempre permitido.
- **Corrigir** — alterar campos de um Fato mutável. Nunca cancela.
- **Cancelar** — mudar `status` para `cancelado`. O sistema é append-only e nunca executa `DELETE`.
- **Ignorar em relatório** — esconder uma movimentação das agregações sem apagar o Fato. É a saída para quando o usuário quer “apagar” algo que veio do banco.
- **Sincronizar** — trazer Fatos de uma instituição por uma Fonte Financeira.
- **Classificar** — atribuir categoria, seja por regra, por IA ou pelo usuário.
