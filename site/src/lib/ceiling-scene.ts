import { apply, freshState, type Policy, type State, type Verdict } from "./ceiling-model";

export interface SceneLabels { balance: string; ceiling: string; hint: string; settled: string; refused: string; unknown: string }
export interface SceneColors { accent: string; deny: string; settle: string; muted: string; ink: string; line: string; surface: string }

interface Flying {
  id: string; to: string; amount: number;
  x: number; y: number; tx: number; ty: number;
  verdict: Verdict | null; born: number; decidedAt: number;
}

const DESTS = ["rpc-vendor", "inference", "unknown"] as const;
const MAX = 500;
const SPAWN_MS = 900;

// The whole page is one diagram: money leaves the treasury, crosses the ceiling, reaches a
// destination or stops dead at the gate with the reason the program would give.
export function mountCeilingScene(canvas: HTMLCanvasElement, labels: SceneLabels, colors: SceneColors): { destroy(): void } {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { destroy() {} };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const policy: Policy = { perTxMax: 250, windowBudget: Number.MAX_SAFE_INTEGER, allowed: DESTS.slice(0, 2), paused: false };
  let state: State = freshState();
  let flying: Flying[] = [];
  let W = 0, H = 0, ceilingFrac = 0.5, lastId = "", lastSpawn = 0, raf = 0;
  let dragging = false, dragged = false, visible = true, settled = 0, refused = 0;

  const font = (px: number) => `${px}px "IBM Plex Mono", ui-monospace, monospace`;
  const top = () => H * 0.14, bottom = () => H * 0.86;
  const amountToY = (a: number) => bottom() - (a / MAX) * (bottom() - top());
  const yToFrac = (y: number) => Math.min(0.96, Math.max(0.06, (bottom() - y) / (bottom() - top())));
  const colX = () => W * 0.13, gateX = () => W * 0.5, destX = () => W * 0.74, destW = () => W * 0.24;
  const destY = (i: number) => top() + (i + 0.5) * ((bottom() - top()) / 3);
  const ceilingY = () => amountToY(ceilingFrac * MAX);

  function layout(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduced) drawStatic();
  }

  function spawn(now: number): void {
    const dup = lastId !== "" && Math.random() < 0.12;
    const id = dup ? lastId : `i${now}`;
    lastId = id;
    const ti = Math.floor(Math.random() * DESTS.length);
    const amount = 20 + Math.floor(Math.random() * (MAX - 40));
    // tx stops well clear of the destination box's left edge (destX()-8) so the marker never
    // touches, let alone overlaps, the box's own label.
    flying.push({ id, to: DESTS[ti]!, amount, x: colX() + 26, y: amountToY(amount), tx: destX() - 24, ty: destY(ti), verdict: null, born: now, decidedAt: 0 });
  }

  function step(now: number): void {
    policy.perTxMax = Math.round(ceilingFrac * MAX);
    for (const f of flying) {
      if (f.verdict === null) {
        f.x += (gateX() - f.x) * 0.08 + 1.5;
        if (f.x >= gateX() - 1) {
          const r = apply(policy, state, f);
          f.verdict = r.verdict; state = r.state; f.decidedAt = now;
          if (r.verdict === "settled") settled++; else refused++;
        }
      } else if (f.verdict === "settled") {
        f.x += (f.tx - f.x) * 0.1; f.y += (f.ty - f.y) * 0.1;
      }
    }
    flying = flying.filter((f) => f.verdict === null || now - f.decidedAt < 1500);
  }

  function drawFrame(): void {
    const c = ctx!;
    c.clearRect(0, 0, W, H);
    const t = top(), b = bottom();
    c.lineWidth = 1; c.strokeStyle = colors.line; c.fillStyle = colors.surface;
    c.fillRect(colX() - 22, t, 44, b - t); c.strokeRect(colX() - 22, t, 44, b - t);
    c.globalAlpha = 0.16; c.fillStyle = colors.accent; c.fillRect(colX() - 22, t + (b - t) * 0.3, 44, (b - t) * 0.7); c.globalAlpha = 1;
    c.font = font(11); c.textAlign = "center"; c.fillStyle = colors.muted; c.fillText(labels.balance, colX(), b + 18);

    DESTS.forEach((d, i) => {
      const y = destY(i), unknown = i === 2;
      c.strokeStyle = unknown ? colors.deny : colors.line; c.setLineDash(unknown ? [3, 3] : []);
      c.strokeRect(destX() - 8, y - 14, destW(), 28); c.setLineDash([]);
      c.fillStyle = unknown ? colors.deny : colors.ink; c.textAlign = "left"; c.font = font(W < 480 ? 10 : 11);
      c.fillText(unknown ? labels.unknown : d, destX(), y + 4);
    });

    const cy = ceilingY();
    c.strokeStyle = colors.accent; c.lineWidth = 2; c.setLineDash([6, 4]);
    c.beginPath(); c.moveTo(colX() + 30, cy); c.lineTo(destX() - 16, cy); c.stroke();
    c.setLineDash([]); c.lineWidth = 1;
    // Label sits at the treasury end of the line, clear of the destination boxes on the right.
    c.fillStyle = colors.accent; c.font = font(W < 480 ? 10 : 12); c.textAlign = "left";
    c.fillText(`${labels.ceiling} ≤ ${policy.perTxMax}`, colX() + 32, cy - 9);
    c.fillRect(gateX() - 14, cy - 6, 28, 12);
    if (!dragged) { c.fillStyle = colors.muted; c.font = font(11); c.textAlign = "center"; c.fillText(labels.hint, gateX(), cy + 26); }

    for (const f of flying) {
      const no = f.verdict !== null && f.verdict !== "settled";
      const arrived = f.verdict === "settled" && Math.abs(f.x - f.tx) < 14;
      c.fillStyle = no ? colors.deny : f.verdict === "settled" ? colors.settle : colors.ink;
      c.fillRect(f.x - 5, f.y - 5, 10, 10);
      // A settled payment that has reached its box would print its amount right on top of the
      // box's own label — the marker landing is signal enough. A refusal that lands close to the
      // ceiling's own label is nudged clear of it instead of printing through it.
      if (arrived) continue;
      let ly = f.y + 4;
      if (no && Math.abs(ly - (cy - 9)) < 16) ly = cy + 20;
      c.textAlign = "left"; c.fillStyle = no ? colors.deny : colors.muted;
      const lx = f.x + 10;
      let text = no ? (f.verdict as string) : String(f.amount);
      c.font = font(11);
      if (no) {
        // A reason code (EXCEEDS_PER_TX_MAX, DESTINATION_NOT_ALLOWED…) can run past the
        // treasury→destination gap on a narrow panel; shrink it, then truncate, before it
        // reaches the destination box.
        const room = destX() - 12 - lx;
        if (c.measureText(text).width > room) {
          c.font = font(9);
          if (c.measureText(text).width > room) {
            while (text.length > 1 && c.measureText(text + "…").width > room) text = text.slice(0, -1);
            text += "…";
          }
        }
      }
      c.fillText(text, lx, ly);
    }
    c.font = font(11); c.textAlign = "left";
    c.fillStyle = colors.settle; c.fillText(`${settled} ${labels.settled}`, colX() - 22, t - 14);
    c.fillStyle = colors.deny; c.fillText(`${refused} ${labels.refused}`, colX() + 60, t - 14);
  }

  function drawStatic(): void {
    flying = [
      { id: "s", to: "rpc-vendor", amount: 120, x: destX() - 24, y: destY(0), tx: destX() - 24, ty: destY(0), verdict: "settled", born: 0, decidedAt: 0 },
      { id: "r", to: "inference", amount: 410, x: gateX(), y: amountToY(410), tx: 0, ty: 0, verdict: "EXCEEDS_PER_TX_MAX", born: 0, decidedAt: 0 },
    ];
    settled = 1; refused = 1; dragged = true;
    drawFrame();
  }

  function loop(now: number): void {
    if (now - lastSpawn > SPAWN_MS) { spawn(now); lastSpawn = now; }
    step(now); drawFrame();
    if (visible) raf = requestAnimationFrame(loop);
  }

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const r = canvas.getBoundingClientRect();
    ceilingFrac = yToFrac(e.clientY - r.top);
    if (reduced) drawStatic();
  };
  const onDown = (e: PointerEvent) => { dragging = true; dragged = true; canvas.setPointerCapture(e.pointerId); onMove(e); };
  const onUp = () => { dragging = false; };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault(); dragged = true;
    ceilingFrac = Math.min(0.96, Math.max(0.06, ceilingFrac + (e.key === "ArrowUp" ? 0.05 : -0.05)));
    if (reduced) drawStatic();
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(layout); ro.observe(canvas);
  layout();
  const io = new IntersectionObserver(([en]) => {
    visible = !!en?.isIntersecting;
    if (visible && !reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
  });
  io.observe(canvas);

  return {
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("keydown", onKey);
    },
  };
}
