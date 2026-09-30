import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
const ensureAccountForUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));
vi.mock("@/lib/server/auth/bootstrap", () => ({ ensureAccountForUser }));

const { GET } = await import("./route");

function confirm(query: string) {
  return GET(new Request(`http://127.0.0.1:3000/auth/confirm${query}`));
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.DASHBOARD_PUBLIC_URL = "https://console.example";
    verifyOtp.mockReset();
    ensureAccountForUser.mockReset();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.DASHBOARD_PUBLIC_URL;
  });

  it("verifies the token hash, provisions the account, and lands on the public origin", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const res = await confirm("?token_hash=abc&type=email&next=%2Ftreasury");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email" });
    expect(ensureAccountForUser).toHaveBeenCalledWith({ id: "u1" });
    expect(res.headers.get("location")).toBe("https://console.example/treasury");
  });

  it("goes home rather than off-site when next is absolute", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const res = await confirm("?token_hash=abc&type=magiclink&next=https%3A%2F%2Fevil.example");
    expect(res.headers.get("location")).toBe("https://console.example/");
  });

  it.each([
    ["no token", "?type=email"],
    ["a recovery token, which is not a sign-in", "?token_hash=abc&type=recovery"],
  ])("refuses %s without calling Supabase", async (_label, query) => {
    const res = await confirm(query);
    expect(res.headers.get("location")).toBe("https://console.example/account?error=auth");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("sends an expired or reused link back to sign in", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    const res = await confirm("?token_hash=abc&type=email");
    expect(res.headers.get("location")).toBe("https://console.example/account?error=auth");
    expect(ensureAccountForUser).not.toHaveBeenCalled();
  });

  it("reports a failed bootstrap as its own error", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    ensureAccountForUser.mockRejectedValue(new Error("no table"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await confirm("?token_hash=abc&type=email");
    expect(res.headers.get("location")).toBe("https://console.example/account?error=bootstrap");
  });
});
