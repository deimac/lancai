# ADR-011 — Open Finance é apenas uma Fonte Financeira, completamente isolada

**Status:** aceito

## Contexto

Open Finance é a maior aposta do produto: é o que elimina a digitação e torna o LançAI confiável como fonte de verdade. Justamente por isso existe o risco de ele se tornar o centro da arquitetura — com o modelo de dados, os fluxos e a interface moldados em torno do provedor escolhido.

Provedores de agregação bancária têm custo por conexão, política de consentimento própria, limites e roadmap que não controlamos. Trocar de provedor é um cenário realista, não hipotético. Se o nome do provedor aparecer no Core, nos relatórios ou no frontend, a troca deixa de ser uma tarefa e passa a ser um projeto.

## Decisão

Open Finance é tratado como **uma** implementação da abstração Fonte Financeira, e nada além do módulo `modulos/open-finance` pode depender de um provedor.

Regras concretas:

- O Core Financeiro nunca conhece Pluggy nem qualquer outro provedor.
- Nenhuma comparação com nome de provedor existe fora do módulo.
- Configurações específicas de provedor — como importar transações pendentes ou qual campo usar como favorecido — ficam dentro do módulo, não em coluna compartilhada.
- O `apps/web` não tem provedor fixo no código: consulta a API para saber qual fonte está ativa e renderiza o widget correspondente.
- Payload bruto e mapa de contas externas pertencem ao módulo.

Trocar de provedor deve significar escrever um adaptador novo e apagar o antigo, sem tocar em mais nada.

## Alternativas consideradas

**Acoplar ao provedor agora e abstrair depois, quando houver necessidade real.** Recusada, e esta foi a decisão menos óbvia — normalmente a filosofia do projeto é não antecipar abstração. A exceção se justifica porque o acoplamento a um provedor bancário se espalha por schema, jobs, interface e modelo de dados. Não é uma dependência local que se troca em um arquivo; é um vazamento que cresce em silêncio. O custo de manter a porta desde o início é uma interface a mais, e o custo de não mantê-la é uma reescrita.

**Usar a categorização do provedor como categoria do LançAI.** Recusada. Amarraria a taxonomia do produto à do provedor. Pode servir como sugestão inicial, nunca como fonte.

**Deixar o Web abrir o widget do provedor diretamente.** Recusada. O widget precisa rodar no navegador, mas o Web deve descobrir qual provedor usar pela API, não por importação fixa.

## Consequências

- Existe uma porta `ProvedorOpenFinance` e o restante do módulo trabalha contra ela, mesmo havendo só uma implementação.
- Vale automatizar a verificação: um teste ou regra de lint que falhe se o nome do provedor aparecer fora do módulo. É a única forma de garantir a fronteira sem depender de revisão manual.
- O isolamento só será comprovado de verdade quando existir um segundo provedor. Até lá, é uma hipótese bem sustentada.
- Conceitos podem ser aproveitados de projetos de referência; código não. O projeto Securo é AGPL-3.0, incompatível com SaaS fechado.

Ver [13-OPEN_FINANCE.md](../13-OPEN_FINANCE.md) e [14-TESTES.md](../14-TESTES.md).
