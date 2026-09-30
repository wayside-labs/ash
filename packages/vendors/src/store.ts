import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * One JSON file per vendor. These are demo counterparties with a few thousand rows at
 * most; a database would be the first thing to cut when something breaks at 3am, and the
 * file is also what a tester opens to see what the vendor believes happened.
 *
 * Writes are serialised through one promise chain and land via rename, so a crash leaves
 * either the old file or the new one, never half of each.
 */
export class JsonFile<T> {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    public data: T,
  ) {}

  static async open<T>(path: string, empty: () => T): Promise<JsonFile<T>> {
    let data: T;
    try {
      data = JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      data = empty();
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    return new JsonFile(path, data);
  }

  save(): Promise<void> {
    const snapshot = `${JSON.stringify(this.data, null, 2)}\n`;
    const next = this.chain.then(async () => {
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.path);
    });
    // A failed write must not wedge every later one behind it.
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
