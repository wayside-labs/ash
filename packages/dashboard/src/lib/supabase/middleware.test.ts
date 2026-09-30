import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
let pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: typeof pendingCookies) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        if (pendingCookies.length) opts.cookies.setAll(pendingCookies);
        return getUser();
      },
    },
  }),
}));

const { updateSession } = await import("./middleware");

function req(path: string) {
  return new NextRequest(new URL(path, "http://127.0.0.1:3000"));
}

describe("updateSession", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.DASHBOARD_PUBLIC_URL = "https://console.example";
    pendingCookies = [];
    getUser.mockReset();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.DASHBOARD_PUBLIC_URL;
  });

  it("sends a signed-out page request to sign in, on the public origin", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(req("/treasury?tab=vaults"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://console.example/account?next=%2Ftreasury%3Ftab%3Dvaults",
    );
  });

  it("carries a cleared session cookie onto the redirect", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    pendingCookies = [{ name: "sb-auth-token", value: "", options: { maxAge: 0 } }];
    const res = await updateSession(req("/"));
    expect(res.headers.get("location")).toBe("https://console.example/account");
    expect(res.cookies.get("sb-auth-token")?.value).toBe("");
  });

  it.each(["/api/state", "/api/account/wallet", "/account", "/auth/callback", "/auth/confirm"])(
    "leaves %s to answer for itself when signed out",
    async (path) => {
      getUser.mockResolvedValue({ data: { user: null } });
      const res = await updateSession(req(path));
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("passes a signed-in page request through", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await updateSession(req("/treasury"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("gates nothing when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await updateSession(req("/treasury"));
    expect(res.headers.get("location")).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
});
