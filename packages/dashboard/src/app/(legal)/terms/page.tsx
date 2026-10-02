import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalVars } from "@/lib/legal/legal-vars";

export const metadata: Metadata = { title: "Terms of Service — Agent Rails" };

// The operator's name, contact and governing law come from the server's environment at request
// time; a statically prerendered page would freeze whatever was set at build.
export const dynamic = "force-dynamic";

export default function Page() {
  return <LegalDocument kind="terms" vars={legalVars()} />;
}
