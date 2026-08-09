import { useEffect, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { useToast } from "../contexto/ContextoToast";
import {
  clienteApi,
  ErroApi,
  type AcaoRegraApi,
  type CampoCondicaoRegra,
  type CartaoResumo,
  type CategoriaResumo,
  type CondicaoRegraApi,
  type ContaResumo,
  type LogicaCondicoesRegra,
  type OperadorCondicaoRegra,
  type PessoaResumo,
  type RegraResumo,
} from "../lib/api";
import { Botao } from "./ui/Botao";
import { Campo } from "./ui/Campo";
import { unir_classes } from "../lib/unir-classes";

const CAMPOS: { valor: CampoCondicaoRegra; rotulo: string }[] = [
  { valor: "descricao", rotulo: "Descrição" },
  { valor: "valor", rotulo: "Valor" },
  { valor: "data", rotulo: "Data" },
  { valor: "tipo", rotulo: "Tipo" },
  { valor: "conta", rotulo: "Conta" },
  { valor: "cartao", rotulo: "Cartão" },
];

const OPERADORES: { valor: OperadorCondicaoRegra; rotulo: string }[] = [
  { valor: "comeca_com", rotulo: "começa com" },
  { valor: "contem", rotulo: "contém" },
  { valor: "nao_contem", rotulo: "não contém" },
  { valor: "igual", rotulo: "é igual a" },
  { valor: "diferente", rotulo: "é diferente de" },
  { valor: "termina_com", rotulo: "termina com" },
  { valor: "regex", rotulo: "regex" },
];

const TIPOS_MOVIMENTO = [
  "despesa",
  "receita",
  "transferencia",
  "reembolso",
  "emprestimo",
  "estorno",
  "retirada",
  "aporte",
] as const;

type Props = {
  aberto: boolean;
  regra?: RegraResumo | null;
  categorias: CategoriaResumo[];
  aoFechar: () => void;
  aoSalvar: () => void;
};

function condicao_vazia(): CondicaoRegraApi {
  return { campo: "descricao", operador: "contem", valor: "" };
}

function acao_vazia(categoriaId: string): AcaoRegraApi {
  return { tipo: "definir_categoria", categoriaId };
}

export function ModalRegra({ aberto, regra, categorias, aoFechar, aoSalvar }: Props) {
  const { usuario } = useAutenticacao();
  const toast = useToast();
  const editando = Boolean(regra);

  const [nome, setNome] = useState("");
  const [logica, setLogica] = useState<LogicaCondicoesRegra>("ou");
  const [condicoes, setCondicoes] = useState<CondicaoRegraApi[]>([condicao_vazia()]);
  const [acoes, setAcoes] = useState<AcaoRegraApi[]>([acao_vazia("")]);
  const [ativa, setAtiva] = useState(true);
  const [aplicarExistentes, setAplicarExistentes] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [cartoes, setCartoes] = useState<CartaoResumo[]>([]);
  const [pessoas, setPessoas] = useState<PessoaResumo[]>([]);

  useEffect(() => {
    if (!aberto || !usuario) return;
    setErro(null);
    setAplicarExistentes(false);
    void Promise.all([
      clienteApi.listar_contas(usuario.id, true),
      clienteApi.listar_cartoes(usuario.id, true),
      clienteApi.listar_pessoas(usuario.id).catch(() => [] as PessoaResumo[]),
    ]).then(([c, k, p]) => {
      setContas(c);
      setCartoes(k);
      setPessoas(p);
    });

    if (regra) {
      setNome(regra.nome);
      setLogica(regra.logicaCondicoes);
      setCondicoes(regra.condicoes.length ? regra.condicoes : [condicao_vazia()]);
      setAcoes(regra.acoes.length ? regra.acoes : [acao_vazia(categorias[0]?.id ?? "")]);
      setAtiva(regra.ativa);
    } else {
      setNome("");
      setLogica("ou");
      setCondicoes([condicao_vazia()]);
      setAcoes([acao_vazia(categorias[0]?.id ?? "")]);
      setAtiva(true);
    }
  }, [aberto, regra, categorias, usuario]);

  if (!aberto || !usuario) return null;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!usuario || !nome.trim()) return;
    if (condicoes.some((c) => !c.valor.trim())) {
      setErro("Preencha o valor de todas as condições.");
      return;
    }
    if (acoes.length < 1) {
      setErro("Adicione ao menos uma ação.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      if (editando && regra) {
        await clienteApi.atualizar_regra(regra.id, {
          usuarioId: usuario.id,
          nome: nome.trim(),
          logicaCondicoes: logica,
          condicoes,
          acoes,
          ativa,
          aplicarExistentes,
        });
        toast.sucesso("Regra atualizada.");
      } else {
        await clienteApi.criar_regra({
          usuarioId: usuario.id,
          nome: nome.trim(),
          logicaCondicoes: logica,
          condicoes,
          acoes,
          ativa,
          aplicarExistentes,
        });
        toast.sucesso("Regra criada.");
      }
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar a regra.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={(e) => void salvar(e)}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-borda bg-superficie shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-borda px-4 py-3">
          <h2 className="text-lg font-semibold text-texto">
            {editando ? "Editar regra" : "Nova regra"}
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1 text-texto-suave hover:bg-superficie-alta hover:text-texto"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <label className="flex flex-col gap-1 text-xs text-texto-suave">
            Nome
            <Campo
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder='Ex.: Uber / 99 → Transporte'
              required
              autoFocus
            />
          </label>

          <section className="rounded-xl border border-borda p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-texto">Condições</p>
              <div className="flex rounded-lg border border-borda p-0.5 text-xs">
                {(["e", "ou"] as const).map((opcao) => (
                  <button
                    key={opcao}
                    type="button"
                    onClick={() => setLogica(opcao)}
                    className={unir_classes(
                      "rounded-md px-2.5 py-1 uppercase",
                      logica === opcao
                        ? "bg-primaria/20 text-primaria"
                        : "text-texto-suave hover:text-texto",
                    )}
                  >
                    {opcao === "e" ? "E (AND)" : "OU (OR)"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {condicoes.map((condicao, indice) => (
                <div key={indice} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
                  <select
                    value={condicao.campo}
                    onChange={(e) => {
                      const campo = e.target.value as CampoCondicaoRegra;
                      setCondicoes((atual) =>
                        atual.map((item, i) =>
                          i === indice
                            ? {
                                ...item,
                                campo,
                                operador: campo === "descricao" ? item.operador : "igual",
                                valor: "",
                              }
                            : item,
                        ),
                      );
                    }}
                    className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
                  >
                    {CAMPOS.map((c) => (
                      <option key={c.valor} value={c.valor}>
                        {c.rotulo}
                      </option>
                    ))}
                  </select>
                  <select
                    value={condicao.operador}
                    onChange={(e) => {
                      const operador = e.target.value as OperadorCondicaoRegra;
                      setCondicoes((atual) =>
                        atual.map((item, i) => (i === indice ? { ...item, operador } : item)),
                      );
                    }}
                    className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
                  >
                    {(condicao.campo === "descricao"
                      ? OPERADORES
                      : OPERADORES.filter((o) => o.valor === "igual" || o.valor === "diferente")
                    ).map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                  <ValorCondicao
                    condicao={condicao}
                    contas={contas}
                    cartoes={cartoes}
                    onChange={(valor) =>
                      setCondicoes((atual) =>
                        atual.map((item, i) => (i === indice ? { ...item, valor } : item)),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setCondicoes((atual) =>
                        atual.length <= 1 ? atual : atual.filter((_, i) => i !== indice),
                      )
                    }
                    className="rounded-lg p-2 text-texto-suave hover:bg-superficie-alta hover:text-texto"
                    aria-label="Remover condição"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCondicoes((atual) => [...atual, condicao_vazia()])}
              className="mt-2 inline-flex items-center gap-1 text-sm text-primaria hover:underline"
            >
              <Plus size={14} />
              Adicionar condição
            </button>
          </section>

          <section className="rounded-xl border border-borda p-3">
            <p className="mb-3 text-sm font-medium text-texto">Ações</p>
            <div className="flex flex-col gap-2">
              {acoes.map((acao, indice) => (
                <div key={indice} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                  <select
                    value={acao.tipo}
                    onChange={(e) => {
                      const tipo = e.target.value as AcaoRegraApi["tipo"];
                      setAcoes((atual) =>
                        atual.map((item, i) => {
                          if (i !== indice) return item;
                          if (tipo === "definir_categoria") {
                            return { tipo, categoriaId: categorias[0]?.id ?? "" };
                          }
                          if (tipo === "definir_beneficiario") {
                            return { tipo, pessoaId: pessoas[0]?.id ?? "" };
                          }
                          if (tipo === "adicionar_tags_notas") {
                            return { tipo, tags: [], observacoes: "" };
                          }
                          if (tipo === "definir_perfil") {
                            return { tipo, perfil: "pf" };
                          }
                          return { tipo: "ignorar_transacao" };
                        }),
                      );
                    }}
                    className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
                  >
                    <option value="definir_categoria">Definir categoria</option>
                    <option value="definir_beneficiario">Definir beneficiário</option>
                    <option value="adicionar_tags_notas">Adicionar tags/notas</option>
                    <option value="ignorar_transacao">Ignorar transação</option>
                  </select>
                  <ValorAcao
                    acao={acao}
                    categorias={categorias}
                    pessoas={pessoas}
                    onChange={(proxima) =>
                      setAcoes((atual) => atual.map((item, i) => (i === indice ? proxima : item)))
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAcoes((atual) =>
                        atual.length <= 1 ? atual : atual.filter((_, i) => i !== indice),
                      )
                    }
                    className="rounded-lg p-2 text-texto-suave hover:bg-superficie-alta hover:text-texto"
                    aria-label="Remover ação"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setAcoes((atual) => [...atual, acao_vazia(categorias[0]?.id ?? "")])
              }
              className="mt-2 inline-flex items-center gap-1 text-sm text-primaria hover:underline"
            >
              <Plus size={14} />
              Adicionar ação
            </button>
          </section>

          <label className="flex items-center gap-2 text-sm text-texto">
            <input
              type="checkbox"
              checked={ativa}
              onChange={(e) => setAtiva(e.target.checked)}
              className="rounded border-borda"
            />
            Regra ativa
          </label>
          <label className="flex items-center gap-2 text-sm text-texto">
            <input
              type="checkbox"
              checked={aplicarExistentes}
              onChange={(e) => setAplicarExistentes(e.target.checked)}
              className="rounded border-borda"
            />
            Aplicar às transações existentes (todos os workspaces)
          </label>

          {erro && (
            <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
              {erro}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-borda px-4 py-3">
          <Botao type="button" variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao type="submit" disabled={salvando || !nome.trim()}>
            {salvando ? "Salvando..." : "Salvar"}
          </Botao>
        </div>
      </form>
    </div>
  );
}

function ValorCondicao({
  condicao,
  contas,
  cartoes,
  onChange,
}: {
  condicao: CondicaoRegraApi;
  contas: ContaResumo[];
  cartoes: CartaoResumo[];
  onChange: (valor: string) => void;
}) {
  if (condicao.campo === "conta") {
    return (
      <select
        value={condicao.valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
        required
      >
        <option value="">Selecione</option>
        {contas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
    );
  }
  if (condicao.campo === "cartao") {
    return (
      <select
        value={condicao.valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
        required
      >
        <option value="">Selecione</option>
        {cartoes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
    );
  }
  if (condicao.campo === "tipo") {
    return (
      <select
        value={condicao.valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
        required
      >
        <option value="">Selecione</option>
        {TIPOS_MOVIMENTO.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    );
  }
  if (condicao.campo === "data") {
    return (
      <Campo
        type="date"
        value={condicao.valor}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    );
  }
  return (
    <Campo
      value={condicao.valor}
      onChange={(e) => onChange(e.target.value)}
      placeholder={condicao.campo === "valor" ? "50,00" : "UBER"}
      required
    />
  );
}

function ValorAcao({
  acao,
  categorias,
  pessoas,
  onChange,
}: {
  acao: AcaoRegraApi;
  categorias: CategoriaResumo[];
  pessoas: PessoaResumo[];
  onChange: (acao: AcaoRegraApi) => void;
}) {
  if (acao.tipo === "definir_categoria") {
    return (
      <select
        value={acao.categoriaId}
        onChange={(e) => onChange({ tipo: "definir_categoria", categoriaId: e.target.value })}
        className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
        required
      >
        {categorias.length === 0 && <option value="">Cadastre uma categoria</option>}
        {categorias.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
    );
  }
  if (acao.tipo === "definir_beneficiario") {
    return (
      <select
        value={acao.pessoaId}
        onChange={(e) => onChange({ tipo: "definir_beneficiario", pessoaId: e.target.value })}
        className="rounded-lg border border-borda bg-superficie px-2 py-2 text-sm text-texto"
        required
      >
        {pessoas.length === 0 && <option value="">Nenhum beneficiário cadastrado</option>}
        {pessoas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    );
  }
  if (acao.tipo === "adicionar_tags_notas") {
    return (
      <div className="grid gap-1">
        <Campo
          value={(acao.tags ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              tipo: "adicionar_tags_notas",
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              observacoes: acao.observacoes,
            })
          }
          placeholder="tags, separadas, por vírgula"
        />
        <Campo
          value={acao.observacoes ?? ""}
          onChange={(e) =>
            onChange({
              tipo: "adicionar_tags_notas",
              tags: acao.tags,
              observacoes: e.target.value,
            })
          }
          placeholder="Notas / observações"
        />
      </div>
    );
  }
  return <p className="self-center text-xs text-texto-suave">Marca como ignorada nos relatórios</p>;
}
