import { z } from "zod";
import { addressSchema } from "@/lib/schema";
import { NATIVE_MINT } from "@/lib/utils";

export const fundingModeSchema = z.enum(["isolatedVault", "nativeAllowance"]);

export const fundingStrategySchema = z
  .object({
    mint: z.string().min(1, "Select an asset"),
    fundingMode: fundingModeSchema,
    allowanceCap: z.string().optional(),
    expiration: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mint === NATIVE_MINT && data.fundingMode === "nativeAllowance") {
      ctx.addIssue({
        code: "custom",
        message: "nativeSolNoFixedDelegation",
        path: ["fundingMode"],
      });
    }
    if (data.fundingMode === "nativeAllowance") {
      const cap = data.allowanceCap?.trim();
      if (!cap || !/^\d+(\.\d+)?$/.test(cap) || Number(cap) <= 0) {
        ctx.addIssue({
          code: "custom",
          message: "invalidCap",
          path: ["allowanceCap"],
        });
      }
      if (!data.expiration || Number.isNaN(Date.parse(data.expiration))) {
        ctx.addIssue({
          code: "custom",
          message: "invalidExpiry",
          path: ["expiration"],
        });
      } else if (Math.floor(Date.parse(data.expiration) / 1000) <= Math.floor(Date.now() / 1000)) {
        ctx.addIssue({
          code: "custom",
          message: "expiryPast",
          path: ["expiration"],
        });
      }
    }
  });

export const guardrailsSchema = z.object({
  maxPerTransaction: z
    .string()
    .min(1)
    .refine((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0, "invalidAmount"),
  dailyLimit: z
    .string()
    .min(1)
    .refine((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0, "invalidAmount"),
  allowlist: z.string().min(1, "allowlistRequired"),
});

export const agentSecurityWizardSchema = fundingStrategySchema.and(guardrailsSchema);

export type AgentSecurityWizardValues = z.infer<typeof agentSecurityWizardSchema>;

export const WIZARD_DEFAULTS: AgentSecurityWizardValues = {
  mint: "",
  fundingMode: "isolatedVault",
  allowanceCap: "",
  expiration: "",
  maxPerTransaction: "100",
  dailyLimit: "1000",
  allowlist: "",
};

export const fundingStrategyFields = ["mint", "fundingMode", "allowanceCap", "expiration"] as const;

export const guardrailsFields = ["maxPerTransaction", "dailyLimit", "allowlist"] as const;

export function parseAllowlist(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function validateAllowlistAddresses(raw: string): boolean {
  const entries = parseAllowlist(raw);
  if (entries.length === 0) return false;
  return entries.every((entry) => addressSchema.safeParse(entry).success);
}

export const addAssetSchema = z.object({
  mint: addressSchema,
});

export type AddAssetValues = z.infer<typeof addAssetSchema>;
