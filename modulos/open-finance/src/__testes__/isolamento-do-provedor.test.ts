import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nomes de provedor que não podem aparecer fora deste módulo. Incluir um nome
 * aqui é o que transforma o [ADR-011](docs/adr/011-open-finance-isolado.md) de
 * intenção em invariante verificada.
 */
const PROVEDORES = ["pluggy"];

/** Onde o nome pode aparecer livremente: dentro do módulo e na documentação. */
const PERMITIDOS = ["modulos/open-finance", "docs"];

const IGNORADOS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  "coverage",
  ".tmp-analise",
]);
const EXTENSOES = [".ts", ".tsx", ".mts", ".sql"];

/**
 * Remove comentário de linha inteira e bloco. Comentário é prosa, e o que esta
 * regra protege é dependência de código: um comentário explicando que `provedor`
 * é rótulo opaco de um provedor concreto é útil, e proibi-lo seria proibir
 * explicar a própria regra.
 *
 * Não mexe em comentário no fim de linha de código, de propósito: recortar até o
 * `//` engoliria uma URL como `https://api.provedor.com` e esconderia justamente
 * o vazamento que interessa.
 */
function sem_comentarios(conteudo: string): string {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("//") && !linha.trimStart().startsWith("--"))
    .join("\n");
}

function raiz_do_repositorio(): string {
  let atual = dirname(fileURLToPath(import.meta.url));

  while (atual !== "/") {
    try {
      statSync(join(atual, "pnpm-workspace.yaml"));
      return atual;
    } catch {
      atual = resolve(atual, "..");
    }
  }

  throw new Error("raiz do monorepo não encontrada");
}

function arquivos_de_codigo(raiz: string): string[] {
  const encontrados: string[] = [];

  function percorrer(diretorio: string): void {
    for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
      if (IGNORADOS.has(entrada.name)) continue;

      const caminho = join(diretorio, entrada.name);
      const relativo = relative(raiz, caminho);

      if (entrada.isDirectory()) {
        if (PERMITIDOS.some((p) => relativo === p)) continue;
        percorrer(caminho);
        continue;
      }

      if (EXTENSOES.some((extensao) => entrada.name.endsWith(extensao))) {
        encontrados.push(caminho);
      }
    }
  }

  percorrer(raiz);
  return encontrados;
}

describe("isolamento do provedor de Open Finance", () => {
  /**
   * Vale para fixture de teste também, e não por preciosismo: um fixture que
   * grava o nome do provedor à mão é o começo do espalhamento que o ADR-011
   * proíbe. Rótulo neutro no teste prova a mesma coisa e não cria dívida.
   */
  it("não usa o nome do provedor em código fora do módulo", () => {
    const raiz = raiz_do_repositorio();
    const infratores: string[] = [];

    for (const caminho of arquivos_de_codigo(raiz)) {
      const codigo = sem_comentarios(readFileSync(caminho, "utf8")).toLowerCase();
      const encontrado = PROVEDORES.find((provedor) => codigo.includes(provedor));
      if (encontrado) infratores.push(`${relative(raiz, caminho)} usa "${encontrado}"`);
    }

    expect(infratores).toEqual([]);
  });
});
