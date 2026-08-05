import { describe, expect, it } from "vitest";
import { extrair_midia_mensagem } from "../servicos/extrair-midia-mensagem";

describe("extrair_midia_mensagem", () => {
  it("detecta áudio", () => {
    const midia = extrair_midia_mensagem({
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "ABC" },
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } },
    });
    expect(midia?.tipo).toBe("audio");
    expect(midia?.key.id).toBe("ABC");
  });

  it("detecta imagem com caption", () => {
    const midia = extrair_midia_mensagem({
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "IMG1" },
      message: { imageMessage: { caption: "mercado", mimetype: "image/jpeg" } },
    });
    expect(midia?.tipo).toBe("image");
    expect(midia?.caption).toBe("mercado");
  });

  it("detecta PDF", () => {
    const midia = extrair_midia_mensagem({
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "PDF1" },
      message: {
        documentMessage: { mimetype: "application/pdf", fileName: "recibo.pdf" },
      },
    });
    expect(midia?.tipo).toBe("document");
  });

  it("ignora documento que não é PDF/imagem", () => {
    const midia = extrair_midia_mensagem({
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "X" },
      message: { documentMessage: { mimetype: "application/zip", fileName: "a.zip" } },
    });
    expect(midia).toBeNull();
  });

  it("retorna null sem mídia", () => {
    expect(
      extrair_midia_mensagem({
        key: { remoteJid: "x@s.whatsapp.net", fromMe: false, id: "1" },
        message: { conversation: "oi" },
      }),
    ).toBeNull();
  });
});
