import { createServer, type Server } from "node:http";

/**
 * An RPC proxy that forwards everything faithfully except what the caller asks it to blind.
 *
 * This reproduces the failure `sendPayment` is built around, and it is not a mock: the
 * transaction is relayed to the real validator, is executed, and settles. What the client
 * loses is the *answer* — `getSignatureStatuses` comes back with a null status forever, as
 * it does from a node that is lagging, load-shedding, or behind a proxy that dropped the
 * response. The payment is real and the confirmation is missing, which is exactly the state
 * that makes "denied" a dangerous thing to report.
 *
 * Blinding the status read rather than dropping the send is deliberate. A dropped send is
 * the easy case — nothing happened. The dangerous case is the one where the money moved and
 * the caller cannot tell, because that is the one where a retry pays twice.
 */
export type BlindingProxy = {
  url: string;
  /** Stop blinding; subsequent status reads are forwarded normally. */
  clearBlind: () => void;
  /** Blind `getSignatureStatuses` for every signature. */
  blindAllStatuses: () => void;
  /** Requests seen, in order, for assertions about what the client actually did. */
  calls: string[];
  stop: () => Promise<void>;
};

export async function startBlindingProxy(upstreamUrl: string): Promise<BlindingProxy> {
  let blinding = false;
  const calls: string[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed: { id?: unknown; method?: string; params?: unknown } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* forwarded verbatim below */
      }
      if (typeof parsed.method === "string") calls.push(parsed.method);

      if (blinding && parsed.method === "getSignatureStatuses") {
        // Shape-accurate: a real node that has not seen the signature yet answers with a
        // context and an array of nulls, not an error. Returning an error instead would
        // exercise the transport-failure branch rather than the timeout branch.
        const signatures = Array.isArray((parsed.params as unknown[])?.[0])
          ? ((parsed.params as unknown[])[0] as unknown[])
          : [];
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id ?? null,
          result: { context: { slot: 0 }, value: signatures.map(() => null) },
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
        return;
      }

      try {
        const upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, { "content-type": "application/json" });
        res.end(text);
      } catch (error) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id ?? null,
            error: { code: -32603, message: `proxy upstream failure: ${String(error)}` },
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("blinding proxy did not bind a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    clearBlind: () => {
      blinding = false;
    },
    blindAllStatuses: () => {
      blinding = true;
    },
    calls,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
