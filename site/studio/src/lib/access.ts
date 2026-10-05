import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";

export type AccessConfig = { teamDomain: string; aud: string; admins: readonly string[] };

const remote = new Map<string, JWTVerifyGetKey>();
function remoteKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = remote.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remote.set(teamDomain, keys);
  }
  return keys;
}

// Access already blocks outsiders at the edge; this second check is what stops a request that
// reaches the origin some other way (or a valid Access user who is not on our list).
export async function verifyAdmin(
  token: string | null,
  cfg: AccessConfig,
  keys: JWTVerifyGetKey = remoteKeys(cfg.teamDomain),
): Promise<{ email: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${cfg.teamDomain}`,
      audience: cfg.aud,
      algorithms: ["RS256"],
      clockTolerance: "30s",
      requiredClaims: ["exp"],
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (email && cfg.admins.includes(email)) return { email };
    // No email in the log: a denial line must not become a record of who knocked.
    console.warn(JSON.stringify({ at: "access", denied: "not_admin" }));
    return null;
  } catch (err) {
    const raw = err instanceof Error && "code" in err ? (err as { code: unknown }).code : undefined;
    const code = raw === undefined ? "invalid" : String(raw);
    console.warn(JSON.stringify({ at: "access", denied: code }));
    return null;
  }
}
