import { describe, expect, it } from "vitest";
import { readZip } from "./__fixtures__/read-zip";
import { crc32, createZip } from "./zip";

describe("zip", () => {
  it("computes the standard CRC-32 check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips entries, including UTF-8 names", () => {
    const zip = createZip([
      { path: ".mcp.json", data: "{}\n" },
      { path: ".claude/skills/pagar/SKILL.md", data: "---\nname: pagar\n---\nção" },
    ]);
    expect(readZip(zip)).toEqual({
      ".mcp.json": "{}\n",
      ".claude/skills/pagar/SKILL.md": "---\nname: pagar\n---\nção",
    });
  });

  it("is deterministic", () => {
    const entries = [{ path: "a.txt", data: "x" }];
    expect(createZip(entries)).toEqual(createZip(entries));
  });

  it("refuses paths that climb out of the archive", () => {
    expect(() => createZip([{ path: "../etc/passwd", data: "" }])).toThrow(/unsafe/);
  });
});
