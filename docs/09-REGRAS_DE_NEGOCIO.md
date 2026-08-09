# 09 — Regras de negócio

Todas as regras que decidem o que acontece com os dados: as do motor financeiro e as da conversa. É o documento com maior risco de regressão — alterar algo aqui sem teste correspondente é a forma mais rápida de quebrar o produto.

**Este documento não cobre:** estrutura das tabelas — ver [07-MODELO_DE_DADOS.md](07-MODELO_DE_DADOS.md). Formato das intenções — ver [08-CONTRATOS.md](08-CONTRATOS.md). Como a mensagem chega até aqui — ver [10-IA.md](10-IA.md).

---

## 1. Regras do `MotorFinanceiro`

O motor é o único componente com autoridade sobre os dados. A IA propõe; o motor valida e decide ([ADR-002](adr/README.md)).

### 1.1 Cálculo de saldo

Lançamentos em `conta` com `status = 'realizado'` alteram imediatamente o `saldo_atual`. Lançamentos `previsto` não afetam saldo, apenas projeções futuras.

Direção do impacto por tipo:

- Somam: `receita`, `reembolso`, `estorno`, `aporte`
- Subtraem: `despesa`, `retirada`, `emprestimo`

A convenção assumida para `emprestimo` é dinheiro saindo da conta de quem empresta. É ajustável se o uso real mostrar o contrário.

Movimentos em `cartao` de crédito não alteram saldo de conta: comprometem limite e geram fatura.

### 1.2 Geração de parcelas

Ao receber um movimento parcelado, o motor cria o movimento pai e uma linha em `parcela` por parcela, dividindo o valor.

Quando é em cartão, o vencimento da primeira parcela respeita o `fechamento` e o `vencimento` do cartão, sendo `melhor_dia_compra` o dia seguinte ao fechamento.

Uma compra à vista não é parcelamento: só entra em visões de parcelamento quem tem duas ou mais parcelas.

### 1.3 Correção de lançamento

`corrigir_movimento` nunca sobrescreve sem rastro: grava `estado_anterior` e `estado_atual` em `auditoria`.

Se o valor de um movimento `realizado` associado a uma `conta` muda — não `cartao`, não `transferencia` — o saldo é ajustado atomicamente pela diferença: `saldo_atual += direção × (valor_novo − valor_antigo)`.

### 1.4 Auditoria e append-only

Toda inserção, alteração e cancelamento em `movimento` e `parcela` grava uma linha em `auditoria`.

Nenhuma rotina do sistema executa `DELETE`. Cancelar significa mudar `status` para `cancelado`.

### 1.5 Resolução de referências

O resolvedor traduz nomes em texto livre para identificadores reais:

- **Categoria e pessoa são criadas automaticamente** quando não existem. É o cadastro incremental: dá para lançar uma despesa sem a categoria existir.
- **Conta e cartão nunca são criados automaticamente.** Exigem dados que só o usuário pode fornecer (saldo inicial, limite, fechamento), então geram erro pedindo confirmação do nome.

Em consulta, o comportamento é diferente: nada é criado, e referência inexistente gera `ErroReferenciaNaoEncontrada` (HTTP 422), para não devolver resultado vazio enganoso.

---

## 2. Cruzamento pessoa física e pessoa jurídica

Não existe tabela `empresa`. O cruzamento é **apenas classificatório**, para relatório, e não gera lançamento de mútuo ou dívida.

A regra: comparar o `perfil` do movimento com o `perfil` da conta ou cartão usados. Quando divergem, é fluxo cruzado.

- “Quanto gastei de pessoal com dinheiro da empresa?” — soma de movimentos com `perfil = 'pf'` cuja conta ou cartão tem `perfil = 'pj'`.
- “Quanto a empresa gastou com meu cartão pessoal?” — soma de movimentos com `perfil = 'pj'` cujo cartão tem `perfil = 'pf'`.

Exemplos concretos:

- Pix de R$ 100 de churrasco para o Marcio na conta Mercado Pago da empresa: movimento `despesa` com `perfil = 'pf'`, conta com `perfil = 'pj'` — aparece como gasto pessoal pago pela empresa.
- Passagem de R$ 2.300 em 5x no cartão Nubank pessoal, mas da empresa: movimento `despesa` com `perfil = 'pj'`, cartão com `perfil = 'pf'` — aparece como gasto empresarial pago com cartão pessoal.

