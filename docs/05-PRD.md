# 05 — PRD

O que o LançAI é como produto: para quem, contra qual problema, com quais capacidades e sob quais critérios de sucesso.

**Este documento não cobre:** como as capacidades são implementadas — ver [02-ARQUITETURA.md](02-ARQUITETURA.md). Quando cada uma é entregue — ver [06-ROADMAP.md](06-ROADMAP.md).

---

## 1. Problema

Existem duas categorias de solução e as duas falham:

- **Apps financeiros tradicionais** têm fricção alta. Muitos campos, muitas telas, e o usuário abandona depois de algumas semanas.
- **Apps de IA “simples”** registram gastos básicos, mas não sustentam controle financeiro completo: não lidam com cartão, parcelamento, PF e PJ misturados, nem com compromissos futuros.

E ambos ignoram um fato central: **o banco já sabe o que aconteceu.** Pedir que o usuário digite o que a instituição pode informar é retrabalho.

## 2. Proposta de valor

O LançAI centraliza todas as movimentações, independentemente da origem, e constrói uma camada de inteligência sobre elas.

Ele une a facilidade de conversar com a robustez de um sistema financeiro profissional, e resolve a parte que nenhuma automação resolve sozinha: **o significado**. O banco informa que saiu R$ 340 para um CNPJ; só o usuário sabe que era o marketing da empresa, cobrável do cliente, do projeto Itália.

O produto não é um controle financeiro. É uma **Plataforma de Inteligência Financeira**:

1. Centraliza movimentações de qualquer origem
2. Preserva o Fato Financeiro vindo da instituição como verdade imutável
3. Constrói Conhecimento sobre esses fatos
4. Aprende com a conversa e com as correções feitas na interface
5. Expõe essa inteligência por Web, WhatsApp e API

---

## 3. Público-alvo

Pessoas que precisam controlar, ao mesmo tempo, finanças pessoais, uma pequena empresa e trabalho autônomo — incluindo cartões pessoais e empresariais, pagamentos cruzados entre pessoa física e empresa, parcelamentos e compromissos futuros.

O conceito de workspace estende isso para famílias e sociedades: meu CPF, o CPF do sócio e o CNPJ compartilhando a mesma inteligência. Ver [01-DOMINIO.md](01-DOMINIO.md).

---

## 4. Capacidades por canal

### Open Finance
Traz o Fato automaticamente. É a principal fonte de movimentação para contas conectadas, e elimina a digitação.

### WhatsApp
Assistente financeiro: consulta, classifica, corrige categoria, complementa o que o banco não sabe, pede confirmação e envia alertas. Registra movimentação apenas em conta não conectada. Ver [12-WHATSAPP.md](12-WHATSAPP.md).

### Web
Cockpit: dashboard, contas, cartões, extrato, categorias, regras e conexão bancária, com o assistente de IA em painel lateral persistente. Ver [11-WEB.md](11-WEB.md).

### API
Integração como fonte `api`, pela mesma porta de qualquer outra fonte. Ver [08-CONTRATOS.md](08-CONTRATOS.md).

---

## 5. Princípios de produto

Estes princípios decidem discussões de UX quando há empate técnico:

1. O usuário conversa, nunca preenche formulário obrigatório.
2. Perguntas mínimas: só perguntar o que é estritamente necessário para fechar a operação.
3. Aproveitar contexto: buscar o hábito conhecido antes de perguntar.
4. Cadastro incremental: dá para lançar uma despesa sem a categoria existir.
5. Toda informação pode ser corrigida conversando.
6. Nada é excluído fisicamente.
7. Preferir perguntar a falhar com erro técnico.
8. O que veio do banco não muda porque a IA achou.

Os itens 1 a 7 vêm do produto original e continuam valendo. O item 8 é o que a Plataforma de Inteligência Financeira acrescenta.

---

## 6. Jornadas de referência

São a definição funcional do produto conversacional e servem como critério de aceite. Ver [14-TESTES.md](14-TESTES.md).

**J1 — Lançamento completo**
“gastei 45 no uber no nubank” resulta em despesa registrada, com categoria Transporte e confirmação em texto.

**J2 — Lançamento sem valor**
“gastei no uber no nubank” resulta na pergunta curta “Deividy, qual é o valor?”; a resposta “45” completa o registro.

**J3 — Total e depois detalhe**
“quanto gastei esse mês?” devolve os totais com a dica de dizer “detalhado”; “detalhado” devolve a mesma consulta com a lista de lançamentos, reusando o período anterior.

**J4 — Exclusão ambígua**
“apague o uber”, com dois candidatos, apresenta lista numerada; “1” cancela apenas o escolhido.

**J5 — Correção não é exclusão**
“corrige a descrição do tênis” apresenta lista de correção; “1” **altera**, não apaga.

**J6 — Recorrência incompleta**
“Todo mês dia 10 Netflix no Nubank” pergunta o valor; “55,90” cria a recorrência.

### Jornadas da arquitetura-alvo

**J7 — Enriquecimento de Fato sincronizado**
Sobre um PIX vindo do banco, “esse foi pessoal” altera apenas o Conhecimento, e o Fato permanece idêntico.

**J8 — Recusa em conta sincronizada**
“apaga esse pagamento” em conta conectada recebe recusa explicada e a oferta de ignorar no relatório.

**J9 — Aprendizado de regra**
Classificar manualmente um iFood como Restaurantes faz o assistente oferecer criar a regra; aceitar faz a próxima transação igual ser classificada sem chamar modelo.

---

## 7. Critérios de sucesso

- Um usuário consegue administrar toda a vida financeira, pessoal e empresarial, sem preencher formulário.
- Uma conta conectada não exige nenhuma digitação de lançamento.
- Uma transação recorrente conhecida é classificada sem chamar modelo de linguagem.
- O extrato do LançAI bate com o extrato do banco, sem duplicata.
- Uma correção do usuário nunca é desfeita pelo sistema.

---

## 8. TODO

Nunca foram discutidos e não devem ser inventados aqui:

- Métricas de produto e instrumentação
- Precificação e modelo de cobrança
- Onboarding comercial e aquisição
- Limites de uso por plano
- Política de suporte
