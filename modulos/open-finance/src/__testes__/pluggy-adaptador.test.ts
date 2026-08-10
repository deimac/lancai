import { beforeEach, describe, expect, it } from "vitest";
import { ErroProvedorIndisponivel, ErroWebhookInvalido } from "../erros";
import { AdaptadorPluggy } from "../pluggy/adaptador";

/**
 * Um provedor de mentira no nível do HTTP. Serve para provar o **adaptador**:
 * autenticação, montagem de URL e tradução de formato. Os corpos abaixo foram
 * copiados da documentação oficial da Pluggy, não inventados — um fixture
 * inventado provaria apenas que o código concorda consigo mesmo.
 */
class RedeFalsa {
  readonly chamadas: Array<{ url: string; metodo: string; chave?: string; corpo?: unknown }> = [];
  private respostas = new Map<string, unknown>();
  private status = new Map<string, number[]>();

  responder(padrao: string, corpo: unknown): void {
    this.respostas.set(padrao, corpo);
  }

  /** Sequência de códigos HTTP para um padrão, consumida a cada chamada. */
  falhar(padrao: string, codigos: number[]): void {
    this.status.set(padrao, codigos);
  }

  get buscar(): typeof fetch {
    return (async (entrada: string | URL | Request, opcoes?: RequestInit) => {
      const url = String(entrada);
      const cabecalhos = (opcoes?.headers ?? {}) as Record<string, string>;

      this.chamadas.push({
        url,
        metodo: opcoes?.method ?? "GET",
        chave: cabecalhos["X-API-KEY"],
        corpo: opcoes?.body ? JSON.parse(String(opcoes.body)) : undefined,
      });

      const padrao = [...this.respostas.keys()].find((chave) => url.includes(chave));
      const codigos = padrao ? this.status.get(padrao) : undefined;
      const codigo = codigos?.shift() ?? 200;
      const corpo = padrao ? this.respostas.get(padrao) : {};
      const texto = JSON.stringify(corpo ?? {});

      return {
        ok: codigo >= 200 && codigo < 300,
        status: codigo,
        json: async () => corpo,
        text: async () => texto,
      } as Response;
    }) as typeof fetch;
  }
}

const ITEM = "de7bbf5a-abf2-47e4-94b1-586b36758423";
const CONTA = "0d5a0de2-9c82-4ea2-af50-31643a632a33";

