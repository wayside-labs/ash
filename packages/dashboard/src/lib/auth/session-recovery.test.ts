import type { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assign = vi.fn();

function stubLocation(pathname: string, search = "") {
  vi.stubGlobal("window", { location: { pathname, search, assign } });
}

const client = { invalidateQueries: vi.fn() } as unknown as QueryClient;

/**
 * A fresh module per test resets the once-per-page provisioning latch. The errors come from
 * the same fresh graph, or `instanceof HttpError` would compare two different classes.
 */
async function load() {
  vi.resetModules();
  const { ACCOUNT_NOT_PROVISIONED, HttpError } = await import("@/lib/http-error");
  return {
    ...(await import("./session-recovery")),
    unauthorized: new HttpError(401, "unauthorized", "unauthorized"),
    unprovisioned: new HttpError(403, ACCOUNT_NOT_PROVISIONED, ACCOUNT_NOT_PROVISIONED),
    csrf: new HttpError(403, "forbidden origin", "forbidden origin"),
  };
}

describe("recoverFromAuthError", () => {
  beforeEach(() => {
    assign.mockReset();
    vi.mocked(client.invalidateQueries).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a 401 to sign in, remembering where it was", async () => {
    stubLocation("/apis", "?q=1");
    const { recoverFromAuthError, unauthorized } = await load();
    recoverFromAuthError(unauthorized, client);
    expect(assign).toHaveBeenCalledWith("/account?next=%2Fapis%3Fq%3D1");
  });

  it("does not loop on the sign-in page", async () => {
    stubLocation("/account");
    const { recoverFromAuthError, unauthorized } = await load();
    recoverFromAuthError(unauthorized, client);
    expect(assign).not.toHaveBeenCalled();
  });

  it("re-runs provisioning once and refetches on success", async () => {
    stubLocation("/");
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { recoverFromAuthError, unprovisioned } = await load();
    recoverFromAuthError(unprovisioned, client);
    recoverFromAuthError(unprovisioned, client);
    await vi.waitFor(() => expect(client.invalidateQueries).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/bootstrap", { method: "POST" });
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows the bootstrap error when provisioning fails", async () => {
    stubLocation("/");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { recoverFromAuthError, unprovisioned } = await load();
    recoverFromAuthError(unprovisioned, client);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/account?error=bootstrap"));
  });

  it("ignores a CSRF 403 and ordinary failures", async () => {
    stubLocation("/");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { recoverFromAuthError, csrf } = await load();
    recoverFromAuthError(csrf, client);
    recoverFromAuthError(new Error("boom"), client);
    expect(fetch).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("retryUnlessAuth", () => {
  it("never retries auth failures and retries others once", async () => {
    const { retryUnlessAuth, unauthorized, unprovisioned, csrf } = await load();
    expect(retryUnlessAuth(0, unauthorized)).toBe(false);
    expect(retryUnlessAuth(0, unprovisioned)).toBe(false);
    expect(retryUnlessAuth(0, csrf)).toBe(true);
    expect(retryUnlessAuth(1, new Error("x"))).toBe(false);
  });
});
