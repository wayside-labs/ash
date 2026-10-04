import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  wallets: [] as unknown[],
  provider: null as unknown,
}));

vi.mock("@wallet-standard/app", () => ({
  getWallets: () => ({ get: () => state.wallets }),
}));
vi.mock("@/lib/solana", () => ({
  getConnectedProvider: () => state.provider,
}));

import { signMessageWithStandardWallet, standardWalletHandle } from "./wallet-standard";

const ADDRESS = "FunderWallet1111111111111111111111111111111";
const MESSAGE = new TextEncoder().encode("sign me");
const SIGNATURE = new Uint8Array(64).fill(9);

type Features = Record<string, unknown>;

function wallet(features: Features, options: { name?: string; accounts?: string[] } = {}) {
  return {
    name: options.name ?? "Phantom",
    accounts: (options.accounts ?? [ADDRESS]).map((address) => ({ address })),
    features,
  };
}

const signMessageFeature = (
  signMessage = vi.fn(async () => [{ signedMessage: MESSAGE, signature: SIGNATURE }]),
) => ({
  "solana:signMessage": { signMessage },
});

beforeEach(() => {
  state.wallets = [];
  state.provider = null;
});

describe("signMessageWithStandardWallet", () => {
  it("signs through the Wallet Standard and returns the raw signature", async () => {
    const signMessage = vi.fn(async () => [{ signedMessage: MESSAGE, signature: SIGNATURE }]);
    state.wallets = [wallet(signMessageFeature(signMessage))];

    const signature = await signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE });

    expect(signature).toEqual(SIGNATURE);
    expect(signMessage).toHaveBeenCalledWith({
      account: { address: ADDRESS },
      message: MESSAGE,
    });
  });

  it("uses the signature, not the signed message, when the wallet prefixes what it signs", async () => {
    const prefixed = new TextEncoder().encode("prefix:sign me");
    const signMessage = vi.fn(async () => [{ signedMessage: prefixed, signature: SIGNATURE }]);
    state.wallets = [wallet(signMessageFeature(signMessage))];
    expect(await signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE })).toEqual(
      SIGNATURE,
    );
  });

  it("asks a wallet that does not list the account yet to connect silently, then signs", async () => {
    const accounts: { address: string }[] = [];
    const connect = vi.fn(async () => {
      accounts.push({ address: ADDRESS });
      return { accounts };
    });
    state.wallets = [
      {
        name: "Phantom",
        accounts,
        features: { ...signMessageFeature(), "standard:connect": { connect } },
      },
    ];

    const signature = await signMessageWithStandardWallet({
      address: ADDRESS,
      message: MESSAGE,
      walletName: "Phantom",
    });

    expect(connect).toHaveBeenCalledWith({ silent: true });
    expect(signature).toEqual(SIGNATURE);
  });

  it("does not connect wallets other than the one the header used", async () => {
    const other = vi.fn(async () => ({ accounts: [] }));
    state.wallets = [
      wallet({ "standard:connect": { connect: other } }, { name: "Backpack", accounts: [] }),
    ];
    state.provider = { signMessage: async () => ({ signature: SIGNATURE }) };
    await signMessageWithStandardWallet({
      address: ADDRESS,
      message: MESSAGE,
      walletName: "Phantom",
    });
    expect(other).not.toHaveBeenCalled();
  });

  it("falls back to the injected provider, whichever shape it answers in", async () => {
    state.provider = { signMessage: vi.fn(async () => ({ signature: SIGNATURE })) };
    expect(await signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE })).toEqual(
      SIGNATURE,
    );
    state.provider = { signMessage: vi.fn(async () => SIGNATURE) };
    expect(await signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE })).toEqual(
      SIGNATURE,
    );
  });

  it("asks the provider for utf8, which is what the extensions document", async () => {
    const signMessage = vi.fn(async () => ({ signature: SIGNATURE }));
    state.provider = { signMessage };
    await signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE });
    expect(signMessage).toHaveBeenCalledWith(MESSAGE, "utf8");
  });

  it("skips a wallet that has the feature but not this account", async () => {
    state.wallets = [
      wallet(signMessageFeature(), { accounts: ["SomeoneElse111111111111111111111111111111"] }),
    ];
    state.provider = { signMessage: async () => ({ signature: SIGNATURE }) };
    expect(await signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE })).toEqual(
      SIGNATURE,
    );
  });

  it("refuses with a stable code when no path can sign", async () => {
    await expect(
      signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE }),
    ).rejects.toThrow("WALLET_CANNOT_SIGN_MESSAGES");
  });

  it("refuses when the wallet answers with nothing usable and there is no provider", async () => {
    state.wallets = [wallet(signMessageFeature(vi.fn(async () => [])))];
    await expect(
      signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE }),
    ).rejects.toThrow("WALLET_CANNOT_SIGN_MESSAGES");
  });

  it("lets a wallet's own rejection through untouched, so the caller can name it", async () => {
    const rejection = { code: 4001, message: "User rejected the request." };
    state.wallets = [wallet(signMessageFeature(vi.fn(async () => Promise.reject(rejection))))];
    await expect(
      signMessageWithStandardWallet({ address: ADDRESS, message: MESSAGE }),
    ).rejects.toBe(rejection);
  });
});

describe("standardWalletHandle", () => {
  it("signs transactions on mainnet whatever cluster the dashboard shows", async () => {
    const signTransaction = vi.fn(async () => [{ signedTransaction: new Uint8Array([1, 2, 3]) }]);
    state.wallets = [wallet({ "solana:signTransaction": { signTransaction } })];
    const handle = standardWalletHandle({ address: ADDRESS, walletName: "Phantom" });

    const signed = await handle.signTransaction(new Uint8Array([7]));

    expect(signed).toEqual(new Uint8Array([1, 2, 3]));
    expect(signTransaction).toHaveBeenCalledWith({
      account: { address: ADDRESS },
      chain: "solana:mainnet",
      transaction: new Uint8Array([7]),
    });
  });

  it("carries the address and delegates message signing", async () => {
    state.wallets = [wallet(signMessageFeature())];
    const handle = standardWalletHandle({ address: ADDRESS });
    expect(handle.address).toBe(ADDRESS);
    expect(await handle.signMessage(MESSAGE)).toEqual(SIGNATURE);
  });
});