describe("AdaptadorPluggy", () => {
  let rede: RedeFalsa;
  let adaptador: AdaptadorPluggy;

  beforeEach(() => {
    rede = new RedeFalsa();
    rede.responder("/auth", { apiKey: "chave-de-teste" });
    adaptador = new AdaptadorPluggy({
      clientId: "cliente",
      clientSecret: "segredo",
      buscar: rede.buscar,
      webhookUrl: "https://lancai.exemplo/api/webhooks/open-finance",
    });
  });

  describe("autenticação", () => {
    it("troca client id e secret por uma chave e a manda no header", async () => {
      rede.responder("/accounts", { results: [] });

      await adaptador.listar_contas_externas(ITEM);

      const [login, consulta] = rede.chamadas;
      expect(login?.url).toContain("/auth");
      expect(login?.corpo).toEqual({ clientId: "cliente", clientSecret: "segredo" });
      expect(consulta?.chave).toBe("chave-de-teste");
    });

    it("reaproveita a chave entre chamadas", async () => {
      rede.responder("/accounts", { results: [] });

      await adaptador.listar_contas_externas(ITEM);
      await adaptador.listar_contas_externas(ITEM);

      expect(rede.chamadas.filter((c) => c.url.includes("/auth"))).toHaveLength(1);
    });

    it("autentica de novo quando a chave é recusada, e uma vez só", async () => {
      rede.responder("/accounts", { results: [] });
      rede.falhar("/accounts", [403]);

      await adaptador.listar_contas_externas(ITEM);

      expect(rede.chamadas.filter((c) => c.url.includes("/auth"))).toHaveLength(2);
      expect(rede.chamadas.filter((c) => c.url.includes("/accounts"))).toHaveLength(2);
    });

    it("desiste quando a recusa persiste, em vez de repetir sem fim", async () => {
      rede.responder("/accounts", { results: [] });
      rede.falhar("/accounts", [403, 403]);

      await expect(adaptador.listar_contas_externas(ITEM)).rejects.toThrow(
        ErroProvedorIndisponivel,
      );
    });

    it("não dispara dois logins quando duas chamadas correm juntas", async () => {
      rede.responder("/accounts", { results: [] });

      await Promise.all([
        adaptador.listar_contas_externas(ITEM),
        adaptador.listar_contas_externas(ITEM),
      ]);

      expect(rede.chamadas.filter((c) => c.url.includes("/auth"))).toHaveLength(1);
    });
  });

  describe("token de conexão", () => {
    it("pede o token amarrado ao usuarioId e ao nosso webhook", async () => {
      rede.responder("/connect_token", { accessToken: "token-do-widget" });

      const token = await adaptador.criar_token_conexao({ usuarioId: "user-1" });

      const pedido = rede.chamadas.find((c) => c.url.includes("/connect_token"));
      expect(pedido?.corpo).toEqual({
        options: {
          clientUserId: "user-1",
          webhookUrl: "https://lancai.exemplo/api/webhooks/open-finance",
          avoidDuplicates: true,
        },
      });
      expect(token.token).toBe("token-do-widget");
      expect(token.expiraEm.getTime()).toBeGreaterThan(Date.now());
    });

    /** Sem `itemId` o widget cria conexão nova em vez de consertar a existente. */
    it("manda o item quando é reconexão", async () => {
      rede.responder("/connect_token", { accessToken: "token" });

      await adaptador.criar_token_conexao({ usuarioId: "user-1", conexaoExterna: ITEM });

      const pedido = rede.chamadas.find((c) => c.url.includes("/connect_token"));
      expect((pedido?.corpo as { itemId?: string }).itemId).toBe(ITEM);
    });
  });

  describe("atualizar agora", () => {
    it("manda PATCH /items/{id} sem corpo de sincronização em lote", async () => {
      rede.responder(`/items/${ITEM}`, {});

      await adaptador.solicitar_atualizacao(ITEM);

      const pedido = rede.chamadas.find((c) => c.url.includes(`/items/${ITEM}`));
      expect(pedido?.metodo).toBe("PATCH");
      expect(pedido?.corpo).toEqual({});
    });

    it("propaga falha do provedor como ErroProvedorIndisponivel", async () => {
      rede.responder(`/items/${ITEM}`, {});
      rede.falhar(`/items/${ITEM}`, [503]);

      await expect(adaptador.solicitar_atualizacao(ITEM)).rejects.toThrow(
        ErroProvedorIndisponivel,
      );
    });
  });

  describe("histórico", () => {
    it("monta referências GET por conta com janela de 365 dias", async () => {
      rede.responder("/accounts", {
        results: [
          { id: "acc-a", subtype: "CHECKING_ACCOUNT", name: "Corrente", balance: 1 },
          { id: "acc-b", subtype: "CREDIT_CARD", name: "Cartão", balance: 2 },
        ],
      });

      const refs = await adaptador.listar_referencias_historico(ITEM);

      expect(refs).toHaveLength(2);
      expect(refs[0]).toContain("accountId=acc-a");
      expect(refs[0]).toContain("dateFrom=");
      expect(refs[0]).not.toContain("pageSize=");
      expect(refs[0]).not.toMatch(/[?&]from=/);
      expect(refs[1]).toContain("accountId=acc-b");
    });
  });

  describe("contas", () => {
    it("traduz conta corrente e cartão preservando o que o usuário reconhece", async () => {
      rede.responder("/accounts", {
        results: [
          {
            id: "a658c848-e475-457b-8565-d1fffba127c4",
            type: "BANK",
            subtype: "CHECKING_ACCOUNT",
            number: "0001/12345-0",
            name: "Conta Corrente",
            marketingName: "GOLD Conta Corrente",
            balance: 120950,
          },
          {
            id: "4f61bd6d-e6fc-44b2-9c4b-5609058de7ab",
            type: "CREDIT",
            subtype: "CREDIT_CARD",
            name: "Itau Uniclass 2.0 Mastercard Platinum",
            marketingName: null,
            number: "1234",
            balance: 142.41,
            creditData: {
              creditLimit: 51800,
              availableCreditLimit: 51657.59,
              balanceCloseDate: "2020-10-20",
              balanceDueDate: "2020-10-27",
            },
          },
        ],
      });

      const contas = await adaptador.listar_contas_externas(ITEM);

      expect(contas).toEqual([
        {
          idExterno: "a658c848-e475-457b-8565-d1fffba127c4",
          nome: "Conta Corrente",
          tipo: "CHECKING_ACCOUNT",
          saldo: 120950,
        },
        {
          idExterno: "4f61bd6d-e6fc-44b2-9c4b-5609058de7ab",
          nome: "Itau Uniclass 2.0 Mastercard Platinum",
          tipo: "CREDIT_CARD",
          saldo: 142.41,
          limite: 51800,
          fechamento: 20,
          vencimento: 27,
        },
      ]);
    });
  });

  describe("coleta de lote", () => {
    it("traduz a transação preservando descrição crua e sinal do valor", async () => {
      rede.responder("/v2/transactions", {
        results: [
          {
            id: "a8534c85-53ce-4f21-94d7-50e9d2ee4957",
            description: "* PROV * COMPRA TESOURO DIRETO CLIENTES",
            descriptionRaw: "* PROV * COMPRA TESOURO DIRETO CLIENTES",
            amount: -212.45,
            date: "2020-10-15T00:00:00.000Z",
            accountId: CONTA,
            status: "POSTED",
            type: "DEBIT",
          },
        ],
        next: null,
      });

      const lote = await adaptador.coletar_lote(`/v2/transactions?accountId=${CONTA}`);

      expect(lote.movimentacoes).toEqual([
        {
          idExterno: "a8534c85-53ce-4f21-94d7-50e9d2ee4957",
          contaExternaId: CONTA,
          ocorridoEm: "2020-10-15",
          valor: 212.45,
          tipo: "despesa",
          descricaoFonte: "* PROV * COMPRA TESOURO DIRETO CLIENTES",
          favorecidoFonte: undefined,
          statusFonte: "confirmado",
        },
      ]);
      expect(lote.proxima).toBeNull();
    });

    it("entrega CREDIT como receita e PENDING como pendente", async () => {
      rede.responder("/v2/transactions", {
        results: [
          {
            id: "t-1",
            description: "TED Example",
            descriptionRaw: null,
            amount: 1500,
            date: "2021-04-12T00:00:00.000Z",
            accountId: CONTA,
            type: "CREDIT",
            status: "PENDING",
          },
        ],
      });

      const [movimentacao] = (await adaptador.coletar_lote("/v2/transactions")).movimentacoes;

      expect(movimentacao?.tipo).toBe("receita");
      expect(movimentacao?.statusFonte).toBe("pendente");
      /** Sem `descriptionRaw`, a versão limpa é o melhor Fato disponível. */
      expect(movimentacao?.descricaoFonte).toBe("TED Example");
    });

    it("prefere o nome do estabelecimento e cai no recebedor do pagamento", async () => {
      rede.responder("/v2/transactions", {
        results: [
          {
            id: "t-1",
            amount: -50,
            date: "2026-01-05T00:00:00.000Z",
            accountId: CONTA,
            type: "DEBIT",
            merchant: { name: "IFOOD" },
          },
          {
            id: "t-2",
            amount: -80,
            date: "2026-01-06T00:00:00.000Z",
            accountId: CONTA,
            type: "DEBIT",
            merchant: null,
            paymentData: { receiver: { name: "MARIA SILVA" } },
          },
        ],
      });

      const { movimentacoes } = await adaptador.coletar_lote("/v2/transactions");

      expect(movimentacoes[0]?.favorecidoFonte).toBe("IFOOD");
      expect(movimentacoes[1]?.favorecidoFonte).toBe("MARIA SILVA");
    });

    it("lê o parcelamento do cartão que a instituição informa", async () => {
      rede.responder("/v2/transactions", {
        results: [
          {
            id: "t-1",
            descriptionRaw: "MAGAZINE LUIZA 03/10",
            amount: -100,
            date: "2026-08-15T00:00:00.000Z",
            accountId: CONTA,
            type: "DEBIT",
            creditCardMetadata: {
              installmentNumber: 3,
              totalInstallments: 10,
              totalAmount: 1000,
              purchaseDate: "2026-06-15T00:00:00.000Z",
            },
          },
        ],
      });

      const [movimentacao] = (await adaptador.coletar_lote("/v2/transactions")).movimentacoes;

      expect(movimentacao?.parcelamento).toEqual({
        numero: 3,
        total: 10,
        valorTotal: 1000,
        compraEm: "2026-06-15",
      });
    });

    /**
     * Nem todo conector preenche valor e data da compra. Perder o parcelamento
     * inteiro por falta deles seria pior do que registrar "3 de 10".
     */
    it("registra o parcelamento mesmo sem valor e data da compra", async () => {
      rede.responder("/v2/transactions", {
        results: [
          {
            id: "t-1",
            descriptionRaw: "LOJA X 02/06",
            amount: -50,
            date: "2026-08-15T00:00:00.000Z",
            accountId: CONTA,
            type: "DEBIT",
            creditCardMetadata: { installmentNumber: 2, totalInstallments: 6 },
          },
        ],
      });

      const [movimentacao] = (await adaptador.coletar_lote("/v2/transactions")).movimentacoes;

      expect(movimentacao?.parcelamento).toEqual({
        numero: 2,
        total: 6,
        valorTotal: undefined,
        compraEm: undefined,
      });
    });

    /** Sem número e total não dá para dizer "3 de 10", e o resto não informa nada. */
    it("ignora metadados de cartão sem número e total de parcelas", async () => {
      rede.responder("/v2/transactions", {
        results: [
          {
            id: "t-1",
            descriptionRaw: "COMPRA A VISTA",
            amount: -50,
            date: "2026-08-15T00:00:00.000Z",
            accountId: CONTA,
            type: "DEBIT",
            creditCardMetadata: { totalAmount: 50 },
          },
        ],
      });

      const [movimentacao] = (await adaptador.coletar_lote("/v2/transactions")).movimentacoes;

      expect(movimentacao?.parcelamento).toBeUndefined();
    });

    /** O `next` vem como query string relativa ao endpoint de transações. */
    it("transforma o cursor relativo em caminho completo", async () => {
      rede.responder("/v2/transactions", {
        results: [],
        next: `?accountId=${CONTA}&after=MjAyMC0xMC0xNVQwMDowMDowMC4wMDBa`,
      });

      const lote = await adaptador.coletar_lote("/v2/transactions");

      expect(lote.proxima).toBe(
        `/v2/transactions?accountId=${CONTA}&after=MjAyMC0xMC0xNVQwMDowMDowMC4wMDBa`,
      );
    });

    it("aceita o link absoluto que o webhook entrega", async () => {
      rede.responder("/v2/transactions", { results: [] });

      await adaptador.coletar_lote(
        `https://api.pluggy.ai/v2/transactions?accountId=${CONTA}&createdAtFrom=2025-02-13T17:21:53.719Z`,
      );

      const consulta = rede.chamadas.find((c) => c.url.includes("createdAtFrom"));
      expect(consulta?.url).toBe(
        `https://api.pluggy.ai/v2/transactions?accountId=${CONTA}&createdAtFrom=2025-02-13T17:21:53.719Z`,
      );
    });
  });

  describe("coleta por identificador", () => {
    /**
     * O provedor exige `accountId`, e o webhook de alteração fala só do item.
     * Varrer as contas é a única forma correta; o teste fixa isso porque um
     * atalho aqui perderia transação em conta que não foi consultada.
     */
    it("procura em todas as contas da conexão e não repete resultado", async () => {
      rede.responder("/accounts", {
        results: [
          { id: "conta-a", subtype: "CHECKING_ACCOUNT", name: "Corrente" },
          { id: "conta-b", subtype: "CREDIT_CARD", name: "Cartão" },
        ],
      });
      rede.responder("/v2/transactions", {
        results: [{ id: "t-1", amount: -10, date: "2026-01-01T00:00:00.000Z", accountId: "conta-a" }],
      });

      const movimentacoes = await adaptador.coletar_por_ids(ITEM, ["t-1"]);

      const consultas = rede.chamadas.filter((c) => c.url.includes("/v2/transactions"));
      expect(consultas).toHaveLength(2);
      expect(consultas[0]?.url).toContain("accountId=conta-a");
      expect(consultas[1]?.url).toContain("accountId=conta-b");
      expect(movimentacoes).toHaveLength(1);
    });

    it("não chama o provedor quando não há identificador", async () => {
      expect(await adaptador.coletar_por_ids(ITEM, [])).toEqual([]);
      expect(rede.chamadas).toHaveLength(0);
    });
  });

  describe("estado da conexão", () => {
    it("lê conexão saudável", async () => {
      rede.responder("/items/", {
        id: ITEM,
        status: "UPDATED",
        executionStatus: "SUCCESS",
        connector: { name: "MeuPluggy" },
        lastUpdatedAt: "2024-09-19T13:11:23.595Z",
        nextAutoSyncAt: null,
        consentExpiresAt: null,
        error: null,
      });

      const estado = await adaptador.obter_estado(ITEM);

      expect(estado.status).toBe("ativa");
      expect(estado.instituicao).toBe("MeuPluggy");
      expect(estado.motivoAtencao).toBeUndefined();
      expect(estado.ultimoSyncEm?.toISOString()).toBe("2024-09-19T13:11:23.595Z");
      /** Nulo é o padrão da Pluggy: consentimento sem expiração. */
      expect(estado.consentimentoExpiraEm).toBeNull();
    });

    it("distingue credencial inválida de erro do provedor", async () => {
      rede.responder("/items/", {
        id: ITEM,
        status: "LOGIN_ERROR",
        executionStatus: "INVALID_CREDENTIALS",
        error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." },
      });

      const estado = await adaptador.obter_estado(ITEM);

      expect(estado.status).toBe("precisa_atencao");
      expect(estado.motivoAtencao).toBe("credencial_invalida");
    });

    it("reconhece consentimento revogado no banco", async () => {
      rede.responder("/items/", {
        id: ITEM,
        status: "LOGIN_ERROR",
        executionStatus: "USER_AUTHORIZATION_REVOKED",
        error: { code: "USER_AUTHORIZATION_REVOKED" },
      });

      expect((await adaptador.obter_estado(ITEM)).motivoAtencao).toBe("consentimento_revogado");
    });

    it("trata instabilidade da instituição como erro do provedor", async () => {
      rede.responder("/items/", {
        id: ITEM,
        status: "OUTDATED",
        executionStatus: "SITE_NOT_AVAILABLE",
        error: { code: "SITE_NOT_AVAILABLE" },
      });

      expect((await adaptador.obter_estado(ITEM)).motivoAtencao).toBe("erro_no_provedor");
    });

    /** Errar para o lado de pedir atenção é mais barato que fingir que está ativa. */
    it("trata status desconhecido como precisando de atenção", async () => {
      rede.responder("/items/", { id: ITEM, status: "STATUS_QUE_AINDA_NAO_EXISTE" });

      expect((await adaptador.obter_estado(ITEM)).status).toBe("precisa_atencao");
    });
  });

  describe("leitura do webhook", () => {
    it("traduz lote novo preferindo o link de V2", () => {
      const lido = adaptador.interpretar_notificacao({
        itemId: ITEM,
        event: "transactions/created",
        eventId: "4e69d62d-b7c8-4f01-b591-a1d8a94710b9",
        accountId: CONTA,
        transactionsCount: 332,
        createdTransactionsLink: `https://api.pluggy.ai/transactions?accountId=${CONTA}`,
        createdTransactionsLinkV2: `https://api.pluggy.ai/v2/transactions?accountId=${CONTA}`,
      });

      expect(lido.eventoId).toBe("4e69d62d-b7c8-4f01-b591-a1d8a94710b9");
      expect(lido.notificacao).toEqual({
        tipo: "lote_disponivel",
        conexaoExterna: ITEM,
        referencia: `https://api.pluggy.ai/v2/transactions?accountId=${CONTA}`,
      });
    });

    /**
     * Em aplicação criada depois de junho de 2026 só vem `createdTransactionsLink`,
     * e ele já aponta para V2. Sem este caso, aplicação nova ficaria sem lote.
     */
    it("usa o link único quando não há versão em separado", () => {
      const lido = adaptador.interpretar_notificacao({
        itemId: ITEM,
        event: "transactions/created",
        eventId: "e-1",
        createdTransactionsLink: `https://api.pluggy.ai/v2/transactions?accountId=${CONTA}`,
      });

      expect(lido.notificacao).toMatchObject({
        tipo: "lote_disponivel",
        referencia: `https://api.pluggy.ai/v2/transactions?accountId=${CONTA}`,
      });
    });

    it("traduz alteração e remoção de transações", () => {
      const ids = ["5a14feae-eaa7-423a-820c-6b83837c35b7", "786c7d98-6085-4879-9c7f-2255260e2436"];

      expect(
        adaptador.interpretar_notificacao({
          event: "transactions/updated",
          eventId: "e-1",
          itemId: ITEM,
          accountId: CONTA,
          transactionIds: ids,
        }).notificacao,
      ).toEqual({ tipo: "movimentacoes_alteradas", conexaoExterna: ITEM, idsExternos: ids });

      expect(
        adaptador.interpretar_notificacao({
          event: "transactions/deleted",
          eventId: "e-2",
          itemId: ITEM,
          transactionIds: ids,
        }).notificacao,
      ).toEqual({ tipo: "movimentacoes_removidas", conexaoExterna: ITEM, idsExternos: ids });
    });

    it("traduz erro do item para o motivo que o usuário precisa resolver", () => {
      const lido = adaptador.interpretar_notificacao({
        event: "item/error",
        eventId: "e-1",
        itemId: ITEM,
        error: { code: "USER_INPUT_TIMEOUT", message: "User requested input had expired" },
      });

      expect(lido.notificacao).toEqual({
        tipo: "conexao_precisa_atencao",
        conexaoExterna: ITEM,
        motivo: "aguardando_usuario",
      });
    });

    it("trata espera por ação do usuário no aplicativo do banco", () => {
      expect(
        adaptador.interpretar_notificacao({
          event: "item/waiting_user_action",
          eventId: "e-1",
          itemId: ITEM,
        }).notificacao,
      ).toMatchObject({ tipo: "conexao_precisa_atencao", motivo: "aguardando_usuario" });
    });

    it("traduz criação e atualização do item para sync de estado", () => {
      expect(
        adaptador.interpretar_notificacao({
          event: "item/created",
          eventId: "e-created",
          itemId: ITEM,
        }).notificacao,
      ).toEqual({ tipo: "conexao_estado", conexaoExterna: ITEM });

      expect(
        adaptador.interpretar_notificacao({
          event: "item/updated",
          eventId: "e-updated",
          itemId: ITEM,
        }).notificacao,
      ).toEqual({ tipo: "conexao_estado", conexaoExterna: ITEM });
    });

    it("traduz remoção do item", () => {
      expect(
        adaptador.interpretar_notificacao({ event: "item/deleted", eventId: "e-1", itemId: ITEM })
          .notificacao,
      ).toEqual({ tipo: "conexao_removida", conexaoExterna: ITEM });
    });

    /** Evento que não nos interessa ainda é gravado, com o nome bruto preservado. */
    it("ignora evento de pagamento sem perder o registro", () => {
      const lido = adaptador.interpretar_notificacao({
        event: "payment_intent/completed",
        eventId: "e-1",
        paymentIntentId: "p-1",
      });

      expect(lido.tipoBruto).toBe("payment_intent/completed");
      expect(lido.notificacao).toEqual({
        tipo: "ignorada",
        descricao: "payment_intent/completed",
      });
    });

    it("ignora lote sem link em vez de coletar de lugar nenhum", () => {
      expect(
        adaptador.interpretar_notificacao({
          event: "transactions/created",
          eventId: "e-1",
          itemId: ITEM,
        }).notificacao,
      ).toMatchObject({ tipo: "ignorada" });
    });

    /** Sem `eventId` não há como descartar retentativa, e a Pluggy manda até nove. */
    it("recusa webhook sem identificador de evento", () => {
      expect(() => adaptador.interpretar_notificacao({ event: "item/updated" })).toThrow(
        ErroWebhookInvalido,
      );
      expect(() => adaptador.interpretar_notificacao("não é objeto")).toThrow(ErroWebhookInvalido);
    });
  });
});
