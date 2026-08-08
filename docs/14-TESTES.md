# 14 — Testes

Como o projeto é testado, como rodar os testes sem tropeçar, e quais comportamentos são obrigatórios cobrir.

**Este documento não cobre:** as regras em si — ver [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md). As jornadas como definição de produto — ver [05-PRD.md](05-PRD.md).

---

## 1. Ferramenta e organização

Vitest, com os testes vivendo em `__testes__` dentro do `src` de cada pacote, distribuídos em oito pacotes:

```text
apps/api/src/__testes__/
modulos/conhecimento/src/__testes__/
modulos/financeiro/src/__testes__/
modulos/ia/src/__testes__/
modulos/conhecimento/src/__testes__/
modulos/open-finance/src/__testes__/
modulos/relatorios/src/__testes__/
pacotes/tipos/src/__testes__/
```

O peso está concentrado onde deve: no motor financeiro e no pipeline de interpretação.

---

## 2. Como rodar

**Rodar sempre de dentro do pacote, nunca da raiz do monorepo.**

```bash
cd modulos/ia && pnpm exec vitest run
cd apps/api && pnpm exec vitest run
```

As invariantes que só o banco pode provar — o trigger de imutabilidade e o índice de deduplicação — ficam num verificador separado, porque exigem conexão real:

```bash
pnpm --filter @lancai/banco verificar:trigger
```

Ele roda tudo dentro de uma transação que sempre termina em `ROLLBACK`: nada que cria sobrevive, e pode ser rodado contra qualquer ambiente sem sujar dados.

Executar `pnpm exec vitest run` na raiz falha com `ENAMETOOLONG`: o caminho do cache do pnpm store é longo o suficiente para estourar o limite do sistema de arquivos quando somado aos caminhos dos arquivos de teste. Rodar de dentro de cada pacote encurta os caminhos e resolve.

Isso não é um bug do projeto nem do Vitest, e já custou tempo mais de uma vez. É a razão pela qual esta seção existe.

---

## 3. O que é obrigatório testar

### Motor financeiro
Cálculo de saldo por tipo de movimento, geração de parcelas com vencimento correto conforme fechamento e vencimento do cartão, ajuste atômico de saldo na correção de valor, escrita em `auditoria` e ausência de `DELETE`.

### Pipeline de interpretação
Cada atalho determinístico precisa de teste unitário, incluindo os casos que ele **não** deve reconhecer — um atalho que reconhece demais é pior que um atalho que reconhece de menos, porque erra silenciosamente.

Cada normalizador precisa de teste do merge de dados parciais e da conversão de intenção incompleta em pergunta.

### Contratos
Os schemas Zod de `pacotes/tipos` precisam de teste para as entradas malformadas que modelos de linguagem realmente produzem, incluindo número degenerado e campo que vem como número quando deveria ser texto.

---

## 4. Casos de aceite do motor

Vindos da especificação original e ainda válidos:

1. “Gastei R$ 45 no almoço hoje” cria despesa, busca na memória a conta ou cartão mais provável para “almoço” e usa a categoria Alimentação.
2. “Recebi R$ 5.000 do cliente XPTO” cria receita, associa a pessoa criando-a se não existir, e atualiza o saldo.
3. “Comprei uma TV de R$ 3.000 parcelada em 10x no Inter” cria o movimento pai e dez parcelas com datas futuras.
4. “Quanto eu gastei com mercado este mês?” consulta por categoria e período atual, com resposta formatada.
5. “Pix de R$ 100 de churrasco pro Marcio na conta Mercado Pago (PJ)” registra movimento com perfil `pf` em conta `pj`, e aparece no fluxo cruzado.
6. “Corrige o combustível de ontem para R$ 210” gera nova linha de auditoria preservando o valor anterior.

---

## 5. Regressão conversacional

As jornadas J1 a J9 de [05-PRD.md](05-PRD.md) são o conjunto mínimo de regressão. Qualquer alteração no pipeline de linguagem natural deve declarar o impacto sobre elas.

As três mais frágeis, por experiência:

- **J3**, porque depende de reusar o contexto da consulta anterior. Já quebrou: “detalhado” sozinho perdia o período e falhava.
- **J5**, porque confundir correção com exclusão apaga dado que o usuário só queria ajustar.
- **J6**, porque exige slot-filling com merge correto dos dados parciais, que é o gap número 1 do backlog.

---

## 6. Testes de invariante da arquitetura-alvo

Estes testes existem para proteger decisões, não funcionalidades. São o que impede a arquitetura de degradar sem ninguém perceber.

