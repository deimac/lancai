# ADR-010 — Fonte Financeira é a porta única de entrada

**Status:** aceito

## Contexto

O LançAI tinha uma única forma de entrada: linguagem natural, pelo chat ou pelo WhatsApp. O caminho da mensagem até o banco era direto e específico daquele canal.

A arquitetura-alvo prevê pelo menos cinco origens: Open Finance, lançamento manual, WhatsApp, API e recorrência, com OFX, CSV e PDF no horizonte. Se cada uma tiver seu próprio caminho até o Core, o Core acaba com um ramo condicional por origem, e adicionar a sexta origem exige mexer no centro do sistema — exatamente o lugar onde menos se quer mexer.

Há também o problema da política: uma transação vinda de instituição é imutável, uma digitada não é. Se o Core precisar saber qual origem produz qual política, ele volta a conhecer as origens.

## Decisão

Toda movimentação entra no sistema como `EventoFinanceiroNormalizado`, produzido por uma implementação de `FonteFinanceira`.

O Core expõe uma única entrada de ingestão e **não sabe de onde a movimentação veio**. Duas propriedades sustentam isso:

- A **política vem da fonte**: é o evento que declara `fatoImutavel`, e o Core apenas obedece.
- O campo `provedor` é um rótulo opaco, armazenado e nunca interpretado pelo Core.

`TipoFonte` já reserva `ofx`, `csv` e `pdf`. Reservar o valor no enum é toda a preparação que o futuro exige; nenhum código de importador existe agora.

## Alternativas consideradas

**Um módulo `fontes` separado, com o pipeline de ingestão.** Recusada por simplicidade. O pipeline é fino — normalizar, deduplicar, chamar o Core — e o desacoplamento real vem do contrato em `pacotes/tipos`, não de um pacote adicional com seu próprio build. A entrada de ingestão vive dentro de `financeiro`, e as fontes dependem dela, mantendo a direção correta.

**O Core decidir a política a partir do tipo de fonte.** Recusada. Colocaria um mapa de origem para política dentro do Core, que é conhecimento sobre as origens.

**Cada canal escrever direto no banco.** Recusada. É o que a arquitetura existe para evitar.

## Consequências

- Adicionar uma fonte nova não altera o Core: basta implementar `FonteFinanceira`.
- A deduplicação é responsabilidade do pipeline de ingestão, por `id_externo` ou hash, e vale igualmente para todas as fontes.
- Importadores de arquivo, quando existirem, entram sem redesenho.
- A API pública futura é apenas a fonte `api`, sem porta nova.
- Toda fonte precisa produzir um identificador estável, ou aceitar hash como substituto, sob pena de duplicar em cada execução.

Ver [08-CONTRATOS.md](../08-CONTRATOS.md) e [02-ARQUITETURA.md](../02-ARQUITETURA.md).
