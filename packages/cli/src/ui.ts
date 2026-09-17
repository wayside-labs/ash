import pc from "picocolors";

/**
 * Terminal output for a command that spends real time and real lamports.
 *
 * Two rules shape this file. Everything human goes to stderr, so `--json` on stdout stays
 * a clean pipe (`agent-rails init --json | jq`). And every animation degrades to plain
 * lines when stderr is not a TTY, because the same command runs in CI logs and in a
 * hackathon terminal, and a log full of spinner escape codes is worse than no spinner.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 80;

export type Writer = { write: (chunk: string) => void; isTTY: boolean };

export function stderrWriter(): Writer {
  return {
    write: (chunk) => void process.stderr.write(chunk),
    isTTY: process.stderr.isTTY === true,
  };
}

export type UiOptions = {
  writer?: Writer;
  /** Suppresses every human line. Set by `--json`. */
  quiet?: boolean;
  /** Strips colour. Set by `--no-color`, `NO_COLOR`, or a non-TTY stderr. */
  color?: boolean;
};

export class Ui {
  readonly #writer: Writer;
  readonly #quiet: boolean;
  readonly #color: boolean;
  #timer: NodeJS.Timeout | undefined;
  #frame = 0;
  #text = "";

  constructor(options: UiOptions = {}) {
    this.#writer = options.writer ?? stderrWriter();
    this.#quiet = options.quiet ?? false;
    this.#color = options.color ?? (this.#writer.isTTY && !process.env.NO_COLOR);
  }

  #paint(value: string, paint: (s: string) => string): string {
    return this.#color ? paint(value) : value;
  }

  #line(text: string): void {
    if (this.#quiet) return;
    this.#writer.write(`${text}\n`);
  }

  /** Clears the spinner's line so the next write starts from a blank row. */
  #clear(): void {
    if (this.#writer.isTTY) this.#writer.write("\r\x1b[2K");
  }

  start(text: string): void {
    if (this.#quiet) return;
    this.#text = text;
    if (!this.#writer.isTTY) {
      this.#line(`${this.#paint("-", pc.dim)} ${text}`);
      return;
    }
    this.stop();
    this.#frame = 0;
    const tick = () => {
      const glyph = FRAMES[this.#frame % FRAMES.length] ?? "*";
      this.#frame += 1;
      this.#clear();
      this.#writer.write(`${this.#paint(glyph, pc.cyan)} ${this.#text}`);
    };
    tick();
    this.#timer = setInterval(tick, FRAME_MS);
    // A spinner must never be the reason a finished process stays alive.
    this.#timer.unref?.();
  }

  /** Replaces the spinner text in place, without starting a new line. */
  update(text: string): void {
    this.#text = text;
    if (!this.#writer.isTTY) this.#line(`${this.#paint("-", pc.dim)} ${text}`);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
      this.#clear();
    }
  }

  succeed(text: string, detail?: string): void {
    this.stop();
    const suffix = detail ? ` ${this.#paint(detail, pc.dim)}` : "";
    this.#line(`${this.#paint(SYMBOL.ok, pc.green)} ${text}${suffix}`);
  }

  /** A step that did nothing because the chain already had the account. */
  skip(text: string, detail?: string): void {
    this.stop();
    const suffix = detail ? ` ${this.#paint(detail, pc.dim)}` : "";
    this.#line(`${this.#paint(SYMBOL.skip, pc.dim)} ${this.#paint(text, pc.dim)}${suffix}`);
  }

  warn(text: string): void {
    this.stop();
    this.#line(`${this.#paint(SYMBOL.warn, pc.yellow)} ${text}`);
  }

  fail(text: string): void {
    this.stop();
    this.#line(`${this.#paint(SYMBOL.fail, pc.red)} ${text}`);
  }

  info(text: string): void {
    this.stop();
    this.#line(text);
  }

  blank(): void {
    this.#line("");
  }

  heading(text: string): void {
    this.stop();
    this.#line(this.#paint(text, pc.bold));
  }

  /** `label  value`, aligned into a column so a block of facts scans vertically. */
  field(label: string, value: string, width = 18): void {
    this.#line(`  ${this.#paint(label.padEnd(width), pc.dim)}${value}`);
  }

  code(text: string): void {
    for (const line of text.split("\n")) this.#line(`  ${this.#paint(line, pc.cyan)}`);
  }

  dim(text: string): string {
    return this.#paint(text, pc.dim);
  }

  bold(text: string): string {
    return this.#paint(text, pc.bold);
  }
}

export const SYMBOL = {
  ok: "✔",
  fail: "✖",
  warn: "!",
  skip: "•",
} as const;
