# 12 — WhatsApp

O WhatsApp é o **assistente financeiro** do LançAI, não um formulário disfarçado nem um digitador de extrato.

**Este documento não cobre:** o mapa ponta a ponta do assistente — ver [16-ASSISTENTE.md](16-ASSISTENTE.md). O pipeline de interpretação e os provedores — ver [10-IA.md](10-IA.md). As regras de negócio da conversa — ver [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md).

---

## 1. O papel do canal

Historicamente o WhatsApp era o principal meio de registrar movimentação. Com Open Finance, esse papel muda: quando o banco já informa o Fato, digitar de novo é retrabalho e fonte de duplicata.

O que o assistente faz, sempre:

- Responde consultas financeiras
- Classifica e corrige categorias
- Complementa informações que o banco nunca terá
- Pede confirmação quando há ambiguidade
- Envia alertas e resumos

O que ele faz apenas quando a conta **não** é sincronizada:

- Registra receita, despesa e transferência
- Corrige valor, data e descrição
- Cancela lançamento

A propriedade que decide é a flag `sincronizada` da conta ou do cartão. Não é uma configuração global e não é uma escolha do usuário no momento da mensagem: é uma consequência de ter conectado aquela conta ao Open Finance.

---

## 2. Integração com a Evolution API

`modulos/evolution` é um cliente fino: envia e recebe mensagem, sem nenhuma regra de domínio.

Fluxo de entrada:

1. A Evolution chama o webhook em `apps/api/src/rotas/webhooks-evolution.ts`.
2. O evento bruto é gravado em `evolution_evento`, sem o campo de credencial, para depuração e idempotência.
3. O usuário é identificado por `whatsapp_numero`, que é único e armazenado apenas com dígitos.
4. A sessão ativa é reusada, o que dá continuidade ao slot-filling entre mensagens.
5. O turno segue exatamente o mesmo caminho do chat HTTP.

O canal não tem pipeline próprio. Qualquer melhoria na interpretação beneficia os dois canais ao mesmo tempo.

---

## 3. Grupos: bloqueio em dois pontos

O número conectado à Evolution normalmente participa de grupos. O bot **nunca** deve responder em grupo, e a verificação acontece em dois lugares independentes:

1. **Na entrada do webhook**, verificando se o identificador da conversa é de grupo antes de qualquer processamento.
2. **No aviso de falha**, porque a primeira barreira não protegia o caminho de erro: uma mensagem de falha ainda podia ser enviada ao grupo.

O segundo ponto existe por causa de um incidente real. Manter apenas a verificação da entrada não é suficiente — qualquer caminho novo que envie mensagem precisa da mesma checagem.

---

## 4. Mídia

- **Áudio:** transcrito por reconhecimento de fala e o texto entra no turno como se tivesse sido digitado. A transcrição às vezes distorce o nome do produto, o que a normalização de descrição precisa tolerar.
- **Foto e PDF:** leitura de comprovante, que pode injetar uma intenção prévia de registro no turno em vez de partir da mensagem vazia.

---

## 5. Comportamento em conta sincronizada

O usuário se refere a um Fato que já existe, e o assistente enriquece:

- “Esse PIX foi pessoal” — define o perfil
- “O fornecedor é José Silva Marketing” — associa a pessoa
- “Essa compra pertence ao projeto Itália” — registra em tags

A referência é resolvida por data, valor e descrição. Havendo mais de um candidato, o assistente apresenta lista numerada e espera a escolha.

Nenhuma dessas mensagens cria uma movimentação nova. Todas alteram apenas Conhecimento.

### A recusa

Quando o usuário pede algo proibido, a resposta é uma recusa explicada, nunca um erro técnico:

> Esse lançamento veio do banco. Posso classificar e complementar, mas não criar nem apagar.

Quando o objetivo real é tirar aquilo do relatório, o caminho é `ignorado_em_relatorio`: some das agregações e o Fato permanece intacto. A recusa sempre diz isso, porque recusar sem oferecer o caminho que existe deixa o usuário sem saída.

Duas recusas distintas, com textos distintos:

- **Registrar em conta conectada.** *“‘Nubank’ está conectada ao banco, então o lançamento vem de lá. Quando cair no extrato, me chame que eu classifico.”* O gasto não é negado — é adiado até existir como Fato.
- **Excluir algo que veio do banco.** Explica que o extrato é a fonte da verdade e que o lançamento voltaria na próxima sincronização, e oferece esconder dos totais.

A decisão de recusar acontece **antes** de o assistente pedir confirmação. Regra e ponto de aplicação em [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md), seção 10.

---

## 6. Comportamento em conta não sincronizada

Tudo funciona como sempre funcionou. Registro, correção, cancelamento, desambiguação, slot-filling, recorrência e orçamento seguem as regras de [09-REGRAS_DE_NEGOCIO.md](09-REGRAS_DE_NEGOCIO.md), sem nenhuma restrição nova.

Isso é importante para a migração: um usuário que nunca conectar um banco não perde nada.

---

## 7. Enriquecimento na conversa (F5)

Além de categoria, pessoa e perfil, o assistente já entende:

- **Esconder dos relatórios** — “não considera iFood nos relatórios” → `ignorado_em_relatorio` (atalho sem LLM; também a frase “esse” pega o lançamento mais recente).
- **Tags** — “tag projeto Itália no ifood” / “marca o ifood como projeto Itália”.

É o caminho oferecido na recusa de exclusão em conta sincronizada. Observações livres seguem via IA (`CORRIGIR_MOVIMENTO.observacoes`).

## 8. Alertas e resumos

O WhatsApp é o canal de saída proativa do produto. Os alertas nascem como serviço em `apps/api`, não como módulo, porque hoje há um único canal ([ADR-014](adr/014-seis-modulos-sem-infra-nova.md)).

Casos já decididos:

- **Estouro / 80% de orçamento** — no chat, anexado à confirmação de despesa manual; após ingestão Open Finance (+ classificação), envia WhatsApp se o usuário tiver `whatsapp_numero`. Idempotente por orçamento/mês (`alerta_orcamento:{id}:{YYYY-MM}`).
- **Resumo diário de baixa confiança** — `POST /cron/resumo-baixa-confianca` (Bearer `CRON_SECRET`). Lista “Não classificado” + IA abaixo de `LIMIAR_BAIXA_CONFIANCA` (0,7) para usuários com `whatsapp_numero`, envia via Evolution e idempotiza por dia no hábito `resumo_baixa_confianca_dia`. `?dryRun=1` só simula.

**TODO:** catálogo final de alertas, com gatilho, frequência e controle de silenciamento por parte do usuário. Nunca foi definido, e definir agora seria inventar produto.

---

## 9. Riscos específicos do canal

- **Duplicata entre o passado e o sync.** Quem registrou por conversa antes de conectar o banco vai ter o mesmo gasto duas vezes. O casamento na primeira sincronização resolve, migrando o Conhecimento do lançamento manual para o Fato do banco. Ver [13-OPEN_FINANCE.md](13-OPEN_FINANCE.md).
- **Envio indevido a grupo.** Mitigado pelos dois pontos de verificação da seção 3.
- **Dado sensível em conversa.** Dados do plástico só são devolvidos após validação de senha no chat, e ficam cifrados no banco.
