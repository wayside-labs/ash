import { BlogError } from "./errors";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// In production Next replaces the message of an error thrown by a server action with a generic
// one, so what the admin must read travels as a value. Only BlogError does: anything else is a
// bug or an outage and keeps being thrown, to be logged and shown as a failure.
export async function toResult<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    if (err instanceof BlogError) return { ok: false, error: err.message };
    throw err;
  }
}