1. **Fato imutável.** Tentar alterar valor, data, conta ou descrição de origem de um movimento com fonte `open_finance` deve falhar. Coberto nas duas camadas: `modulos/financeiro` recusa por `ErroFatoImutavel` antes de chegar ao banco, e o verificador de trigger prova que o banco recusa mesmo que alguém contorne o Core.
2. **Separação de API.** O tipo de entrada do Core não aceita categoria nem tag; o de Conhecimento não aceita valor nem data. Garantido em tempo de compilação pela assinatura de `corrigir_fato_manual` e `ServicoConhecimento.atualizar`, e verificado em runtime nos testes de `separar_correcao_por_grupo`.
3. **Precedência do usuário.** Aplicar regras sobre um movimento com `classificado_por = 'usuario'` não altera a classificação. **Coberto** em `modulos/conhecimento`: o teste monta a regra IFOOD, marca o movimento como classificação do usuário e prova que nada muda — nem categoria, nem auditoria.
4. **Deduplicação.** Sincronizar duas vezes o mesmo `id_externo` não cria dois Fatos. Coberto no Core (`ingerir_eventos` idempotente, sem aplicar o saldo duas vezes) e no banco (índice único parcial).
5. **Conhecimento sempre editável.** O espelho do item 1, e igualmente importante: renomear, recategorizar ou esconder do relatório uma movimentação vinda do banco deve funcionar, preservando `descricao_fonte`. Coberto em `modulos/conhecimento` e no verificador de trigger.
6. **Recusa em conta sincronizada.** Uma intenção de registro ou exclusão sobre conta sincronizada devolve recusa explicada, não erro técnico nem sucesso silencioso. Coberto: o Core recusa nos quatro caminhos de criação e na correção de Fato, e a conversa recusa a exclusão antes de pedir confirmação.
7. **Isolamento do provedor.** Nenhum código fora de `modulos/open-finance` usa o nome do provedor. **Coberto** por `isolamento-do-provedor.test.ts`, que varre o monorepo e falha apontando o arquivo infrator. Vale também para o frontend: o widget mora em `@lancai/open-finance/web`, e o `apps/web` só chama pelo identificador opaco que a API devolveu.

   O teste ignora comentário de propósito: a regra protege dependência de código, e explicar em comentário que `provedor` é rótulo opaco de um provedor concreto é útil — proibir isso seria proibir explicar a própria regra. Ele **não** ignora fixture de teste, e a primeira execução encontrou duas: um fixture do módulo `conhecimento` e o verificador de trigger, ambos com o nome do provedor escrito à mão. Passaram a usar rótulo neutro, que prova a mesma coisa sem criar dívida.

8. **Ingestão idempotente por evento.** A retentativa do mesmo webhook não processa duas vezes, e a chave é o registro do evento antes de qualquer trabalho. Coberto em `modulos/open-finance`: a prova é que o provedor não é consultado outra vez, não apenas que o total de movimentações não mudou.
9. **Alteração da fonte não come o Conhecimento.** Quando a instituição corrige uma transação, o Fato é reescrito e categoria, pessoa, tags, observações, `ignorado_em_relatorio` e a descrição do usuário continuam de pé. É o Pilar 1 no caso em que ele é mais fácil de violar sem perceber, e o teste em `modulos/financeiro` monta o cenário completo: ingere, deixa o Conhecimento gravar por cima, e só então aplica a alteração.

    No mesmo conjunto: Fato idêntico não escreve auditoria, movimento cancelado não ressuscita por anúncio da fonte, e o saldo acompanha a pendente que vira confirmada.

    O parcelamento informado pelo cartão é Fato, e as quatro colunas entraram na lista que o trigger protege. O verificador de trigger tem caso para duas delas — coluna de Fato esquecida nessa lista fica silenciosamente editável, e é o tipo de descuido que não deve depender de alguém lembrar.

    A remoção anunciada pela fonte tem a sua própria trava, e o que ela protege é o saldo. O provedor retenta até nove vezes, então o teste prova que reprocessar não devolve o saldo duas vezes, que movimento já cancelado não devolve saldo de novo, e que previsto removido não mexe em saldo nenhum. Nenhum desses três é visível olhando o `status` do movimento — só o número da conta denuncia.
10. **Associar não é meia-associação.** Associar a uma conta local que não existe, ou a conta e cartão ao mesmo tempo, não pode deixar a conta marcada como sincronizada sem o mapa gravado — nem o contrário. Coberto em `modulos/open-finance`: o Core valida e marca antes de o mapa ser escrito, então a falha acontece com tudo intacto.

    O caso simétrico também está coberto: associar fecha a conta para lançamento manual, e o teste prova isso chamando `criar_movimento` de verdade, não conferindo a coluna. É o efeito que a tela precisa avisar, e conferir a coluna provaria só que a coluna mudou.

Sobre o dublê de provedor: ele existe em `src`, não só nos testes, e o formato de webhook dele é deliberadamente diferente do de qualquer provedor real. Um teste que passa no dublê prova que **o serviço de ingestão** está certo — não que o adaptador está. Essa distinção é o que evita a falsa sensação de cobertura.

O adaptador real tem testes próprios, com um dublê no nível do HTTP. Eles provam autenticação, montagem de URL e tradução de formato, e os corpos usados vêm da documentação oficial do provedor, não de invenção. Ainda assim, provam o formato que o provedor **documenta**, não o que ele devolve: só rodar contra o ambiente de teste dele fecha essa distância, e até lá vale tratar o adaptador como não verificado.

O caso mais valioso desse conjunto é o de coleta por identificador. O provedor exige a conta na busca, e o webhook de alteração informa só a conexão; o teste fixa que o adaptador varre todas as contas, porque o atalho de consultar uma só perderia em silêncio a transação que vive na outra.

---

## 7. TODO

- Teste de contrato do **adaptador** de Open Finance, contra payload real capturado do provedor. O dublê não substitui isto: por desenho ele não imita o provedor
- Teste end-to-end do Web
- Definir se há cobertura mínima exigida e em quais pacotes
- Testes de integração com banco real versus dublê de repositório: hoje a escolha é caso a caso, sem regra escrita
