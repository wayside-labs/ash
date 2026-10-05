import { verifyAdmin } from "./access";
import { type Env, env } from "./env";

export const ACCESS_HEADER = "cf-access-jwt-assertion";

// Kept free of next/* imports so the proxy and unit tests can use it directly.
export async function adminFromToken(token: string | null, e: Env = env()) {
  if (e.NODE_ENV === "development" && e.STUDIO_DEV_ADMIN) return { email: e.STUDIO_DEV_ADMIN };
  return verifyAdmin(token, { teamDomain: e.ACCESS_TEAM_DOMAIN, aud: e.ACCESS_AUD, admins: e.STUDIO_ADMINS });
}
