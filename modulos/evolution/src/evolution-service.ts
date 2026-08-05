import axios, { AxiosError, type AxiosInstance } from "axios";
import {
  carregarConfiguracaoEvolution,
  type ConfiguracaoEvolution,
} from "./configuracao";
import { ErroEvolution } from "./erros";
import { loggerEvolution } from "./logger";
import type {
  EvolutionButton,
  EvolutionListSection,
  EvolutionMessageKey,
  MidiaBase64Evolution,
} from "./tipos";

const TIMEOUT_MS = 30_000;

type OpcoesEvolutionService = {
  config?: ConfiguracaoEvolution;
  http?: AxiosInstance;
};

export class EvolutionService {
  private readonly config: ConfiguracaoEvolution;
  private readonly http: AxiosInstance;

  constructor(opcoes: OpcoesEvolutionService = {}) {
    this.config = opcoes.config ?? carregarConfiguracaoEvolution();
    this.http =
      opcoes.http ??
      axios.create({
        baseURL: this.config.url,
        timeout: TIMEOUT_MS,
        headers: {
          apikey: this.config.apiKey,
          "Content-Type": "application/json",
        },
      });
  }

  private get instance(): string {
    return this.config.instance;
  }

  private async executar<T>(metodo: string, request: () => Promise<T>): Promise<T> {
    loggerEvolution.info(`${metodo}: iniciando`);
    try {
      const resultado = await request();
      loggerEvolution.info(`${metodo}: sucesso`);
      return resultado;
    } catch (erro) {
      if (erro instanceof ErroEvolution) {
        loggerEvolution.error(`${metodo}: falhou`, {
          status: erro.status,
          message: erro.message,
          detalhes: erro.detalhes,
        });
        throw erro;
      }

      if (axios.isAxiosError(erro)) {
        const axiosErro = erro as AxiosError;
        const status = axiosErro.response?.status;
        const detalhes = axiosErro.response?.data ?? axiosErro.message;
        const mensagem =
          typeof detalhes === "object" &&
          detalhes !== null &&
          "message" in detalhes &&
          typeof (detalhes as { message: unknown }).message === "string"
            ? (detalhes as { message: string }).message
            : axiosErro.message;

        const erroEvolution = new ErroEvolution(
          metodo,
          `Evolution API (${metodo}): ${mensagem}`,
          status,
          detalhes,
        );
        loggerEvolution.error(`${metodo}: falhou`, {
          status,
          message: erroEvolution.message,
          detalhes,
        });
        throw erroEvolution;
      }

      const erroEvolution = new ErroEvolution(
        metodo,
        `Evolution API (${metodo}): ${erro instanceof Error ? erro.message : String(erro)}`,
        undefined,
        erro,
      );
      loggerEvolution.error(`${metodo}: falhou`, {
        message: erroEvolution.message,
        detalhes: erro,
      });
      throw erroEvolution;
    }
  }

  /** Inicia conexão da instância (retorna QR / pairing quando aplicável). */
  async connect(): Promise<unknown> {
    return this.executar("connect", async () => {
      const { data } = await this.http.get(`/instance/connect/${this.instance}`);
      return data;
    });
  }

  async sendText(number: string, message: string): Promise<unknown> {
    return this.executar("sendText", async () => {
      const { data } = await this.http.post(`/message/sendText/${this.instance}`, {
        number,
        text: message,
      });
      return data;
    });
  }

  /** Alias semântico para resposta automática no WhatsApp. */
  async enviarMensagemWhatsApp(entrada: {
    numero: string;
    texto: string;
  }): Promise<unknown> {
    return this.sendText(entrada.numero, entrada.texto);
  }

  async sendImage(number: string, imageUrl: string, caption?: string): Promise<unknown> {
    return this.executar("sendImage", async () => {
      const { data } = await this.http.post(`/message/sendMedia/${this.instance}`, {
        number,
        mediatype: "image",
        media: imageUrl,
        ...(caption !== undefined ? { caption } : {}),
      });
      return data;
    });
  }

