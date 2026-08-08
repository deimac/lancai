export * from "./erros";
/**
 * Os adaptadores concretos **não** são exportados: quem os monta é
 * `criar_provedor_open_finance`, por nome. Exportá-los daria a qualquer
 * aplicação a chance de instanciar um provedor pelo nome da classe, que é o
 * vazamento que o ADR-011 proíbe.
 */
export * from "./provedor";
export * from "./provedor-duble";
export * from "./repositorio";
export * from "./repositorio-drizzle";
export * from "./repositorio-memoria";
export * from "./registro";
export * from "./servico-conexao";
export * from "./servico-ingestao";
