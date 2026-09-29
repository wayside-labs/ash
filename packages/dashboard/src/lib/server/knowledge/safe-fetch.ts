import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetching a URL an operator typed, from a server that sits next to other services.
 *
 * Without this, "index this URL" is a request forgery primitive: `http://127.0.0.1:3000`,
 * `http://169.254.169.254/` (cloud metadata), a Postgres admin panel on the private network.
 * So: http(s) only; every address the name resolves to must be public; redirects are
 * followed by hand so each hop is checked again; size and time are capped.
 *
 * DNS rebinding between the check and the connect is not closed here — that needs pinning
 * the connection to the checked address. The size, time and scheme caps bound what a
 * rebinding attacker could read back, and the result only ever becomes indexed text.
 */

export class UnsafeUrlError extends Error {}

const MAX_REDIRECTS = 3;

function ipv4Private(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4Private(ip);
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return ipv4Private(mapped[1]);
  return (
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

export async function assertPublicUrl(
  raw: string,
  resolve: Resolver = systemResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("only http and https URLs can be indexed");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are refused");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0) throw new UnsafeUrlError("host does not resolve");
  if (addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError("host resolves to a private, loopback or link-local address");
  }
  return url;
}

export type SafeFetchResult = { bytes: Uint8Array; contentType: string; finalUrl: string };

export async function safeFetch(
  raw: string,
  options: {
    maxBytes: number;
    timeoutMs: number;
    resolve?: Resolver;
    fetchImpl?: typeof fetch;
  },
): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs);
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, options.resolve);
    const res = await fetchImpl(url, { redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new UnsafeUrlError(`redirect ${res.status} without a location`);
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > options.maxBytes) throw new Error("document is larger than the limit");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > options.maxBytes) {
          await reader.cancel();
          throw new Error("document is larger than the limit");
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { bytes, contentType: res.headers.get("content-type") ?? "", finalUrl: url.toString() };
  }
  throw new UnsafeUrlError("too many redirects");
}
