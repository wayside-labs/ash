"use client";

import type { KeyPairSigner } from "@solana/kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { describeWalletError, request } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { BootstrapPlanView, BootstrapStepResult } from "@/lib/server/bootstrap";
import type { ConfirmationResult } from "@/lib/server/solana";
import type { VendorPreset } from "@/lib/server/vendors";
import { getConnectedProvider, signAndSendTransaction } from "@/lib/solana";
import { signWithCreateKey } from "@/lib/wallet/create-key";
import { useAppStore } from "@/stores/app-store";

/** What the wizard collected, lamports as decimal strings — the routes' wire format. */
export type BootstrapForm = {
  policyName: string;
  perTxLamports: string;
  dailyLamports: string;
  lifetimeLamports: string | null;
  destination: { owner: string; label: string } | null;
  depositLamports: string;
  session: { key: string; label: string; feeBudgetLamports: string } | null;
};

export type BootstrapStepId = BootstrapPlanView["steps"][number]["id"];

export type BootstrapProgress = {
  stepId: BootstrapStepId;
  phase: "signing" | "confirming" | "confirmed";
};

/**
 * Four stages at most, and each confirmed one drops out of the next build. The bound is
 * for a server that keeps answering with a stage the chain never records — a loop that
 * asks the wallet to sign forever is the one failure worse than stopping.
 */
const MAX_STEPS = 6;

function body(
  cluster: string,
  customRpc: string,
  wallet: string,
  form: BootstrapForm,
  treasury: string | null,
  createKey: string | null,
) {
  return JSON.stringify({
    cluster,
    rpc: customRpc || null,
    wallet,
    treasury,
    createKey: treasury ? null : createKey,
    ...form,
  });
}

export function useBootstrapPlan() {
  const { cluster, customRpc, walletAddress } = useAppStore();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: async (input: {
      form: BootstrapForm;
      treasury: string | null;
      createKey: string | null;
    }) => {
      if (!walletAddress) throw new Error(t("bootstrap.error.walletNotConnected"));
      return request<BootstrapPlanView>("/api/solana/bootstrap/plan", {
        method: "POST",
        body: body(cluster, customRpc, walletAddress, input.form, input.treasury, input.createKey),
      });
    },
  });
}

/**
 * Build, sign, confirm — once per stage, asking the server each time which stage is next.
 * The server re-reads the chain on every build, so a retry after any failure resumes from
 * what actually landed rather than from what this tab believes happened.
 */
export function useRunBootstrap() {
  const { cluster, customRpc, walletAddress } = useAppStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (input: {
      form: BootstrapForm;
      treasury: string | null;
      createKey: KeyPairSigner | null;
      onProgress: (progress: BootstrapProgress) => void;
      /** Called once, as soon as the treasury is known to exist on-chain. */
      onTreasury: (treasury: string) => Promise<void>;
    }): Promise<{ treasury: string }> => {
      const provider = getConnectedProvider(walletAddress);
      if (!walletAddress || !provider) throw new Error(t("bootstrap.error.walletNotConnected"));

      let treasury = input.treasury;
      const learnTreasury = async (address: string) => {
        if (treasury) return;
        treasury = address;
        await input.onTreasury(address);
      };

      for (let attempt = 0; attempt < MAX_STEPS; attempt++) {
        const built = await request<BootstrapStepResult>("/api/solana/bootstrap/build-step", {
          method: "POST",
          body: body(
            cluster,
            customRpc,
            walletAddress,
            input.form,
            treasury,
            input.createKey?.address ?? null,
          ),
        });
        if (built.done) {
          await learnTreasury(built.treasury);
          return { treasury: built.treasury };
        }

        input.onProgress({ stepId: built.stepId, phase: "signing" });
        let transaction = built.transaction;
        if (built.needsCreateKeySignature) {
          if (!input.createKey) throw new Error(t("bootstrap.error.createKeyLost"));
          transaction = await signWithCreateKey(transaction, input.createKey);
        }

        let signature: string;
        try {
          signature = await signAndSendTransaction(provider, transaction);
        } catch (error) {
          throw new Error(describeWalletError(error, t));
        }

        input.onProgress({ stepId: built.stepId, phase: "confirming" });
        const confirmation = await request<ConfirmationResult>("/api/solana/confirm", {
          method: "POST",
          body: JSON.stringify({ cluster, rpc: customRpc || null, signature }),
        });
        if (confirmation.status === "failed") {
          throw new Error(
            t("bootstrap.error.rejectedOnChain", { detail: confirmation.error ?? "" }),
          );
        }
        if (confirmation.status === "timeout") {
          // Never reported as a failure: the transaction may still land, and the retry
          // this message offers asks the chain before building anything again.
          throw new Error(t("bootstrap.error.timeout"));
        }
        input.onProgress({ stepId: built.stepId, phase: "confirmed" });
        await learnTreasury(built.treasury);
      }
      throw new Error(t("bootstrap.error.tooManySteps"));
    },
    onSettled: () => {
      for (const key of ["treasury", "vault-balances", "balances"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/** The VPS vendors' catalogs, fetched only once someone picks the preset. */
export function useVendorPresets(enabled: boolean) {
  return useQuery({
    queryKey: ["bootstrap-vendors"],
    queryFn: () => request<{ vendors: VendorPreset[] }>("/api/solana/bootstrap/vendors"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
