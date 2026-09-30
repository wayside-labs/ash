import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  connectorBundleSchema,
  connectorSecretEnv,
  extractConnectorProposals,
  forbiddenConnectorName,
} from "./connector-bundle.js";
import {
  ConnectorImportError,
  detectConnectorFormat,
  importConnectorDocument,
  importMarkdownConnector,
  splitFrontmatter,
} from "./connector-import.js";

// The same fixtures the Python host's pytest suite loads: this is the drift test.
const FIXTURES = join(import.meta.dirname, "../../../examples/connectors/fixtures");

function readDoc(path: string): unknown {
  const text = readFileSync(path, "utf8");
  return path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
}

function importFile(path: string) {
  const text = readFileSync(path, "utf8");
  if (detectConnectorFormat(path) === "markdown") {
    const split = splitFrontmatter(text);
    if (!split) throw new Error("no frontmatter");
    return importMarkdownConnector(parseYaml(split.frontmatter), split.body);
  }
  return importConnectorDocument(readDoc(path));
}

describe("connector bundle fixtures (shared with services/connector-host)", () => {
  for (const file of readdirSync(join(FIXTURES, "valid"))) {
    it(`accepts valid/${file}`, () => {
      const parsed = connectorBundleSchema.safeParse(readDoc(join(FIXTURES, "valid", file)));
      expect(parsed.error?.issues).toBeUndefined();
    });
  }
  for (const file of readdirSync(join(FIXTURES, "invalid"))) {
    it(`rejects invalid/${file}`, () => {
      expect(
        connectorBundleSchema.safeParse(readDoc(join(FIXTURES, "invalid", file))).success,
      ).toBe(false);
    });
  }
  for (const file of readdirSync(join(FIXTURES, "import")).filter(
    (f) => !f.endsWith(".expected.json"),
  )) {
    it(`imports import/${file} exactly as the Python loader does`, () => {
      const expected = JSON.parse(
        readFileSync(join(FIXTURES, "import", `${file.split(".")[0]}.expected.json`), "utf8"),
      );
      const result = importFile(join(FIXTURES, "import", file));
      expect(result.format).toBe(expected.format);
      expect(result.skipped).toEqual(expected.skipped);
      expect(result.bundle).toEqual(expected.bundle);
    });
  }
});

describe("forbiddenConnectorName", () => {
  it("matches whole tokens, not substrings", () => {
    expect(forbiddenConnectorName("design_review")).toBeNull();
    expect(forbiddenConnectorName("get_signature_status")).toBeNull();
    expect(forbiddenConnectorName("sign_tx")).toBe("sign");
    expect(forbiddenConnectorName("do_execute_payment_now")).toBe("execute_payment");
  });
});

describe("importConnectorDocument", () => {
  it("names phase-two formats instead of failing as a malformed bundle", () => {
    expect(() => importConnectorDocument({ info: { name: "c" }, item: [] })).toThrow(
      ConnectorImportError,
    );
    expect(() => importConnectorDocument({ swagger: "2.0" })).toThrow(/Swagger/);
  });
});

describe("extractConnectorProposals", () => {
  const bundle = {
    name: "weather",
    env: { WEATHER_API_KEY: "" },
    tools: [
      {
        name: "weather_now",
        url: "https://api.weather.example/now",
        headers: { Authorization: "Bearer {{ENV:WEATHER_API_KEY}}" },
      },
    ],
  };

  it("validates each fenced block", () => {
    const text = [
      "Here is the plan.",
      "```connector-bundle",
      JSON.stringify(bundle),
      "```",
      "and a bad one:",
      "```connector-bundle",
      JSON.stringify({ ...bundle, tools: [{ name: "withdraw_all", url: "https://x.example" }] }),
      "```",
      "```connector-bundle",
      "{ not json",
      "```",
    ].join("\n");
    const proposals = extractConnectorProposals(text);
    expect(proposals.map((p) => p.ok)).toEqual([true, false, false]);
    const [first, second] = proposals;
    if (!first?.ok) throw new Error("expected first proposal to parse");
    expect(connectorSecretEnv(first.bundle)).toEqual(["WEATHER_API_KEY"]);
    expect(second?.ok === false && second.error).toMatch(/withdraw/);
  });

  it("ignores other fences and unterminated blocks mid-stream", () => {
    expect(extractConnectorProposals("```json\n{}\n```")).toEqual([]);
    expect(extractConnectorProposals('```connector-bundle\n{"name":')).toEqual([]);
  });
});
