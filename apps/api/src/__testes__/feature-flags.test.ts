import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS, isFlagEnabled } from "../config/feature-flags";

describe("feature flags Assistente 2.0", () => {
  it("permanecem desligadas por padrão", () => {
    expect(FEATURE_FLAGS.ASSISTENTE_V2_ASSISTANT).toBe(false);
    expect(FEATURE_FLAGS.ASSISTENTE_V2_SHADOW).toBe(false);
    expect(isFlagEnabled("ASSISTENTE_V2_ASSISTANT")).toBe(false);
    expect(isFlagEnabled("ASSISTENTE_V2_SESSION")).toBe(false);
  });
});
