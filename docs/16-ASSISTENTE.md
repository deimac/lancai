# 16 — Assistente (web e WhatsApp)

Mapa operacional de ponta a ponta: como a mensagem entra, como vira intenção, o que a IA pode e não pode gravar, e como consultas, lançamentos e correções são executados.

**Este documento não cobre:** schema de tabelas — [07-MODELO_DE_DADOS.md](07-MODELO_DE_DADOS.md). Contratos Zod campo a campo — [08-CONTRATOS.md](08-CONTRATOS.md). Cálculo de saldo, parcelas e auditoria — [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md). Provedores LLM, circuit breaker e custo de token — [10-IA.md](10-IA.md). Grupos, Evolution e alertas proativos — [12-WHATSAPP.md](12-WHATSAPP.md). Ingestão bancária — [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).

---

## 1. O que o assistente é

Não é um chatbot genérico e não é um digitador de extrato. É a **borda conversacional** do Core Financeiro: interpreta português, monta uma intenção tipada e deixa o backend decidir.

Dois canais, **um único pipeline**:

| Canal | Entrada | Identidade | Sessão |
|---|---|---|---|
| Web | `POST /chat` `{ usuarioId, mensagem, sessaoId? }` | usuário autenticado | nova sessão se não vier `sessaoId` |
| WhatsApp | webhook Evolution `POST /api/webhooks/evolution` | `usuario.whatsapp_numero` (só dígitos) | reusa a sessão `ativa` |

Não existe Twilio nem Cloud API da Meta no produto. Transporte: `modulos/evolution`. Número não cadastrado: **silêncio**. Grupo: **nunca responde** (entrada e caminho de erro).

A IA **não escreve no banco**. Produz JSON de `IntencaoDetectada`. Quem grava é o `MotorFinanceiro` (Fato) e o `ServicoConhecimento` (enriquecimento). Trocar Groq por Gemini não muda regra financeira.

```text
[Web POST /chat] ──┐
                   ├──► processar_turno_conversa
[Evolution WA] ────┘         │
  áudio → STT                │
  foto/PDF → intencaoPrevia  │
                             ▼
              confirmações → atalhos → LLM
                             ▼
                    normalizadores
                             ▼
              montar_resposta_chat
                 ├─ ResolvedorIntencao (nomes → IDs)
                 ├─ MotorFinanceiro (Fato)
                 ├─ ServicoConhecimento
                 └─ ModuloRelatorios
                             ▼
                    texto → JSON HTTP | Evolution sendText
```

Arquivo-orquestrador: `apps/api/src/servicos/processar-turno-conversa.ts`.

---

## 2. Papéis no banco da conversa

Tabelas `sessao` e `chat`. Três papéis:

| Papel | Conteúdo |
|---|---|
| `usuario` | texto da mensagem (senha de cartão é redigida) |
| `ia` | JSON da intenção + coluna `intencao_detectada` |
| `sistema` | texto que o usuário lê |

Não há tabela de “onboarding pendente”. Slot-filling reconstrói o estado a cada turno a partir do histórico (até 8 mensagens `usuario`/`sistema`) e da última intenção `ia` com `SOLICITAR_INFORMACAO`.

Pendências reconhecidas: `CRIAR_CONTA`, `CRIAR_CARTAO`, `REGISTRAR_MOVIMENTO`, `CRIAR_RECORRENCIA`.

---

## 3. Um turno, na ordem exata

Cada passo existe para não chamar a LLM no meio de uma confirmação ou de um “45” de slot.

