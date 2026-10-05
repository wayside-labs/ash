import { SECURITY_PRESET_NAMES } from "@ash/contract";
import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "./config.js";

const SESSION = "11111111111111111111111111111114";

const baseEnv = {
  ASH_RPC: "http://localhost:8899",
  ASH_SESSION: SESSION,
  ASH_SIGNER: "/tmp/session.json",
} satisfies NodeJS.ProcessEnv;

describe("loadConfigFromEnv", () => {
  it("binds the session from configuration", () => {
    const config = loadConfigFromEnv(baseEnv);
    expect(config.session).toBe(SESSION);
  });

  it("refuses to start without a session", () => {
    const { ASH_SESSION: _omitted, ...env } = baseEnv;
    // A server that does not know which session it serves must not serve tools at all.
    expect(() => loadConfigFromEnv(env)).toThrow(/ASH_SESSION/);
  });

  it("refuses to start without any signer", () => {
    const { ASH_SIGNER: _omitted, ...env } = baseEnv;
    expect(() => loadConfigFromEnv(env)).toThrow(/session signer is required/);
  });

  it("requires the public key alongside a remote signer URL", () => {
    const { ASH_SIGNER: _omitted, ...env } = baseEnv;
    // Without it, the startup check against the on-chain session key cannot run.
    expect(() =>
      loadConfigFromEnv({ ...env, ASH_REMOTE_SIGNER_URL: "https://signer.internal" }),
    ).toThrow(/REMOTE_SIGNER_ADDRESS/);
  });

  it("accepts a remote signer instead of a keypair on disk", () => {
    const { ASH_SIGNER: _omitted, ...env } = baseEnv;
    const config = loadConfigFromEnv({
      ...env,
      ASH_REMOTE_SIGNER_URL: "https://signer.internal",
      ASH_REMOTE_SIGNER_ADDRESS: SESSION,
    });

    expect(config.remoteSigner?.url).toBe("https://signer.internal");
    expect(config.signerKeypairPath).toBe("");
  });

  it("defaults the intent TTL well inside the program's bounds", () => {
    const config = loadConfigFromEnv(baseEnv);
    // The replay window is server-authored; a caller used to pick it.
    expect(config.intentTtlSeconds).toBe(90);
  });

  it("rejects an intent TTL the program would refuse", () => {
    expect(() => loadConfigFromEnv({ ...baseEnv, ASH_INTENT_TTL_SECONDS: "7200" })).toThrow(
      /between 5 and 3600/,
    );
    expect(() => loadConfigFromEnv({ ...baseEnv, ASH_INTENT_TTL_SECONDS: "2" })).toThrow(
      /between 5 and 3600/,
    );
  });

  it("parses mint aliases and always knows SOL", () => {
    const config = loadConfigFromEnv({
      ...baseEnv,
      ASH_MINT_ALIASES: "USDC:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });

    expect(config.mintAliases.USDC).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(config.mintAliases.SOL).toBe("So11111111111111111111111111111111111111112");
  });

  it("rejects a malformed alias rather than ignoring it", () => {
    expect(() => loadConfigFromEnv({ ...baseEnv, ASH_MINT_ALIASES: "USDC" })).toThrow(
      /SYMBOL:address/,
    );
  });

  it("rejects a non-numeric rate limit", () => {
    expect(() => loadConfigFromEnv({ ...baseEnv, ASH_MAX_PAYMENTS_PER_MINUTE: "lots" })).toThrow(
      /positive integer/,
    );
  });

  // Every ADR-013 posture must be reachable. `config.ts` once used SECURITY_PRESET_NAMES
  // without importing it, so naming a preset threw ReferenceError at startup and only the
  // default was usable — invisible to tests that never named one.
  it.each(SECURITY_PRESET_NAMES)("accepts the %s security preset", (preset) => {
    expect(loadConfigFromEnv({ ...baseEnv, ASH_SECURITY: preset }).securityPreset).toBe(preset);
  });

  it("rejects an unknown security preset by name", () => {
    expect(() => loadConfigFromEnv({ ...baseEnv, ASH_SECURITY: "bogus" })).toThrow(
      /ASH_SECURITY must be one of/,
    );
  });

  it("defaults ASH_TOOLS to full and accepts readonly", () => {
    expect(loadConfigFromEnv(baseEnv).toolsMode).toBe("full");
    expect(loadConfigFromEnv({ ...baseEnv, ASH_TOOLS: "readonly" }).toolsMode).toBe("readonly");
  });

  // A typo must not fall back to `full`: the operator asked for less privilege.
  it("rejects an unknown ASH_TOOLS value", () => {
    expect(() => loadConfigFromEnv({ ...baseEnv, ASH_TOOLS: "read_only" })).toThrow(
      /ASH_TOOLS must be/,
    );
  });
});

describe("ingest configuration", () => {
  it("takes the dashboard URL and token together, trimming a trailing slash", () => {
    const config = loadConfigFromEnv({
      ...baseEnv,
      ASH_INGEST_URL: "https://dash.example/api/ingest/",
      ASH_INGEST_TOKEN: "tok",
    });
    expect(config.ingest).toEqual({ url: "https://dash.example/api/ingest", token: "tok" });
  });

  it("refuses one without the other", () => {
    expect(() =>
      loadConfigFromEnv({ ...baseEnv, ASH_INGEST_URL: "https://dash.example/api/ingest" }),
    ).toThrow(/go together/);
  });

  it("refuses to send a bearer token over plain HTTP except to loopback", () => {
    const env = { ...baseEnv, ASH_INGEST_TOKEN: "tok" };
    expect(() =>
      loadConfigFromEnv({ ...env, ASH_INGEST_URL: "http://dash.example/api/ingest" }),
    ).toThrow(/https/);
    expect(
      loadConfigFromEnv({ ...env, ASH_INGEST_URL: "http://127.0.0.1:3000/api/ingest" }).ingest,
    ).toBeDefined();
  });
});
