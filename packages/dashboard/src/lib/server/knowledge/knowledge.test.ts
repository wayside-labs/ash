import { describe, expect, it } from "vitest";
import { extractDocument } from "./index";
import { assertPublicUrl, isPrivateAddress, safeFetch, UnsafeUrlError } from "./safe-fetch";
import { bm25, chunkText, cosine, htmlToText } from "./text";

/** A one-page PDF with the text "Agent Rails refunds policy", built by hand so no fixture file is needed. */
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("text", () => {
  it("strips markup, scripts and entities but keeps paragraphs", () => {
    const text = htmlToText(
      "<html><script>evil()</script><h1>Refunds</h1><p>Within 30 days &amp; unused.</p></html>",
    );
    expect(text).toBe("Refunds\n\nWithin 30 days & unused.");
  });

  it("chunks with overlap and splits oversize paragraphs", () => {
    const chunks = chunkText(`${"a".repeat(100)}\n\n${"b".repeat(3_000)}`, 1_000, 100);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1_000)).toBe(true);
    expect(chunkText("   ")).toEqual([]);
  });

  it("ranks the chunk that mentions the query first", () => {
    const scores = bm25("refund window", [
      "shipping takes five days",
      "the refund window is thirty days",
      "contact support",
    ]);
    expect(scores.indexOf(Math.max(...scores))).toBe(1);
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});

describe("safe fetch", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it("allows a public address", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("refuses private resolution, odd schemes and credentials", async () => {
    const toPrivate = async () => ["10.0.0.5"];
    await expect(assertPublicUrl("https://internal.example", toPrivate)).rejects.toThrow(
      UnsafeUrlError,
    );
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("https://u:p@example.com")).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("re-checks every redirect hop", async () => {
    const resolve = async (host: string) =>
      host === "public.example" ? ["93.184.216.34"] : ["10.0.0.1"];
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://internal.example/secret" },
      })) as unknown as typeof fetch;
    await expect(
      safeFetch("https://public.example/doc", {
        maxBytes: 1_000,
        timeoutMs: 1_000,
        resolve,
        fetchImpl,
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("stops reading past the size cap", async () => {
    const resolve = async () => ["93.184.216.34"];
    const fetchImpl = (async () =>
      new Response("x".repeat(5_000), {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    await expect(
      safeFetch("https://public.example/big", {
        maxBytes: 1_000,
        timeoutMs: 1_000,
        resolve,
        fetchImpl,
      }),
    ).rejects.toThrow(/larger/);
  });
});

describe("extraction", () => {
  it("reads the text out of a real PDF", async () => {
    const { text, kind } = await extractDocument({
      type: "pdf",
      bytes: tinyPdf("Agent Rails refunds policy"),
    });
    expect(kind).toBe("pdf");
    expect(text).toContain("Agent Rails refunds policy");
  });
});
