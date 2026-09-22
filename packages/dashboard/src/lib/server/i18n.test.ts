import { beforeEach, describe, expect, it, vi } from "vitest";

const readState = vi.fn();

class StateAccessError extends Error {
  constructor(public readonly response: Response) {
    super("state access denied");
  }
}

vi.mock("@/lib/server/store", () => ({
  readState,
  StateAccessError,
}));

const { getDashboardLocale, serverT } = await import("./i18n");

beforeEach(() => {
  readState.mockReset();
});

describe("getDashboardLocale", () => {
  it("reads the stored preference", async () => {
    readState.mockResolvedValue({ settings: { language: "pt-BR" } });
    expect(await getDashboardLocale()).toBe("pt-BR");
  });

  it("falls back to the default when the tenant state is unreadable", async () => {
    readState.mockRejectedValue(new StateAccessError(new Response(null, { status: 401 })));
    expect(await getDashboardLocale()).toBe("en");
  });

  it("still lets an unrelated failure through", async () => {
    readState.mockRejectedValue(new Error("disk on fire"));
    await expect(getDashboardLocale()).rejects.toThrow("disk on fire");
  });

  it("keeps serverT usable on the denied path, so 401/422 bodies render", async () => {
    readState.mockRejectedValue(new StateAccessError(new Response(null, { status: 401 })));
    await expect(serverT("api.error.notFound")).resolves.toEqual(expect.any(String));
  });
});
