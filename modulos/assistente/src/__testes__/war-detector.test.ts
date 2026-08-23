import { describe, expect, it } from "vitest";
import { detectWrongAction } from "../agente/war-detector";

describe("Wrong Action Rate detector", () => {
  it("write sem confirmação", () => {
    expect(
      detectWrongAction({ op: "create", executed: true, confirmRequired: true, confirmed: false }),
    ).toBe("missing_confirmation");
  });

  it("write OF", () => {
    expect(
      detectWrongAction({
        op: "delete",
        executed: true,
        confirmRequired: true,
        confirmed: true,
        fatoImutavel: true,
        targetFonte: "open_finance",
      }),
    ).toBe("unauthorized_write");
  });

  it("entidade errada", () => {
    expect(
      detectWrongAction({
        op: "update",
        executed: true,
        confirmRequired: true,
        confirmed: true,
        requestedTargetId: "00000000-0000-4000-8000-000000000101",
        executedEntityId: "00000000-0000-4000-8000-000000000102",
      }),
    ).toBe("wrong_entity");
  });

  it("turno saudável", () => {
    expect(
      detectWrongAction({
        op: "create",
        executed: true,
        confirmRequired: true,
        confirmed: true,
      }),
    ).toBeNull();
  });
});