1. Obter ou criar sessão.
2. Montar contexto **antes** de gravar a mensagem atual (contas, cartões, categorias, pessoas, hábitos, histórico, pendência, `dataAtual`, nome).
3. Senha de cartão: se o histórico pediu senha e a mensagem parece senha → revelar plástico cifrado e sair.
4. Gravar mensagem `usuario`.
5. `menu` / `ajuda` → texto fixo e sair.
6. Confirmações, nesta ordem: virar regra → exclusão/desambiguação (`sim` / `não` / `1` / `2` / `todos`) → duplicata de lançamento.
7. Se a pendência é `CRIAR_RECORRENCIA`, forçar esqueleto de slot (não vai à LLM).
8. `intencaoPrevia` (comprovante de foto/PDF no WhatsApp).
9. Atalhos determinísticos, nesta ordem:
   1. “detalhado” após um total de histórico
   2. “mais” (paginação de extrato)
   3. orçamento
   4. recorrência (`todo mês`, `mensalmente`, `recorrente`, `assinatura` — **não** o adjetivo “mensal” no nome)
   5. enriquecimento (“não considera nos relatórios”, tag)
   6. correção / exclusão / **alterar data** (`corrige o almoço para 20`, `alterar data … para 15/08/2026`)
   7. consulta
   8. lançamento (`gastei 45 no uber no nubank`)
10. Se nada casou → `InterpretadorIntencoes`: classificar ramo → extrair JSON do schema daquele ramo.
11. Normalizadores: movimento → cadastro → recorrência → plásticos. Completam data/origem/forma/perfil ou viram `SOLICITAR_INFORMACAO`.
12. Se `CONSULTAR_VISAO`, aplicar escopo de fluxo: “gastei” → só despesas; “recebi” → só receitas.
13. Persistir intenção (`papel=ia`).
14. `montar_resposta_chat` executa. Erro de domínio vira texto amigável, não stack.
15. Persistir resposta (`papel=sistema`) e atualizar `dataAtualizacao` da sessão (WhatsApp continua a mesma conversa).

Dentro da LLM (`modulos/ia/src/interpretador-intencoes.ts`):

- Resposta curta de slot (≤ 40 caracteres, “sim”, “dia 10”) **pula** o classificador e força o ramo da pendência. Sem isso, “45” cairia em `outro`.
- Heurística: “fiz mercado”, “gastei no uber”, “foi no ifood” → ramo `registrar`.
- Heurística: “alterar/mudar data …” → ramo `corrigir` (mesmo se a descrição tiver “mensal”).
- Classificação tem cache curto (~45 s).

---

## 4. O que a IA pode gravar

Separação invariante ([ADR-009](adr/009-fato-vs-conhecimento.md), [ADR-012](adr/012-limites-de-escrita-da-ia.md)):

| | **Fato** | **Conhecimento** |
|---|---|---|
| Campos | valor, data, conta/cartão, descrição de origem | categoria, pessoa, perfil PF/PJ, tags, observações, `ignorado_em_relatorio` |
| Quem escreve | Core, a partir de uma fonte | usuário, regra, IA |
| Conta **não** sincronizada | criar, corrigir Fato, cancelar (com confirmação) | sempre |
| Conta ou cartão **sincronizado**, ou `fonte = open_finance` / `pdf` | **proibido** para o usuário | permitido |

`fato_protegido` = veio do banco **ou** vive em destino sincronizado (inclui lançamento manual feito **antes** de conectar o Open Finance).

### Permitido × proibido (conversa)

| Pedido | Destino manual | Destino Open Finance / PDF |
|---|---|---|
| “gastei 45 no uber” | cria movimento | recusa; espera o extrato e classifica |
| “corrige o almoço para 20” / “alterar data para 15/08” | altera Fato | recusa |
| “esse PIX foi pessoal” / “tag projeto Itália” | Conhecimento | Conhecimento |
| “não considera iFood nos relatórios” | `ignorado_em_relatorio` | idem (caminho quando não pode apagar) |
| “apaga o uber” | pede confirmação e cancela | recusa **antes** de perguntar |

Recusas são texto de produto, não erro técnico:

- Registrar em conta conectada: *“‘Nubank’ está conectada ao banco, então o lançamento vem de lá…”*
- Apagar Fato do banco: *“Esse lançamento veio do banco. Posso classificar e complementar, mas não criar nem apagar.”* — e oferece esconder dos totais.

A checagem mora no `MotorFinanceiro`, não só no chat: vale para web, WhatsApp, recorrência e qualquer chamador.

### O que nunca é automático

