import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, so the harness works whatever directory vitest was invoked from. */
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

/** An unused TCP port, claimed and released so surfpool can bind it. */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") return rej(new Error("no port"));
      const { port } = addr;
      srv.close(() => res(port));
    });
  });
}

/**
 * A Surfpool surfnet: a real Solana validator, forked from a live cluster.
 *
 * This is layer 5 of the ADR-008 pyramid and the only layer where the TypeScript client
 * talks to a validator at all. `litesvm` executes instructions; it does not have a
 * blockhash that expires, a `getSignatureStatuses` that lags behind inclusion, or a
 * confirmation that can be waited on and time out. Every one of those is load-bearing in
 * `sendPayment`, and none of them can be exercised without an RPC on the other end.
 *
 * Forked from devnet rather than run empty: the fork means accounts the test does not
 * create are fetched from the real cluster, so a missing sysvar or a program-owned account
 * the handler reads is a real fetch over the network rather than a hole the harness
 * papered over.
 */
export type Surfnet = {
  rpcUrl: string;
  wsUrl: string;
  /** Funded payer, used for rent and as the treasury owner. */
  payerKeypairPath: string;
  stop: () => void;
};

const PROGRAM_ID = "4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS";

function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());
}

/**
 * Wait for *this* surfnet, not merely for something answering on the port.
 *
 * `exited` is checked on every pass because the first version of this harness polled a
 * stray surfpool left over from an earlier run: the child had died on "port already in
 * use", the health check passed against the other process, and the suite went on to test a
 * validator it had not deployed to. A liveness probe that cannot tell whose liveness it is
 * measuring is worse than none.
 */
async function waitForRpc(
  url: string,
  timeoutMs: number,
  exited: () => number | null,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const code = exited();
    if (code !== null) throw new Error(`surfpool exited with code ${code} before serving RPC`);
    try {
      const body = (await rpc(url, "getHealth")) as { result?: string };
      if (body.result === "ok") return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`surfnet RPC never became healthy at ${url}: ${String(lastError)}`);
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} ${args.join(" ")}\n${err || out}`)),
    );
    child.on("error", reject);
  });
}

/**
 * Boot a surfnet, fund a payer, and deploy the program onto it.
 *
 * The deploy is explicit rather than left to Surfpool's manifest loading, which does not
 * fire under `--ci`. An explicit deploy also fails loudly with the reason, where a silent
 * no-deploy surfaces much later as "account not found" from the first instruction.
 */
export async function startSurfnet(options?: {
  port?: number;
  network?: "devnet" | "mainnet";
}): Promise<Surfnet> {
  const port = options?.port ?? (await freePort());
  // Surfpool's websocket defaults to 8900 regardless of --port, so it must be pinned too:
  // `solana program deploy` opens a TPU client over it and panics on connection refused.
  const wsPort = await freePort();
  const network = options?.network ?? "devnet";
  const rpcUrl = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), "agent-rails-e2e-"));

  const child: ChildProcess = spawn(
    "surfpool",
    ["start", "--ci", "-n", network, "-p", String(port), "-w", String(wsPort), "--no-studio"],
    { stdio: ["ignore", "pipe", "pipe"], detached: false },
  );
  let exitCode: number | null = null;
  child.on("exit", (code) => {
    exitCode = code ?? -1;
  });
  let surfpoolLog = "";
  child.stdout?.on("data", (d) => {
    surfpoolLog += String(d);
  });
  child.stderr?.on("data", (d) => {
    surfpoolLog += String(d);
  });

  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    await waitForRpc(rpcUrl, 90_000, () => exitCode);

    const payerKeypairPath = join(dir, "payer.json");
    await run("solana-keygen", [
      "new",
      "-o",
      payerKeypairPath,
      "--no-bip39-passphrase",
      "--silent",
    ]);
    await run("solana", ["airdrop", "100", "--keypair", payerKeypairPath, "--url", rpcUrl]);

    // `--url` is spelled with the loopback address on purpose: .claude/hooks/guard.sh
    // denies a deploy that is not explicitly pinned to loopback, which is what keeps this
    // harness from ever being pointed at a cluster holding custody (ADR-011).
    await run("solana", [
      "program",
      "deploy",
      join(REPO_ROOT, "target/deploy/agent_rails.so"),
      "--program-id",
      join(REPO_ROOT, "target/deploy/agent_rails-keypair.json"),
      "--keypair",
      payerKeypairPath,
      "--url",
      rpcUrl,
      // Submit the deploy over RPC rather than opening a TPU/QUIC client. The TPU path
      // needs the websocket and a leader schedule; a surfnet has neither in the shape the
      // CLI expects, and it panics rather than failing.
      "--use-rpc",
    ]);

    // Poll rather than read once. `solana program deploy` returns when the final
    // transaction is confirmed, but the account read that follows can still be served from
    // a slot before the program became executable — a single sample passes on a workstation
    // and fails on a loaded CI runner, which is precisely the flake worth not shipping.
    let executable = false;
    const deployDeadline = Date.now() + 30_000;
    while (Date.now() < deployDeadline && !executable) {
      const account = (await rpc(rpcUrl, "getAccountInfo", [
        PROGRAM_ID,
        { encoding: "base64", commitment: "confirmed" },
      ])) as { result?: { value?: { executable?: boolean } | null } };
      executable = account.result?.value?.executable === true;
      if (!executable) await new Promise((r) => setTimeout(r, 500));
    }
    if (!executable) {
      throw new Error(`program ${PROGRAM_ID} is not executable 30s after a successful deploy`);
    }

    return { rpcUrl, wsUrl: `ws://127.0.0.1:${wsPort}`, payerKeypairPath, stop };
  } catch (error) {
    stop();
    throw new Error(`surfnet startup failed: ${String(error)}\n--- surfpool ---\n${surfpoolLog}`);
  }
}

export { PROGRAM_ID };