  async sendAudio(number: string, audioUrl: string): Promise<unknown> {
    return this.executar("sendAudio", async () => {
      const { data } = await this.http.post(
        `/message/sendWhatsAppAudio/${this.instance}`,
        {
          number,
          audio: audioUrl,
        },
      );
      return data;
    });
  }

  async sendDocument(
    number: string,
    documentUrl: string,
    fileName?: string,
  ): Promise<unknown> {
    return this.executar("sendDocument", async () => {
      const { data } = await this.http.post(`/message/sendMedia/${this.instance}`, {
        number,
        mediatype: "document",
        media: documentUrl,
        ...(fileName !== undefined ? { fileName } : {}),
      });
      return data;
    });
  }

  async sendButtons(
    number: string,
    text: string,
    buttons: EvolutionButton[],
    footerText?: string,
  ): Promise<unknown> {
    return this.executar("sendButtons", async () => {
      const { data } = await this.http.post(`/message/sendButtons/${this.instance}`, {
        number,
        text,
        buttons,
        ...(footerText !== undefined ? { footerText } : {}),
      });
      return data;
    });
  }

  async sendList(
    number: string,
    title: string,
    description: string,
    buttonText: string,
    sections: EvolutionListSection[],
    footerText?: string,
  ): Promise<unknown> {
    return this.executar("sendList", async () => {
      const { data } = await this.http.post(`/message/sendList/${this.instance}`, {
        number,
        title,
        description,
        buttonText,
        sections,
        ...(footerText !== undefined ? { footerText } : {}),
      });
      return data;
    });
  }

  async sendReaction(key: EvolutionMessageKey, reaction: string): Promise<unknown> {
    return this.executar("sendReaction", async () => {
      const { data } = await this.http.post(`/message/sendReaction/${this.instance}`, {
        key,
        reaction,
      });
      return data;
    });
  }

  async markAsRead(readMessages: EvolutionMessageKey[]): Promise<unknown> {
    return this.executar("markAsRead", async () => {
      const { data } = await this.http.post(
        `/chat/markMessageAsRead/${this.instance}`,
        { readMessages },
      );
      return data;
    });
  }

  async getProfile(number: string): Promise<unknown> {
    return this.executar("getProfile", async () => {
      const { data } = await this.http.post(`/chat/fetchProfile/${this.instance}`, {
        number,
      });
      return data;
    });
  }

  /**
   * Baixa mídia inbound (áudio/imagem/documento) em base64.
   * Evolution: POST /chat/getBase64FromMediaMessage/{instance}
   */
  async obterBase64Midia(entrada: {
    key: EvolutionMessageKey;
    message: Record<string, unknown>;
  }): Promise<MidiaBase64Evolution> {
    return this.executar("obterBase64Midia", async () => {
      const { data } = await this.http.post(
        `/chat/getBase64FromMediaMessage/${this.instance}`,
        {
          message: {
            key: entrada.key,
            message: entrada.message,
          },
          convertToMp4: false,
        },
      );

      const base64 =
        typeof data === "string"
          ? data
          : typeof data?.base64 === "string"
            ? data.base64
            : typeof data?.data === "string"
              ? data.data
              : null;

      if (!base64) {
        throw new ErroEvolution(
          "obterBase64Midia",
          "Evolution API (obterBase64Midia): resposta sem base64",
          undefined,
          data,
        );
      }

      const limpo = base64.replace(/^data:[^;]+;base64,/, "");
      const mimetype =
        typeof data?.mimetype === "string"
          ? data.mimetype
          : typeof data?.mimeType === "string"
            ? data.mimeType
            : undefined;

      return { base64: limpo, mimetype };
    });
  }

  async logout(): Promise<unknown> {
    return this.executar("logout", async () => {
      const { data } = await this.http.delete(`/instance/logout/${this.instance}`);
      return data;
    });
  }
}
