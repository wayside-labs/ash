import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { verifyAdmin } from "./access";

const cfg = { teamDomain: "team.cloudflareaccess.com", aud: "aud-1", admins: ["lucas@example.com"] };
let keys: ReturnType<typeof createLocalJWKSet>;
let sign: (
  claims: Record<string, unknown>,
  opts?: { aud?: string; exp?: string; iss?: string; key?: CryptoKey },
) => Promise<string>;
let otherKey: CryptoKey;
let rsKey: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? `https://${cfg.teamDomain}`)
      .setAudience(opts.aud ?? cfg.aud)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(opts.key ?? privateKey);
  otherKey = (await generateKeyPair("RS256")).privateKey;
  rsKey = privateKey;
});

describe("verifyAdmin", () => {
  it("aceita admin da lista (sem diferenciar maiúsculas)", async () => {
    expect(await verifyAdmin(await sign({ email: "Lucas@Example.com" }), cfg, keys)).toEqual({
      email: "lucas@example.com",
    });
  });
  it("recusa e-mail fora da lista", async () => {
    expect(await verifyAdmin(await sign({ email: "x@example.com" }), cfg, keys)).toBeNull();
  });
  it("recusa audiência de outro app", async () => {
    expect(await verifyAdmin(await sign({ email: "lucas@example.com" }, { aud: "outro" }), cfg, keys)).toBeNull();
  });
  it("recusa token vencido", async () => {
    expect(await verifyAdmin(await sign({ email: "lucas@example.com" }, { exp: "-1m" }), cfg, keys)).toBeNull();
  });
  it("recusa token assinado por outra chave (mesmo kid)", async () => {
    expect(await verifyAdmin(await sign({ email: "lucas@example.com" }, { key: otherKey }), cfg, keys)).toBeNull();
  });
  it("recusa emissor de outro time", async () => {
    const iss = "https://outro.cloudflareaccess.com";
    expect(await verifyAdmin(await sign({ email: "lucas@example.com" }, { iss }), cfg, keys)).toBeNull();
  });
  it("recusa token sem claim de e-mail", async () => {
    expect(await verifyAdmin(await sign({}), cfg, keys)).toBeNull();
  });
  it("recusa e-mail que não é string", async () => {
    expect(await verifyAdmin(await sign({ email: ["lucas@example.com"] }), cfg, keys)).toBeNull();
  });
  it("recusa algoritmo fora do pin (PS256 publicado no JWKS)", async () => {
    const ps = await generateKeyPair("PS256");
    const psJwk = { ...(await exportJWK(ps.publicKey)), kid: "k2", alg: "PS256" };
    const psKeys = createLocalJWKSet({ keys: [psJwk] });
    const t = await new SignJWT({ email: "lucas@example.com" })
      .setProtectedHeader({ alg: "PS256", kid: "k2" })
      .setIssuer(`https://${cfg.teamDomain}`)
      .setAudience(cfg.aud)
      .setExpirationTime("5m")
      .sign(ps.privateKey);
    expect(await verifyAdmin(t, cfg, psKeys)).toBeNull();
  });
  it("aceita nbf 10 s no futuro (clockTolerance)", async () => {
    const t = await new SignJWT({ email: "lucas@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${cfg.teamDomain}`)
      .setAudience(cfg.aud)
      .setNotBefore(Math.floor(Date.now() / 1000) + 10)
      .setExpirationTime("5m")
      .sign(rsKey);
    expect(await verifyAdmin(t, cfg, keys)).toEqual({ email: "lucas@example.com" });
  });
  it("recusa token sem exp (requiredClaims)", async () => {
    const t = await new SignJWT({ email: "lucas@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${cfg.teamDomain}`)
      .setAudience(cfg.aud)
      .sign(rsKey);
    expect(await verifyAdmin(t, cfg, keys)).toBeNull();
  });
  it("recusa ausência de token", async () => {
    expect(await verifyAdmin(null, cfg, keys)).toBeNull();
  });
});
