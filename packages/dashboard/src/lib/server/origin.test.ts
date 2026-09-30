import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOrigin, publicOrigin } from "./origin";

const ALLOWED = "http://localhost:3000";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/state", { method: "PATCH", headers });
}

// NODE_ENV is typed read-only by Next's ambient declarations, and vitest's
// stubEnv is the seam built for exactly that.
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.ALLOWED_ORIGINS;
});

describe("assertSameOrigin", () => {
  it("lets the dashboard's own fetch through", () => {
    expect(
      assertSameOrigin(
        request({ origin: ALLOWED, host: "localhost:3000", "sec-fetch-site": "same-origin" }),
      ),
    ).toBeNull();
  });

  it("denies a missing Origin, because a browser always sends one on POST", async () => {
    const denied = assertSameOrigin(request({ host: "localhost:3000" }));
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toMatchObject({ error: "forbidden: missing origin" });
  });

  it("denies a foreign origin", () => {
    expect(
      assertSameOrigin(request({ origin: "https://evil.example", host: "localhost:3000" }))?.status,
    ).toBe(403);
  });

  it("denies cross-site even when the origin header is absent", () => {
    expect(assertSameOrigin(request({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  });

  it("denies DNS rebinding, where Origin and Host agree with each other", () => {
    // The trap the naive implementation walks into: comparing Origin against
    // this request's own Host passes here, because the attacker controls both.
    expect(
      assertSameOrigin(request({ origin: "http://evil.example", host: "evil.example" }))?.status,
    ).toBe(403);
  });

  it("denies a permitted origin arriving with an unknown Host", () => {
    expect(assertSameOrigin(request({ origin: ALLOWED, host: "evil.example" }))?.status).toBe(403);
  });

  it("accepts an origin the deployment declares", () => {
    process.env.ALLOWED_ORIGINS = "https://rails.example, https://other.example";
    expect(
      assertSameOrigin(request({ origin: "https://rails.example", host: "rails.example" })),
    ).toBeNull();
  });

  it("drops the localhost defaults in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ALLOWED_ORIGINS = "https://rails.example";
    expect(assertSameOrigin(request({ origin: ALLOWED, host: "localhost:3000" }))?.status).toBe(
      403,
    );
  });

  it("denies everything when production declares no allowlist at all", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(assertSameOrigin(request({ origin: ALLOWED, host: "localhost:3000" }))?.status).toBe(
      403,
    );
  });
});

describe("publicOrigin", () => {
  afterEach(() => {
    delete process.env.DASHBOARD_PUBLIC_URL;
  });

  it("prefers the declared public URL over the loopback the proxy forwards to", () => {
    process.env.DASHBOARD_PUBLIC_URL = "https://console.example/";
    expect(publicOrigin(new Request("http://localhost:3000/auth/callback"))).toBe(
      "https://console.example",
    );
  });

  it("falls back to the request's origin when nothing is declared", () => {
    expect(publicOrigin(new Request("http://localhost:3000/auth/callback"))).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores a forged Host header", () => {
    const req = new Request("http://localhost:3000/auth/callback", {
      headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
    });
    expect(publicOrigin(req)).toBe("http://localhost:3000");
  });
});
