import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Layer 5 of the test pyramid (ADR-008): a real ledger, not an SVM harness.
 *
 * Everything below layer 5 stubs the network, which is exactly where the double-spend
 * lived — the defect was never in the program, it was in what the client concluded when the
 * network did not answer. So this runs the whole path against a validator: real slots, real
 * confirmation timing, real account reads.
 *
 * Surfpool runs `--offline` here. Mainnet forking is what the nightly USDC job needs; this
 * suite pays in native SOL and a fork would only add a network dependency to a test whose
 * subject is what happens when the network misbehaves.
 */

export const PROGRAM_ID = "4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS";

export type Surfnet = {
  rpcUrl: string;
  /** Payer with SOL, used to deploy and to fund fixture accounts. */
  payerKeypairPath: string;
  stop(): Promise<void>;
};

export type StartSurfnetOptions = {
  /** Defaults to a free ephemeral port, so a developer's own validator on 8899 is left alone. */
  port?: number;
  /** Repo root, used to locate `target/deploy`. */
  repoRoot: string;
  /** Milliseconds to wait for the RPC to answer before giving up. */
  readyTimeoutMs?: number;
};

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

function anyFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * A free RPC port whose successor is also free.
 *
 * `solana program deploy` opens a WebSocket at the RPC port plus one and offers no flag to
 * say otherwise, so the pair has to be adjacent or the deploy panics on a refused
 * connection.
 */
async function freePortPair(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await anyFreePort();
    if (port < 65_535 && (await portIsFree(port + 1))) return port;
  }
  throw new Error("Could not find two adjacent free ports for the surfnet");
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function waitForRpc(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await rpc(url, "getVersion");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Surfnet did not answer within ${timeoutMs}ms: ${String(lastError)}`);
}

/**
 * Start a surfnet and deploy the program at its declared address.
 *
 * The deploy uses `target/deploy/agent_rails-keypair.json`, which is how the program lands
 * at the `declare_id!` address rather than wherever a fresh keypair would put it. That file
 * is a local build artifact and is not the mainnet authority (ADR-011); if it is missing,
 * run `cargo-build-sbf` first.
 */
export async function startSurfnet(options: StartSurfnetOptions): Promise<Surfnet> {
  const port = options.port ?? (await freePortPair());
  const rpcUrl = `http://127.0.0.1:${port}`;

  // A validator already on this port is somebody else's, with somebody else's state. Reusing
  // it silently is how a suite ends up asserting against a ledger it did not create.
  if (await surfnetIsRunning(rpcUrl)) {
    throw new Error(
      `Something is already serving ${rpcUrl}. Stop it, or point AGENT_RAILS_E2E_RPC at it ` +
        "together with AGENT_RAILS_E2E_PAYER.",
    );
  }
  const workDir = await mkdtemp(join(tmpdir(), "agent-rails-e2e-"));
  const payerKeypairPath = join(workDir, "payer.json");

  await execFileAsync("solana-keygen", [
    "new",
    "--no-bip39-passphrase",
    "-s",
    "-o",
    payerKeypairPath,
    "--force",
  ]);

  const child: ChildProcess = spawn(
    "surfpool",
    ["start", "--offline", "--no-deploy", "--port", String(port), "--ws-port", String(port + 1)],
    { stdio: "ignore", detached: true },
  );
  child.unref();

  const stop = async () => {
    for (const target of child.pid ? [-child.pid, child.pid] : []) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* already gone, or not a group leader */
      }
    }

    // A validator that outlives its run is not a tidiness problem: the next run finds the
    // machine busy and hangs, or picks a different port and competes for resources with a
    // process nobody is watching. So the kill is verified, and escalated if it did not take.
    if (!(await portClosed(rpcUrl, 5_000))) {
      await killListener(port);
      await portClosed(rpcUrl, 5_000);
    }

    await rm(workDir, { recursive: true, force: true });
  };

  // Vitest can tear a worker down before `afterAll` finishes, and a crash skips it
  // entirely. Either way the validator should not be left behind.
  const onExit = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  };
  process.once("exit", onExit);

  try {
    await waitForRpc(rpcUrl, options.readyTimeoutMs ?? 30_000);

    const payer = (
      await execFileAsync("solana-keygen", ["pubkey", payerKeypairPath])
    ).stdout.trim();
    await execFileAsync("solana", ["airdrop", "100", payer, "--url", rpcUrl]);

    await execFileAsync(
      "solana",
      [
        "program",
        "deploy",
        join(options.repoRoot, "target/deploy/agent_rails.so"),
        "--program-id",
        join(options.repoRoot, "target/deploy/agent_rails-keypair.json"),
        "--url",
        rpcUrl,
        "--keypair",
        payerKeypairPath,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    const account = (await rpc(rpcUrl, "getAccountInfo", [PROGRAM_ID, { encoding: "base64" }])) as {
      value: { executable: boolean } | null;
    };
    if (!account.value?.executable) {
      throw new Error(`Program ${PROGRAM_ID} is not executable after deploy`);
    }

    return { rpcUrl, payerKeypairPath, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function portClosed(rpcUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await surfnetIsRunning(rpcUrl))) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Kill whatever still holds the port.
 *
 * Best effort and Linux/macOS only: if `lsof` is missing the run simply reports the leak
 * rather than failing, because a cleanup that throws would mask the test result behind it.
 */
async function killListener(port: number): Promise<void> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`]);
    for (const pid of stdout.split("\n").map((line) => Number(line.trim()))) {
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* raced with its own exit */
        }
      }
    }
  } catch {
    /* lsof missing, or nothing listening */
  }
}

/** Is a surfnet already listening? Lets a developer reuse one across runs. */
export async function surfnetIsRunning(rpcUrl: string): Promise<boolean> {
  try {
    await rpc(rpcUrl, "getVersion");
    return true;
  } catch {
    return false;
  }
}