- **Conta e cartão** nunca são criados no lançamento. Falta origem → pergunta “Em qual conta ou cartão?”.
- **Categoria e pessoa** são criadas se o nome ainda não existir (cadastro incremental).
- Em **consulta**, referência inexistente falha (HTTP 422). Nada é criado para “completar” o relatório.

### Fontes

`open_finance` | `manual` | `whatsapp` | `api` | `recorrencia` | `ofx` | `csv` | `pdf`.

O turno conversacional hoje grava lançamentos com `fonte` default `manual` se o chamador não passar outra. O enum `whatsapp` existe e entra na conciliação com o banco; o webhook ainda não envia `fonte: "whatsapp"` (fica `manual`).

Nenhum `DELETE`. Cancelar = `status = cancelado` + linha em `auditoria`.

---

## 5. Intenções

Contrato: `pacotes/tipos/src/intencoes.ts`. A LLM só emite o JSON; o resolvedor troca nomes por IDs.

| Intenção | Faz | Notas |
|---|---|---|
| `REGISTRAR_MOVIMENTO` | Cria despesa/receita/transferência | Sem valor ainda é registro: pergunta o valor. Nunca `NAO_RECONHECIDA` para “fiz mercado” |
| `CONSULTAR_VISAO` | Relatório | Ver seção 7 |
| `CORRIGIR_MOVIMENTO` | Altera Fato e/ou Conhecimento, ou cancela | `referencia` por descrição, data, `#codigo` ou `indice` da lista. Alterar **nunca** seta `cancelado` |
| `CRIAR_CONTA` / `CRIAR_CARTAO` | Cadastro conversacional | Incompleto → slot |
| `CORRIGIR_CONTA` / `CORRIGIR_CARTAO` | Ajusta cadastro; exclusão lógica `ativo=false` | Confirmação para desativar |
| `CONSULTAR_DADOS_CARTAO` | Número/validade/CVV | Só depois da senha da conta LançAI |
| `DEFINIR_ORCAMENTO` / `CONSULTAR_ORCAMENTO` | Limite mensal | Geral ou por categoria |
| `CRIAR_RECORRENCIA` / `LISTAR` / `CANCELAR` | Assinatura mensal | `dia_do_mes` 1–31; cron materializa; ≠ parcela de cartão |
| `CRIAR_REGRA_APRENDIZADO` | “Virar regra?” após classificar | Só atalho; a LLM não emite |
| `SOLICITAR_INFORMACAO` | Uma pergunta | `dados_parciais` + `intencao_pendente` |
| `MENU` | Texto de ajuda | Só atalho |
| `MENSAGEM_INFO` | Abortar confirmação / orientar | Só atalho; nunca LLM |
| `NAO_RECONHECIDA` | Fora do domínio | Saudação, assunto genérico |

Corrigir ≠ cancelar é a distinção mais crítica. “Altera a data da tarifa mensal” é `CORRIGIR_MOVIMENTO`. “Todo mês Netflix 55” é `CRIAR_RECORRENCIA`. “Mensal” no **nome** do lançamento (tarifa mensal do cartão) **não** cria assinatura.

---

## 6. Lançamentos

### 6.1 Como a frase vira movimento

1. Atalho se a frase for completa (`gastei 45 no uber no nubank dia 10`), senão LLM no ramo `registrar`.
2. Normalizador preenche o que faltou ou pergunta **um** campo por vez: valor → conta/cartão → perfil (só se ainda não houver origem e existir mistura PF/PJ).
3. Resolvedor troca nomes por IDs; cria categoria/pessoa se preciso; **não** cria conta/cartão.
4. Motor grava movimento `realizado`, ajusta saldo (conta) ou limite (crédito), gera parcelas se houver.

### 6.2 Defaults (não perguntar o óbvio)

| Campo | Default |
|---|---|
| Data | `dataAtual`; “hoje” / “ontem” / “dia 10” / `15/08/2026` |
| Cartão sem “débito” | `forma_pagamento = credito` |
| Conta sem forma explícita | `pix` (nunca nulo) |
| Origem | texto da mensagem → hábito `cartao_principal`/`conta_principal` → única conta/cartão |
| Perfil | texto (“uso pessoal”, “da empresa”) → perfil da origem → padrão |
| Descrição | só bem / marca / estabelecimento. Fora: vocativo do bot, Pix, valor, “reais”, data, nome da conta, “uso pessoal” |

