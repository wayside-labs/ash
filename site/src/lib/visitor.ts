import { KINDS, type Kind } from "./lead-schema";

// What the browser remembers about someone who filled the investor form: enough to say hello
// again, never the e-mail. ref is the lead's random row id (only when collection is on), used to
// tie "yes, let's talk" to the lead. Storage can be blocked or wiped, so every access is guarded
// and a missing value just means the form shows again.
export interface Visitor { name: string; kind: Kind; ref?: string }
const KEY = "ash.visitor";

export function loadVisitor(): Visitor | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Visitor>;
    if (typeof v.name !== "string" || !v.name.trim() || !KINDS.includes(v.kind as Kind)) return null;
    const out: Visitor = { name: v.name.trim().slice(0, 80), kind: v.kind as Kind };
    if (typeof v.ref === "string" && v.ref.length <= 64) out.ref = v.ref;
    return out;
  } catch {
    return null;
  }
}

export function saveVisitor(v: Visitor): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v.ref ? { name: v.name, kind: v.kind, ref: v.ref } : { name: v.name, kind: v.kind }));
  } catch {
    // Private mode or blocked storage: the visitor just sees the form next time.
  }
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name.trim();
export const fill = (template: string, name: string): string => template.split("{name}").join(name);
