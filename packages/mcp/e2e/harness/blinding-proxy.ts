import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A JSON-RPC proxy that can stop answering specific questions.
 *
 * This is the whole reason the E2E suite can reproduce the original defect against a real
 * validator. The transaction genuinely lands — real slots, real ledger, real receipt — while
 * the client is prevented from learning that it did. Nothing about the send path is faked;
 * only the client's view of the outcome is.
 *
 * `blindSignatureStatuses` models the ordinary case this defect needed: a node that has the
 * transaction but has not surfaced a status for it before the client's deadline.
 *
 * `blindAccounts` is fault injection rather than a claim about real nodes. It exists to
 * force the branch where resolution itself fails, which is rare in practice and is exactly
 * the branch that must not end in a second payment.
 */

export type BlindingProxy = {
  url: string;
  /** Stop answering `getSignatureStatuses`; report every signature as unknown. */
  blindSignatureStatuses: boolean;
  /** Addresses whose `getAccountInfo` reads report the account as absent. */
  blindAccounts: Set<string>;
  /** Every method name the client has asked for, in order. */
  readonly calls: string[];
  close(): Promise<void>;
};

type JsonRpcRequest = {
  jsonrpc: string;
  id: unknown;
  method: string;
  params?: unknown[];
};

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

export async function startBlindingProxy(upstreamUrl: string): Promise<BlindingProxy> {
  const calls: string[] = [];
  const state = {
    blindSignatureStatuses: false,
    blindAccounts: new Set<string>(),
  };

  const server: Server = createServer(async (request, response) => {
    try {
      const raw = await readBody(request);
      const payload = JSON.parse(raw) as JsonRpcRequest | JsonRpcRequest[];
      const batch = Array.isArray(payload) ? payload : [payload];
      for (const entry of batch) calls.push(entry.method);

      const synthetic = batch.map((entry) => synthesize(entry, state));

      // Anything not blinded goes upstream untouched, so the client is talking to a real
      // validator for every question except the ones under test.
      if (synthetic.every((value) => value === undefined)) {
        const upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
        });
        const text = await upstream.text();
        response.writeHead(upstream.status, { "content-type": "application/json" });
        response.end(text);
        return;
      }

      const merged = await mergeWithUpstream(upstreamUrl, batch, synthetic);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(Array.isArray(payload) ? merged : merged[0]));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32_603, message: String(error) },
        }),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    get blindSignatureStatuses() {
      return state.blindSignatureStatuses;
    },
    set blindSignatureStatuses(value: boolean) {
      state.blindSignatureStatuses = value;
    },
    get blindAccounts() {
      return state.blindAccounts;
    },
    calls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

type BlindState = { blindSignatureStatuses: boolean; blindAccounts: Set<string> };

/** The blinded answer for one request, or `undefined` to pass it upstream. */
function synthesize(entry: JsonRpcRequest, state: BlindState): unknown | undefined {
  if (entry.method === "getSignatureStatuses" && state.blindSignatureStatuses) {
    const signatures = (entry.params?.[0] as string[] | undefined) ?? [];
    return {
      jsonrpc: "2.0",
      id: entry.id,
      // The shape a node returns for a signature it has never seen.
      result: { context: { slot: 0 }, value: signatures.map(() => null) },
    };
  }

  if (entry.method === "getAccountInfo") {
    const address = entry.params?.[0];
    if (typeof address === "string" && state.blindAccounts.has(address)) {
      return { jsonrpc: "2.0", id: entry.id, result: { context: { slot: 0 }, value: null } };
    }
  }

  return undefined;
}

/**
 * Forward the entries that are not blinded and splice the synthetic answers back in, so a
 * batch containing one blinded call still gets real answers for the rest.
 */
async function mergeWithUpstream(
  upstreamUrl: string,
  batch: JsonRpcRequest[],
  synthetic: Array<unknown | undefined>,
): Promise<unknown[]> {
  const passthroughIndexes = synthetic
    .map((value, index) => (value === undefined ? index : -1))
    .filter((index) => index >= 0);

  const answers: unknown[] = [...synthetic];

  if (passthroughIndexes.length > 0) {
    const forwarded = passthroughIndexes.map((index) => batch[index]);
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(forwarded.length === 1 ? forwarded[0] : forwarded),
    });
    const body = (await upstream.json()) as unknown;
    const list = Array.isArray(body) ? body : [body];
    passthroughIndexes.forEach((index, position) => {
      answers[index] = list[position];
    });
  }

  return answers;
}