Estabelecimentos conhecidos: Uber → Transporte, iFood → Alimentação. **Não** criar categoria “Uber”.

### 6.3 Cartão

- Crédito: compromete limite, não mexe saldo de conta; parcelas usam fechamento/vencimento.
- Débito: exige conta vinculada, baixa saldo, não parcela nem compromete limite.
- Duplicata idêntica (valor + data + descrição + origem): pergunta; só grava de novo com `confirmado=true`.

### 6.4 Mensagem vaga

“Fiz mercado” **não** é rejeição. Vira `SOLICITAR_INFORMACAO` pedindo o valor.

---

## 7. Consultas

`CONSULTAR_VISAO` + `tipo_visao` + filtros (`categoria_nome`, `descricao`, `conta_nome`, `cartao_nome`, `pessoa_nome`, `perfil`, `periodo {de,ate}`, `tipos[]`).

| Visão | Pergunta típica | Período padrão |
|---|---|---|
| `saldos` | quanto tenho no total? | — (soma `saldo_atual`) |
| `cartoes` | quanto ainda posso gastar? | — (`limite − comprometido`) |
| `parcelamentos` | quanto falta do notebook? | — (≥ 2 parcelas) |
| `categoria` | quanto gastei com alimentação? | mês atual; sem categoria = top 5 |
| `futuro` | quanto está comprometido? | hoje → 31/12 |
| `fluxo` | gastei pessoal com dinheiro da empresa? | mês atual (cruzamento PF/PJ) |
| `evolucao` | como estão os últimos meses? | 6 meses |
| `historico` | extrato / liste / quais | conforme a pergunta |

“Quanto gastei…” → totais + dica de “detalhado”. “Extrato / liste / mostra lançamentos” → lista. Só “detalhado” no turno seguinte reusa filtros. Lista longa: “mais” avança `deslocamento` (não trunca em silêncio).

Sempre que a pergunta citar pessoal / empresa / PF / PJ, o filtro de perfil é preenchido.

Execução: `ResolvedorIntencao.resolver_consultar_visao` → `ModuloRelatorios.consultar_visao` → `montar_resposta_visao`. Módulo devolve dados; API formata texto.

---

## 8. Correções

Busca por descrição e/ou data e/ou código curto (`#a1b2c3d4`). Vários candidatos → lista numerada, sem expor UUID na cópia.

| Frase | Efeito |
|---|---|
| corrige / altera / muda valor, descrição, **data** | `campos_alterados`; não cancela |
| “alterar data de lançamento do cartão X Tarifa mensal para 15/08/2026” | atalho sem LLM; a data depois de “para” é o **novo** valor, não o filtro de busca |
| “não considera iFood nos relatórios” | `ignorado_em_relatorio` |
| “tag projeto Itália no ifood” | `tags` |
| apaga / exclui / cancela | `status=cancelado` **depois** de confirmar; protegidos recusam antes de perguntar |

`15/08/20026` (zero extra) é lido como `2026-08-15`.

Resposta `1` / `2` escolhe o item; `todos` só na exclusão em lote.

---

## 9. Recorrência, orçamento, cadastro

**Recorrência** é assinatura mensal, não parcela. Exemplo que cria: “Todo mês dia 10 Netflix 55 no Nubank”. Slot: valor → dia → descrição → conta/cartão. “hoje” no dia = dia do calendário de `dataAtual`. Cron diário materializa; `ultima_geracao` impede duplicar o mês.

**Orçamento:** definir/consultar limite geral ou por categoria. Estouro pode ir na confirmação de despesa e, após Open Finance, no WhatsApp.

**Cadastro:** criar/corrigir conta e cartão na conversa. Cartão: crédito / múltiplo / débito. Plástico cifrado; ver dados exige senha.

Uma pergunta por vez, pessoal se o nome for conhecido: `Deividy, qual é o valor?`

---

## 10. Classificação depois de gravar

Ordem no Conhecimento:

