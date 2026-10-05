import { MAX_BODY_HTML_LENGTH } from "@/blog/lib/body-content";
import config from "../next.config";

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

function bytes(limit: unknown): number {
  if (typeof limit === "number") return limit;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(String(limit));
  if (!match) throw new Error(`not a size: ${String(limit)}`);
  return Number(match[1]) * (UNITS[(match[2] as string).toLowerCase()] as number);
}

describe("limites de corpo no next.config", () => {
  it("uma server action aceita o maior post que o schema aceita", () => {
    const action = bytes(config.experimental?.serverActions?.bodySizeLimit);
    // A character of the body costs at most three bytes in UTF-8 (an astral one is two
    // characters and four bytes). The rest of the document is a few kB.
    expect(action).toBeGreaterThanOrEqual(MAX_BODY_HTML_LENGTH * 3 + 64 * 1024);
  });

  it("o proxy não corta o corpo de uma action antes do limite dela", () => {
    const action = bytes(config.experimental?.serverActions?.bodySizeLimit);
    const proxy = bytes(config.experimental?.proxyClientMaxBodySize);
    expect(proxy).toBeGreaterThanOrEqual(action);
  });
});
