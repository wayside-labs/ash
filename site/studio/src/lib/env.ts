import { z } from "zod";

// Bare hostnames only (plus the single label "localhost" for local dev): a scheme, port or path
// here would silently never match the Host header.
const hostname = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().regex(/^(localhost|(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+)$/));

const emailList = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.email()).min(1));

// Intl is the authority on what a zone is: a typo here would otherwise surface as a RangeError
// on the first scheduled post.
const ianaZone = z.string().refine((zone) => {
  if (!zone.includes("/") && zone !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
});

export const EnvSchema = z
  .object({
    // Defaults to production so a missing variable can never switch on the dev admin bypass.
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    DATABASE_URL: z.url(),
    STUDIO_HOST: hostname,
    PUBLIC_HOST: hostname,
    ACCESS_TEAM_DOMAIN: hostname,
    ACCESS_AUD: z.string().min(1),
    STUDIO_ADMINS: emailList,
    // "none" until M3 wires SMTP; "mock" is refused in production by the health check.
    EMAIL_DRIVER: z.enum(["none", "mock", "smtp"]).default("none"),
    APP_VERSION: z.string().default("dev"),
    STUDIO_DEV_ADMIN: z.email().optional(),
    // Where post images live. Relative to the process directory (/app in the image, where the
    // compose file mounts the volume).
    UPLOADS_DIR: z.string().trim().min(1).default("uploads"),
    // The zone the admin thinks in when scheduling a post.
    PUBLISH_TZ: ianaZone.default("America/Sao_Paulo"),
    // Absent (or empty, as an unfilled line in .env is) means the site rebuild is off: the job
    // records site.rebuild_skipped instead of calling GitHub.
    GITHUB_DISPATCH_TOKEN: z
      .string()
      .optional()
      .transform((s) => s?.trim() || undefined),
    GITHUB_DISPATCH_REPO: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/)
      // The name goes into a URL path: "owner/." and "owner/.." would address another endpoint.
      .refine((s) => !s.includes("..") && !s.endsWith("/."))
      .default("lglucas/ash-web"),
    // Only the worker holds the token (deploy/docker-compose.yml blanks it for the app, which
    // faces the internet and has no use for it). This is the non-secret flag derived from it,
    // so /api/health can still say whether the rebuild is on.
    SITE_REBUILD: z
      .string()
      .optional()
      .transform((s) => (s?.trim() === "on" ? ("on" as const) : undefined)),
  })
  .refine((e) => e.STUDIO_HOST !== e.PUBLIC_HOST, {
    message: "STUDIO_HOST and PUBLIC_HOST must differ",
    path: ["PUBLIC_HOST"],
  })
  .refine(
    (e) =>
      e.NODE_ENV === "development" ||
      ![e.STUDIO_HOST, e.PUBLIC_HOST, e.ACCESS_TEAM_DOMAIN].includes("localhost"),
    { message: "localhost is only allowed when NODE_ENV=development", path: ["STUDIO_HOST"] },
  )
  .refine((e) => !e.STUDIO_DEV_ADMIN || e.NODE_ENV === "development", {
    message: "STUDIO_DEV_ADMIN is only allowed when NODE_ENV=development",
    path: ["STUDIO_DEV_ADMIN"],
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(src: Record<string, string | undefined>): Env {
  return EnvSchema.parse(src);
}

// "on" where the token is visible (worker, local dev) or where compose passed the flag (app).
export function siteRebuild(e: Pick<Env, "GITHUB_DISPATCH_TOKEN" | "SITE_REBUILD">): "on" | "off" {
  return e.GITHUB_DISPATCH_TOKEN || e.SITE_REBUILD === "on" ? "on" : "off";
}

// Lazy on purpose: boringco's build broke because prerendering read server secrets.
let cached: Env | undefined;
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

// Tests only: lets a test change process.env and have env() re-read it.
export function __resetEnvCacheForTests(): void {
  cached = undefined;
}
