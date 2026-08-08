# ADR-012 — IA e WhatsApp enriquecem, nunca escrevem Fato sincronizado

**Status:** aceito — estende o ADR-003

## Contexto

O ADR-003 já estabelecia que a IA não tem credencial de escrita no banco: ela produz intenção em JSON e o backend decide. Isso resolve o problema de segurança, mas não o de autoridade.

Com Open Finance, surge um caso que o ADR-003 não cobre: a intenção da IA é legítima, o backend a executa corretamente, e o resultado ainda está errado — porque a movimentação já existia, vinda do banco. Um usuário dizendo “gastei 45 no Uber” em uma conta sincronizada não quer criar nada; ele está descrevendo algo que o banco vai sincronizar de qualquer forma. Executar a intenção gera duplicata.

O inverso também vale: “apaga esse pagamento” sobre um Fato do banco é um pedido que o sistema não pode atender sem mentir sobre o extrato.

Ao mesmo tempo, o WhatsApp continua sendo o diferencial do produto. A resposta não pode ser desligar o canal em conta sincronizada.

## Decisão

Em conta ou cartão sincronizado, a IA e o WhatsApp podem apenas **enriquecer**: escrever categoria, pessoa, perfil, tags e observações, e propor regra.

É proibido criar movimentação, alterar valor, data, conta ou descrição de origem, e excluir.

Em conta **não** sincronizada, o comportamento atual permanece integralmente: registro, correção, cancelamento, desambiguação e slot-filling seguem funcionando como sempre.

A propriedade que decide é a flag `sincronizada` da conta, não uma configuração global nem uma escolha no momento da mensagem.

Quando o usuário pede algo proibido, a resposta é uma recusa explicada, nunca um erro técnico: *“Esse lançamento veio do banco. Posso classificar e complementar, mas não criar nem apagar.”*

## Alternativas consideradas

**Permitir criação e deduplicar depois, quando o banco sincronizar.** Recusada. O usuário veria o lançamento duas vezes por horas ou dias, e o casamento automático erraria em casos de valor repetido. Melhor não criar.

**Bloquear o WhatsApp por completo em workspace com Open Finance.** Recusada. Jogaria fora o diferencial do produto, e ignora o caso do modo misto: cartão sincronizado convivendo com dinheiro em espécie na mesma carteira.

**Deixar o usuário escolher, por mensagem, se quer registrar mesmo assim.** Recusada. Transfere ao usuário uma decisão que ele não tem informação para tomar, e reintroduz a duplicata como opção.

## Consequências

- O resolvedor de intenções precisa consultar a política da conta **antes** de propor criação ou exclusão. Não é uma validação no motor, é uma decisão de interpretação.
- A IA precisa saber localizar um Fato existente por data, valor e descrição, com lista numerada quando houver ambiguidade. Enriquecer exige referenciar, o que é mais difícil do que criar.
- As tools disponíveis à IA não devem sequer expor método capaz de mutar Fato sincronizado. Proibir por ausência é mais forte que proibir por validação.
- Usuário que nunca conectar um banco não percebe mudança nenhuma.
- Exige teste de invariante: intenção de registro sobre conta sincronizada devolve recusa, não sucesso silencioso nem erro técnico.

Ver [09-REGRAS_DE_NEGOCIO.md](../09-REGRAS_DE_NEGOCIO.md) e [12-WHATSAPP.md](../12-WHATSAPP.md).
