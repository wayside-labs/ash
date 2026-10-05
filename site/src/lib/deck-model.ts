// Pure navigation state for the pitch deck. The deck stops at both ends rather than wrapping: a
// presenter who taps past the last slide should stay on the ask, not land back on the hook.
export const clamp = (i: number, n: number): number => Math.min(Math.max(i, 0), n - 1);
export const next = (i: number, n: number): number => clamp(i + 1, n);
export const prev = (i: number, n: number): number => clamp(i - 1, n);

// The hash is 1-based so a shared link reads like the slide number people see (#3 = slide 3).
export function fromHash(hash: string, n: number): number {
  const m = /^#(\d+)$/.exec(hash);
  return m ? clamp(Number(m[1]) - 1, n) : 0;
}

export const total = (durations: readonly number[]): number => durations.reduce((a, b) => a + b, 0);

export function schedule(durations: readonly number[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const d of durations) { starts.push(t); t += d; }
  return starts;
}

export function slideAt(second: number, durations: readonly number[]): number {
  const starts = schedule(durations);
  let i = 0;
  for (let k = 0; k < starts.length; k++) if (second >= (starts[k] ?? 0)) i = k;
  return i;
}
