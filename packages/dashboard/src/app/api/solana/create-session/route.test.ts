import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const HEADERS = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

vi.mock("@/lib/server/solana", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/solana")>();
  return {
    ...actual,
    buildCreateSession: vi.fn(),
  };
});

import { buildCreateSession, SolanaRequestError } from "@/lib/server/solana";

const mockBuild = vi.mocked(buildCreateSession);

describe("POST /api/solana/create-session", () => {
  it("rejects an invalid payload", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/solana/create-session", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("returns a built transaction for a valid request", async () => {
    mockBuild.mockResolvedValueOnce({
      session: "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C",
      sessionKey: "11111111111111111111111111111111",
      policy: "4Qg14cZWVLPXeFFrcaD9cFZEdLX44M4AWfxdHwSiVYeF",
      transaction: "AQID",
      lastValidBlockHeight: 42,
    });

    const res = await POST(
      new Request("http://localhost:3000/api/solana/create-session", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          cluster: "devnet",
          rpc: null,
          treasury: "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i",
          wallet: "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD",
          sessionKey: "11111111111111111111111111111111",
          label: "Suite Bot",
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      session: "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C",
      transaction: "AQID",
    });
  });

  it("maps SolanaRequestError to a 400", async () => {
    mockBuild.mockRejectedValueOnce(new SolanaRequestError("api.error.notOperatorOrOwner"));

    const res = await POST(
      new Request("http://localhost:3000/api/solana/create-session", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          cluster: "devnet",
          rpc: null,
          treasury: "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i",
          wallet: "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD",
          sessionKey: "11111111111111111111111111111111",
          label: "Suite Bot",
        }),
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "only the treasury owner or operator may create sessions",
    });
  });
});
