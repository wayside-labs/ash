import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An RPC proxy that forwards everything faithfully except what the caller asks it to blind.
 *
 * This reproduces the failure `sendPayment` and the MCP handlers are built around, and it is
 * not a mock: the transaction is relayed to the real validator, is executed, and settles.
 * What the client loses is the *answer* — `getSignatureStatuses` comes back with a null
 * status, as it does from a node that is lagging or behind a proxy that dropped the
 * response. `getAccountInfo` can be blinded per address to force resolution failure.
 *
 * Blinding the status read rather than dropping the send is deliberate. A dropped send is
 * the easy case — nothing happened. The dangerous case is the one where the money moved and
 * the caller cannot tell, because that is the one where a retry pays twice.
 */
export type BlindingProxy = {
  url: string;
  /** Stop blinding status reads; subsequent status reads are forwarded normally. */
  clearBlind: () => void;
  /** Blind `getSignatureStatuses` for every signature. */
  blindAllStatuses: () => void;
  /** Alias for `blindAllStatuses` / `clearBlind` used by the MCP handler E2E suite. */
  get blindSignatureStatuses(): boolean;
  set blindSignatureStatuses(value: boolean);
  /** Addresses whose `getAccountInfo` reads report the account as absent. */
  blindAccounts: Set<string>;
  /** Requests seen, in order, for assertions about what the client actually did. */
  calls: string[];
  stop: () => Promise<void>;
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

type BlindState = { blindSignatureStatuses: boolean; blindAccounts: Set<string> };

/** The blinded answer for one request, or `undefined` to pass it upstream. */
function synthesize(entry: JsonRpcRequest, state: BlindState): unknown | undefined {
  if (entry.method === "getSignatureStatuses" && state.blindSignatureStatuses) {
    const signatures = (entry.params?.[0] as string[] | undefined) ?? [];
    return {
      jsonrpc: "2.0",
      id: entry.id,
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

export async function startBlindingProxy(upstreamUrl: string): Promise<BlindingProxy> {
  const calls: string[] = [];
  const state: BlindState = {
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
    clearBlind: () => {
      state.blindSignatureStatuses = false;
    },
    blindAllStatuses: () => {
      state.blindSignatureStatuses = true;
    },
    get blindSignatureStatuses() {
      return state.blindSignatureStatuses;
    },
    set blindSignatureStatuses(value: boolean) {
      state.blindSignatureStatuses = value;
    },
    blindAccounts: state.blindAccounts,
    calls,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
