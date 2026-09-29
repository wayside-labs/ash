import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hashToken, newIngestToken, reviewExpiry, reviewKey, shouldOpenReview } from "./logic";
import {
  EVENTS_PAGE,
  type IngestToken,
  isLive,
  MAX_JSON_EVENTS,
  type OpsStore,
  type Review,
  type StoredEvent,
  tokenHint,
} from "./types";

type OpsFile = { tokens: IngestToken[]; events: StoredEvent[]; reviews: Review[] };

/** Next to `dashboard.json`, same home the CLI uses. Mode 0600: it holds bearer tokens. */
export function opsPath(): string {
  const home = process.env.AGENT_RAILS_HOME ?? join(homedir(), ".agent-rails");
  return join(home, "dashboard-ops.json");
}

let chain: Promise<unknown> = Promise.resolve();

async function load(): Promise<OpsFile> {
  try {
    const parsed = JSON.parse(await readFile(opsPath(), "utf8")) as Partial<OpsFile>;
    return {
      tokens: parsed.tokens ?? [],
      events: parsed.events ?? [],
      reviews: parsed.reviews ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { tokens: [], events: [], reviews: [] };
  }
}

async function save(file: OpsFile): Promise<void> {
  const path = opsPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

/** Read-modify-write under one chain, like `store-json.ts`. */
function mutate<T>(fn: (file: OpsFile) => T): Promise<T> {
  const run = async () => {
    const file = await load();
    const result = fn(file);
    await save(file);
    return result;
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

const JSON_SCOPE = { kind: "json" } as const;

export const jsonOpsStore: OpsStore = {
  issueToken: (_scope, workflowId) =>
    mutate((file) => {
      const now = new Date().toISOString();
      // One live token per workflow: issuing a new one retires the old, so a leaked token
      // is closed by the same click that replaces it.
      for (const t of file.tokens) {
        if (t.workflowId === workflowId && !t.revokedAt) t.revokedAt = now;
      }
      const token = newIngestToken();
      const row: IngestToken = {
        id: `ing_${randomUUID().slice(0, 8)}`,
        workflowId,
        tokenHash: hashToken(token),
        token,
        createdAt: now,
        revokedAt: null,
      };
      file.tokens.push(row);
      return { id: row.id, token };
    }),

  async listTokens(_scope, workflowId) {
    const file = await load();
    return file.tokens
      .filter((t) => !workflowId || t.workflowId === workflowId)
      .map(({ token, tokenHash: _hash, ...rest }) => ({ ...rest, hint: tokenHint(token) }));
  },

  async activeToken(_scope, workflowId) {
    const file = await load();
    return file.tokens.find((t) => t.workflowId === workflowId && !t.revokedAt)?.token ?? null;
  },

  revokeToken: (_scope, id) =>
    mutate((file) => {
      const row = file.tokens.find((t) => t.id === id && !t.revokedAt);
      if (!row) return false;
      row.revokedAt = new Date().toISOString();
      return true;
    }),

  async resolveToken(token) {
    const hash = hashToken(token);
    const file = await load();
    const row = file.tokens.find((t) => t.tokenHash === hash && !t.revokedAt);
    return row ? { scope: JSON_SCOPE, workflowId: row.workflowId } : null;
  },

  recordEvent: (_scope, workflowId, event) =>
    mutate((file) => {
      const now = new Date();
      const stored: StoredEvent = {
        id: `evt_${randomUUID().slice(0, 8)}`,
        workflowId,
        kind: event.kind,
        event,
        receivedAt: now.toISOString(),
      };
      file.events.push(stored);
      if (file.events.length > MAX_JSON_EVENTS)
        file.events.splice(0, file.events.length - MAX_JSON_EVENTS);

      const key = reviewKey(event);
      if (!key) return { eventId: stored.id, review: null };
      const existing =
        key.intentId === null
          ? null
          : (file.reviews.find((r) => r.workflowId === workflowId && r.intentId === key.intentId) ??
            null);
      if (!shouldOpenReview(existing, now.getTime()))
        return { eventId: stored.id, review: existing };

      const review: Review = {
        id: existing?.id ?? `rev_${randomUUID().slice(0, 8)}`,
        workflowId,
        kind: key.kind,
        intentId: key.intentId,
        status: "pending",
        event,
        createdAt: now.toISOString(),
        decidedAt: null,
        decidedBy: null,
        expiresAt: reviewExpiry(now.getTime()),
      };
      if (existing) Object.assign(existing, review);
      else file.reviews.push(review);
      return { eventId: stored.id, review };
    }),

  async reviewForIntent(_scope, workflowId, intentId) {
    const file = await load();
    const review = file.reviews.find((r) => r.workflowId === workflowId && r.intentId === intentId);
    return review && isLive(review) ? review : null;
  },

  async listEvents(_scope, limit = EVENTS_PAGE) {
    const file = await load();
    return file.events.slice(-limit).reverse();
  },

  async listReviews(_scope, status) {
    const file = await load();
    return file.reviews
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  decideReview: (_scope, id, decision, decidedBy) =>
    mutate((file) => {
      const review = file.reviews.find((r) => r.id === id);
      // Only a live, pending review can be decided: a decision is not editable afterwards,
      // and a lapsed request is answered by the agent asking again.
      if (!review) return null;
      if (review.status !== "pending" || !isLive(review)) return null;
      const now = Date.now();
      review.status = decision;
      review.decidedAt = new Date(now).toISOString();
      review.decidedBy = decidedBy;
      review.expiresAt = reviewExpiry(now);
      return review;
    }),
};
