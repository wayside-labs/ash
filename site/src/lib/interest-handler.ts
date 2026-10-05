import type { D1Like, LeadEnv } from "./lead-handler";

// "Yes, let's talk" at the end of the investor pitch. The ref is the lead's random row id, so this
// endpoint needs no captcha: guessing a UUID only lets you mark someone as interested, and it
// never reads anything back.
export const CHANNELS = ["booking", "whatsapp", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InterestDeps { db: D1Like; env: LeadEnv; now?: () => Date }

export async function handleInterest(input: unknown, deps: InterestDeps): Promise<{ status: number; body: { ok: boolean } }> {
  // Same switch as the lead endpoint: while collection is off, nothing about a visitor is written.
  if (!deps.env.TURNSTILE_SECRET) return { status: 503, body: { ok: false } };
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (typeof o.ref !== "string" || !UUID.test(o.ref) || !CHANNELS.includes(o.channel as Channel)) {
    return { status: 400, body: { ok: false } };
  }
  const at = (deps.now ?? (() => new Date()))().toISOString();
  await deps.db
    .prepare("UPDATE leads SET interested_at = ?, interest_channel = ? WHERE id = ?")
    .bind(at, o.channel, o.ref)
    .run();
  return { status: 200, body: { ok: true } };
}