Não há coluna nem tabela para isso. É calculado na criação do movimento por `eh_fluxo_cruzado` e registrado como metadado dentro do `estado_atual` da linha de `auditoria`; os relatórios **recalculam** a regra em tempo de consulta, sem ler o metadado.

Ver [ADR-007](adr/README.md) e [ADR-008](adr/README.md).

---

## 3. Regras de lançamento por conversa

### 3.1 Mensagem vaga não é rejeição

“Fiz mercado”, sem valor, **não** é `NAO_RECONHECIDA`. Vira registro incompleto e o sistema pergunta o valor.

### 3.2 Descrição limpa

A `descricao` guarda apenas o bem, a marca ou o estabelecimento. Devem ser removidos:

- Vocativo do bot, incluindo as variações que o reconhecimento de áudio produz
- Forma de pagamento, que vai para o campo `forma_pagamento`
- Valor e a palavra “reais”
- Data
- Nome da conta ou do cartão
- Marcações de perfil como “uso pessoal”

### 3.3 Defaults de forma de pagamento

Existem para não perguntar o que pode ser inferido:

- Cadastro de cartão: sem conta vinculada é `credito`; com conta é `multiplo`; “cartão de débito” explícito é `debito` e exige conta.
- Lançamento no cartão: sem pista de débito, `forma_pagamento = credito`, sem perguntar. “No débito” exige conta vinculada, baixa saldo e não gera parcela nem compromete limite.
- Lançamento na conta: inferir `pix`, `transferencia`, `boleto` ou `dinheiro` quando a frase deixar claro; caso contrário `pix`. Nunca nulo e nunca perguntado.

### 3.4 Precedência de perfil

Texto da mensagem (“uso pessoal”, “da empresa”) vence o `perfil` da conta ou cartão, que vence o hábito ou padrão. Não perguntar: só quando ainda não há conta ou cartão resolvido **e** existe mistura PF/PJ sem padrão único.

### 3.5 Precedência de origem

Texto da mensagem vence o hábito (`cartao_principal`, `conta_principal`), que vence a única conta ou cartão cadastrado.

### 3.6 Duplicata

Lançamento idêntico já existente faz o sistema perguntar se deve registrar de novo, e a confirmação vem pelo campo `confirmado`.

### 3.7 Categorias de estabelecimento

Estabelecimentos conhecidos mapeiam para categorias reais: Uber para Transporte, iFood para Alimentação. **Não** criar categoria com o nome do estabelecimento.

---

## 4. Perguntas curtas: a UX do slot-filling

Uma pergunta por vez, sobre um campo só, em tom pessoal quando o nome do usuário é conhecido: `Deividy, qual é o valor?` ou `Em qual conta ou cartão?`.

Ordem das perguntas:

- Movimento: valor, depois conta ou cartão, depois perfil.
- Recorrência: valor, depois dia, depois descrição, depois conta ou cartão.
- Conta: nome, depois saldo, depois perfil.
- Cartão: nome, depois perfil, depois — se débito, a conta; se crédito, limite, fechamento e vencimento.

---

## 5. Consultas

### 5.1 Total ou detalhado

| Tipo de pergunta | Comportamento |
|---|---|
| “Quanto gastei…”, “total”, “resumo” | Só os totais, com a dica de dizer “detalhado” |
| “Extrato”, “liste”, “quais”, “mostra lançamentos” | Lista completa |
| Apenas “detalhado” no turno seguinte | Reusa filtros e período da última consulta de histórico |

O terceiro caso é uma regra de contexto: sem ela, “detalhado” perde a referência e falha.

### 5.2 Regra de agregação por tipo de visão

O período padrão só se aplica quando o filtro de período não é informado.

