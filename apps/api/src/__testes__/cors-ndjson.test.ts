import { afterEach, describe, expect, it } from "vitest";
import { cabecalhos_stream_ndjson, origem_cors_permitida } from "../cors";

describe("cabecalhos_stream_ndjson", () => {
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    URL_WEB: process.env.URL_WEB,
    CORS_ORIGENS: process.env.CORS_ORIGENS,
  };

  afterEach(() => {
    process.env.NODE_ENV = env.NODE_ENV;
    process.env.URL_WEB = env.URL_WEB;
    process.env.CORS_ORIGENS = env.CORS_ORIGENS;
  });

  it("inclui CORS quando a origem é URL_WEB em produção", async () => {
    process.env.NODE_ENV = "production";
    process.env.URL_WEB = "https://lancai.xploreia.com";
    delete process.env.CORS_ORIGENS;
    const cabecalhos = await cabecalhos_stream_ndjson("https://lancai.xploreia.com");
    expect(cabecalhos["Access-Control-Allow-Origin"]).toBe("https://lancai.xploreia.com");
    expect(cabecalhos["Content-Type"]).toMatch(/ndjson/);
  });

  it("não reflete origem estranha em produção", async () => {
    process.env.NODE_ENV = "production";
    process.env.URL_WEB = "https://lancai.xploreia.com";
    delete process.env.CORS_ORIGENS;
    const cabecalhos = await cabecalhos_stream_ndjson("http://localhost:5173");
    expect(cabecalhos["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(await origem_cors_permitida("http://localhost:5173")).toBe(false);
  });
});
