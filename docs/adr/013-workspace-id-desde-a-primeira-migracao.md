# ADR-013 — `workspace_id` em todas as tabelas desde a primeira migração

**Status:** aceito

## Contexto

O conceito de workspace existe para permitir que múltiplos contextos compartilhem a mesma inteligência: meu CPF, o CPF do sócio e o CNPJ da empresa, com as mesmas regras, a mesma memória e o mesmo assistente. Isso abre o produto para famílias e sociedades.

Só que nada disso é necessário nos próximos meses. A interface de convite, os papéis de membro e a troca de contexto são funcionalidades da fase F6. A filosofia adotada na revisão de arquitetura foi explícita: não implementar antecipadamente solução para problema que ainda não existe.

Há, porém, uma assimetria de custo. Adicionar uma coluna de escopo em tabelas vazias ou pequenas é trivial. Adicionar escopo de tenancy a um banco com dados de produção, consultas espalhadas e índices existentes é uma migração de risco: toda query precisa ser revisada, todo índice reavaliado, e um esquecimento vira vazamento de dado entre usuários.

## Decisão

`workspace_id` entra em todas as tabelas de dados na primeira migração da fase F1, junto com `workspace` e `workspace_membro`.

Até a fase F6, um workspace é criado automaticamente por usuário e não há interface de convite, troca de contexto ou gestão de papéis.

Esta é a **única** antecipação aceita na arquitetura. Ela é registrada como exceção justamente para que não sirva de precedente: “vamos deixar preparado” não é argumento válido para nenhuma outra estrutura.

## Alternativas consideradas

**Criar `modulos/workspace`.** Recusada. Workspace é escopo de dados e regra de autorização, não um módulo com lógica própria. Um pacote inteiro para uma coluna e uma tabela de associação é sofisticação sem ganho.

**Adicionar `workspace_id` apenas na F6, quando a funcionalidade chegar.** Recusada pela assimetria de custo descrita acima. É o caso raro em que antecipar é mais barato.

**Usar o `usuario_id` existente como escopo e migrar para workspace depois.** Recusada. É exatamente a migração dolorosa que se quer evitar, com o agravante de que `usuario_id` tem outro significado — quem criou — que não se confunde com escopo.

## Consequências

- Todas as consultas de leitura, incluindo as de `modulos/relatorios`, filtram por `workspace_id` desde o início.
- Os dados existentes migram para o workspace criado automaticamente para cada usuário.
- `usuario_id` continua existindo com o significado de autoria, não de escopo. Os dois campos coexistem e não são redundantes.
- Se algum dia houver política de segurança no nível de linha no Postgres, ela terá a coluna de que precisa.
- Cria a tentação de antecipar outras estruturas “pela mesma lógica”. A resposta padrão é não: a exceção vale porque a migração posterior é comprovadamente de alto risco, o que não é verdade para colunas de classificação ou módulos.

Ver [07-MODELO_DE_DADOS.md](../07-MODELO_DE_DADOS.md) e [01-DOMINIO.md](../01-DOMINIO.md).