| Visão | Responde | Período padrão | Regra |
|---|---|---|---|
| `saldos` | “quanto tenho no total?” | não se aplica | Soma `saldo_atual` das contas ativas, filtrando por perfil ou nome quando informado |
| `cartoes` | “quanto ainda posso gastar?” | não se aplica | `disponivel = limite − comprometido`, onde comprometido é a soma das parcelas não canceladas do cartão |
| `parcelamentos` | “quanto falta pagar do notebook?” | não se aplica | Agrupa parcelas por movimento; entra quem tem 2 ou mais. Parcela com vencimento anterior a hoje conta como paga |
| `categoria` | “quanto gastei com alimentação?” | mês atual | Com categoria informada, soma do período; sem categoria, ranking das 5 maiores |
| `futuro` | “quanto tenho comprometido até dezembro?” | hoje até 31/12 do ano atual | Soma parcelas não canceladas e movimentos avulsos `previsto` no período |
| `fluxo` | “quanto gastei de pessoal com dinheiro da empresa?” | mês atual | Recalcula o fluxo cruzado e separa em duas somas |
| `evolucao` | “como estão minhas finanças nos últimos meses?” | últimos 6 meses | Agrupa receita e despesa por mês, preenchendo com zero os meses sem lançamento |
| `historico` | “extrato de agosto”, “lançamentos de hoje” | conforme a pergunta | Lista por dia com sinal, conta ou cartão e descrição; respeita `detalhado` e tem limite de itens |

Quando o histórico excede o limite de itens por página, a resposta oferece “mais” para paginar (e opcionalmente um período menor), em vez de truncar silenciosamente.

Regra de interpretação importante: sempre que a pergunta citar “pessoal”, “da empresa”, “PF” ou “PJ”, o filtro de perfil deve ser preenchido, mesmo que o tipo de visão pareça óbvio.

---

## 6. Corrigir e cancelar são coisas diferentes

Esta é a distinção mais crítica do produto conversacional. Confundi-las apaga dado que o usuário queria só ajustar.

| Frase do usuário | Comportamento |
|---|---|
| corrige, altera, muda, troca descrição ou valor | Correção com os campos novos. **Nunca** cancelar |
| apaga, exclui, cancela, deleta lançamento | `status = 'cancelado'`, com confirmação antes de efetivar |

### Desambiguação

Quando vários lançamentos combinam com a referência, o sistema lista numerado (1, 2, …), sem expor código na cópia.

- Lista de exclusão: “Qual deseja excluir?”, respondendo `1`, `2` ou `todos`
- Lista de correção: “Qual deseja corrigir?”, respondendo `1` ou `2` — e o efeito é **alterar**, não apagar

---

## 7. Recorrências

Recorrência é assinatura mensal, diferente de parcela de cartão.

- Padrão: mensal no `dia_do_mes`, entre 1 e 31. Exemplo: “Todo mês dia 10 Netflix 55,90 no Nubank”.
- Sem valor, o sistema pergunta `Qual é o valor?` em vez de falhar com “valor não informado”.
- Um cron diário materializa os lançamentos, e `ultima_geracao` garante que o mesmo mês não seja gerado duas vezes.

---

## 8. Orçamento

- Definir limite geral ou por categoria.
- Consultar status do orçamento.
- Após registrar uma despesa, a confirmação pode carregar um alerta de estouro.

---

## 9. Regras do Conhecimento

Estas regras entram com a arquitetura-alvo e governam a metade mutável da movimentação.

### 9.1 Ordem de classificação

1. Regra do workspace, se condições casarem — `ServicoConhecimento.aplicar_regras`. Avalia `condicoes` com lógica E/OU; aplica **todas** as ações da primeira regra que casa (categoria, beneficiário, tags/notas, ignorar, perfil legado). Sem prioridade numérica: especificidade da condição, depois `data_criacao` ASC.
2. IA, quando nenhuma regra casa — `ServicoConhecimento.aplicar_ia` via porta `SugeridorCategoria` (implementação `ClassificadorCategoria` em `modulos/ia`). Grava `classificado_por = ia` e `confianca_ia`. Só escolhe categoria da lista do workspace; não inventa. Fail-open: falha de LLM deixa “Não classificado”. Desligável com `CLASSIFICACAO_IA_HABILITADA=false`.
3. Usuário, sempre que quiser corrigir.

Após a ingestão de Open Finance e após criar movimento pelo chat **sem** categoria explícita do usuário, a API chama `classificar` (regra → IA) no composition root. Open Finance não importa Conhecimento nem IA. Checkbox “aplicar a existentes” reexecuta regras no histórico sem tocar em `classificado_por = usuario`.

### 9.2 Precedência

`classificado_por = 'usuario'` tem precedência: **uma regra nunca sobrescreve a classificação feita à mão pelo usuário.** Sem essa regra, o motor de regras desfaz o trabalho do usuário na próxima execução. Coberto por teste em `modulos/conhecimento`.

### 9.3 Aprendizado