1. Regra do usuário (se casar).
2. IA de categoria (`ClassificadorCategoria`), só nomes da lista; falha deixa “Não classificado”.
3. Usuário, sempre que quiser corrigir. `classificado_por = usuario` **não** é sobrescrito por regra.

Depois de classificar à mão, o assistente pode perguntar se vira regra (`IFOOD → Alimentação`).

---

## 11. WhatsApp — o que muda em relação ao web

O turno é o mesmo. O canal acrescenta:

| Tema | Comportamento |
|---|---|
| Identidade | `whatsapp_numero` único; não autorizado = silêncio |
| Sessão | sempre a ativa |
| Áudio | Groq STT → texto no turno (descrição precisa tolerar distorção) |
| Foto / PDF | visão extrai comprovante → `intencaoPrevia` de registro |
| Grupos | bloqueio na entrada **e** no aviso de falha |
| Listas | numeradas (`1.`, `2.`) pensadas para responder com um dígito |
| Proativo | alerta de orçamento pós-OF; cron de resumo de baixa confiança |

Com Open Finance o WhatsApp deixa de ser o lugar de **digitar o extrato** e passa a ser o lugar de **consultar, classificar e complementar**. Conta que nunca conectou banco continua registrando como sempre.

Detalhe de transporte e alertas: [12-WHATSAPP.md](12-WHATSAPP.md).

---

## 12. Ramos da LLM (quando o atalho não basta)

| Ramo | Intenções |
|---|---|
| `registrar` | `REGISTRAR_MOVIMENTO`, slot, `NAO_RECONHECIDA` |
| `consultar` | visões, dados do cartão, orçamento, listar recorrências |
| `corrigir` | movimento / conta / cartão |
| `cadastro` | criar/corrigir conta e cartão |
| `orcamento` | definir / consultar |
| `recorrencia` | criar / listar / cancelar |
| `outro` | só `NAO_RECONHECIDA` |

Prompts em `modulos/ia/src/prompt.ts` (Groq/Gemini) e `prompt-ollama.ts` (modelo 3B, JSON frágil). Regras que o modelo recebe, em resumo:

- Descrição limpa; Pix vai em `forma_pagamento`.
- Corrigir ≠ excluir.
- Alterar data de lançamento = `CORRIGIR_MOVIMENTO`, não recorrência.
- “Mensal” no nome da tarifa não cria assinatura.
- Não inventar conta, cartão nem valor.

---

## 13. Arquivos-chave

| Estágio | Onde |
|---|---|
| Web | `apps/web/src/componentes/JanelaChat.tsx`, `apps/api/src/rotas/chat.ts` |
| WhatsApp | `rotas/webhooks-evolution.ts`, `servicos/processar-mensagem-whatsapp.ts`, `processar-midia-whatsapp.ts`, `modulos/evolution/` |
| Turno | `apps/api/src/servicos/processar-turno-conversa.ts` |
| Confirmações | `interpretar-confirmacao-{exclusao,duplicata,regra,senha-cartao}.ts` |
| Atalhos | `modulos/ia/src/interpretar-{lancamento,consulta,correcao,enriquecimento}-*.ts`, `apps/api/.../interpretar-orcamento-recorrencia-rapido.ts` |
| LLM | `interpretador-intencoes.ts`, `ramos-intencao.ts`, `prompt.ts` |
| Normalizadores | `normalizar-intencao-{movimento,cadastro,recorrencia,plasticos}.ts` |
| Execução | `montar-resposta-chat.ts`, `resolvedor-intencao.ts` |
| Core | `modulos/financeiro/src/motor-financeiro.ts`, `modulos/conhecimento/`, `modulos/relatorios/` |
| Contratos | `pacotes/tipos/src/intencoes.ts`, `fonte.ts` |

---

## 14. Como acionar outro agente sobre isto

> Leia `docs/16-ASSISTENTE.md`, depois `09`, `08` e `10` se for mudar regra, contrato ou provedor.
> Proposta: [X].
> Não quebre Fato sincronizado (ADR-012) nem “corrigir ≠ cancelar”.
> Entregue o menor diff com testes no atalho/normalizador correspondente.
