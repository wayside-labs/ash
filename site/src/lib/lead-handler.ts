import { validateLead, type Lead } from "./lead-schema";

// The subset of Cloudflare's D1 binding this module uses, so tests can pass a fake.
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>;
    };
  };
}
export interface LeadEnv {
  TURNSTILE_SECRET?: string;
  LISTMONK_URL?: string; LISTMONK_USER?: string; LISTMONK_TOKEN?: string; LISTMONK_LIST_ID?: string;
  CF_ACCESS_CLIENT_ID?: string; CF_ACCESS_CLIENT_SECRET?: string;
}
export interface LeadDeps { db: D1Like; fetch: typeof fetch; env: LeadEnv; now?: () => Date }
// ref: the lead's row id, handed to the browser so a later "yes, let's talk" can be tied to the
// lead without the browser ever holding the e-mail.
export interface LeadResponse { status: number; body: { ok: boolean; errors?: string[]; ref?: string } }

type Row = Pick<Lead, "name" | "role" | "kind" | "email" | "lang">;
const RETRY_BATCH = 5;

export async function handleLead(input: unknown, deps: LeadDeps): Promise<LeadResponse> {
  const { db, env } = deps;
  // Fail closed: without the secret there is no bot check, and an open write endpoint is worse
  // than a funnel that is briefly down.
  if (!env.TURNSTILE_SECRET) return { status: 503, body: { ok: false, errors: ["unavailable"] } };

  const token = input && typeof input === "object" ? (input as Record<string, unknown>).turnstileToken : undefined;
  if (!(await turnstileOk(deps, env.TURNSTILE_SECRET, token))) return { status: 400, body: { ok: false, errors: ["captcha"] } };

  const v = validateLead(input);
  if (!v.ok) return { status: 400, body: { ok: false, errors: v.errors } };
  const lead = v.lead;
  const at = (deps.now ?? (() => new Date()))().toISOString();

  // No IP, no user-agent: the privacy policy promises only what the form asked for.
  const row = await db
    .prepare(
      `INSERT INTO leads (id, created_at, updated_at, name, role, kind, email, lang, consent_at, listmonk_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT(email) DO UPDATE SET updated_at = excluded.updated_at, name = excluded.name,
         role = excluded.role, kind = excluded.kind, lang = excluded.lang, consent_at = excluded.consent_at
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), at, at, lead.name, lead.role, lead.kind, lead.email, lead.lang, at)
    .first<{ id: string }>();

  if (listmonkConfigured(env) && (await pushToListmonk(deps, lead))) {
    await markSent(db, lead.email);
    // Pages Functions have no cron, so the next lead that finds Listmonk up drains the backlog.
    const { results } = await db
      .prepare(`SELECT name, role, kind, email, lang FROM leads WHERE listmonk_status = 'pending' AND email != ? ORDER BY created_at LIMIT ${RETRY_BATCH}`)
      .bind(lead.email)
      .all<Row>();
    for (const r of results) if (await pushToListmonk(deps, r)) await markSent(db, r.email);
  }
  return { status: 200, body: row ? { ok: true, ref: row.id } : { ok: true } };
}

async function turnstileOk(deps: LeadDeps, secret: string, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !token) return false;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    const r = await deps.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}

const listmonkConfigured = (env: LeadEnv): boolean =>
  Boolean(env.LISTMONK_URL && env.LISTMONK_USER && env.LISTMONK_TOKEN && env.LISTMONK_LIST_ID);

async function pushToListmonk(deps: LeadDeps, lead: Row): Promise<boolean> {
  const { env } = deps;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Basic ${btoa(`${env.LISTMONK_USER}:${env.LISTMONK_TOKEN}`)}`,
  };
  // Listmonk sits behind Cloudflare Access; the service token is what lets this function through.
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["cf-access-client-id"] = env.CF_ACCESS_CLIENT_ID;
    headers["cf-access-client-secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }
  try {
    const r = await deps.fetch(`${env.LISTMONK_URL}/api/subscribers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: lead.email, name: lead.name, status: "enabled", lists: [Number(env.LISTMONK_LIST_ID)],
        attribs: { role: lead.role, kind: lead.kind, lang: lead.lang, source: "investor-pitch" },
        // Double opt-in: Listmonk e-mails a confirmation; no campaign reaches the lead before it.
        preconfirm_subscriptions: false,
      }),
    });
    // 409 = the address is already a subscriber, which is the outcome we wanted.
    return r.ok || r.status === 409;
  } catch {
    return false;
  }
}

const markSent = (db: D1Like, email: string) =>
  db.prepare("UPDATE leads SET listmonk_status = ? WHERE email = ?").bind("sent", email).run();