Quando o usuário classifica algo manualmente, o assistente oferece transformar aquilo em regra, por exemplo `IFOOD → Restaurantes`. Se aceito, a regra passa a existir com origem `aprendizado_conversa`. O trecho é extraído da descrição/favorecido da instituição (ruído como PIX/PAG é ignorado). Se a mesma regra já existe, a oferta não aparece. É assim que o usuário ensina o sistema conversando.

### 9.4 Explicabilidade

A interface diz por que algo foi classificado: pela regra (`regra_id` + nome/trecho legível), por sugestão da IA com `confianca_ia`, ou porque o usuário ensinou em `classificado_em`. No extrato web isso aparece sob cada lançamento classificado.

---

## 10. Limites de escrita em conta sincronizada

Quando a conta ou o cartão está vinculado a uma conexão de Open Finance, o Fato é imutável ([ADR-009](adr/009-fato-vs-conhecimento.md), [ADR-012](adr/012-limites-de-escrita-da-ia.md)).

Permitido: enriquecer, ou seja, escrever categoria, pessoa, perfil, tags e observações; e propor regra.

Proibido: criar movimentação, alterar valor, data, conta ou descrição de origem, e excluir.

Quando o usuário pede algo proibido, a resposta é uma recusa explicada, não um erro técnico: *“Esse lançamento veio do banco. Posso classificar e complementar, mas não criar nem apagar.”*

Quando o usuário quer, na prática, tirar algo do relatório, a saída é `ignorado_em_relatorio`: esconde das agregações e preserva o Fato.

Em conta **não** sincronizada, tudo o que este documento descreve nas seções 1 a 8 continua valendo sem alteração.

Quem liga e desliga a marca é `MotorFinanceiro.definir_sincronizacao`, chamado pela associação de conta em [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md). Fica no Core, ao lado da regra que a lê, porque é a marca que decide o que o Core permite. Desligar devolve a conta ao uso manual, mas não reabre o que veio do banco: o critério abaixo tem duas pernas, e a primeira sobrevive à desconexão.

### 10.1 Onde a regra é aplicada

A checagem mora no `MotorFinanceiro`, não na montagem da resposta, e é por isso que vale para chat, WhatsApp, Web, recorrência e qualquer chamador futuro: uma política que vive só na borda protege apenas a borda que se lembrou dela. `ErroContaSincronizada` é o que o Core lança, e a mensagem já vem escrita para o usuário.

Duas condições independentes protegem o Fato, reunidas em `fato_protegido`:

1. A movimentação nasceu na instituição (`fonte = 'open_finance'`).
2. A conta ou o cartão onde ela vive é sincronizado — caso dos lançamentos manuais feitos **antes** de o banco ser conectado, que param de aceitar correção de Fato dali em diante.

Numa transferência basta uma das pontas ser sincronizada. Numa compra no débito, a conta vinculada manda: cartão livre ligado a conta sincronizada ainda duplicaria.

A conversa consulta `fato_protegido` **antes** de pedir confirmação de exclusão. Perguntar “tem certeza?” para em seguida recusar é pior do que recusar de saída.

### 10.2 As exceções do sistema

Duas operações precisam mexer em Fato protegido, e nenhuma delas é uma brecha: são operações do sistema, não do usuário, e cada uma entra por porta própria no Core. Nenhum caminho de usuário ganha permissão por causa delas.

**Alteração anunciada pela instituição.** O banco confirma uma pendente, ajusta um valor, reescreve uma descrição. `atualizar_fatos_da_fonte` aplica isso. Ela escreve exclusivamente campo de Fato: categoria, pessoa, tags, observações, `ignorado_em_relatorio` e a descrição que o usuário vê permanecem como estavam. O que a regra proíbe é o usuário reescrever o extrato; a instituição corrigindo o próprio extrato é outra coisa.

**Remoção anunciada pela instituição.** A transação foi desfeita — estorno, duplicata que o banco corrigiu, agendamento cancelado. `remover_fatos_da_fonte` marca `status_fonte = 'removido'`, cancela o movimento e devolve o saldo, sem apagar nada. Detalhe do porquê em [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md), seção 8.6.

As duas usam o escape hatch do trigger, e são as únicas que usam.

**Conciliação com o passado.** Casar um lançamento manual antigo com o Fato que chegou do banco exige cancelar o manual em conta já sincronizada. Porta: `MotorFinanceiro.cancelar_para_conciliacao`, orquestrada em `apps/api` após a ingestão.
