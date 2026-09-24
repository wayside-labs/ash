"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { truncateAddressForName, tryResolveIdentity } from "@/lib/auth/identity";
import { getWalletProvider, type WalletId } from "@/lib/solana";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * Shown in the wallet before signing. Must be one line: Supabase rejects a
 * statement containing newlines, and Phantom refuses to sign without one.
 */
const SIGN_IN_STATEMENT =
  "Sign in to Agent Rails. This proves you control this wallet and moves no funds.";

export function useAuth() {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    const supabase = createClient();

    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [configured]);

  const signInWithGoogle = useCallback(async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) throw error;
  }, []);

  /**
   * Sign in With Solana. Unlike the Google flow this never leaves the page, so
   * there is no `/auth/callback` to provision the account — the bootstrap is
   * asked for here, once the session exists.
   */
  const signInWithWallet = useCallback(async (id: WalletId) => {
    const wallet = getWalletProvider(id);
    if (!wallet) throw new Error("wallet not installed");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithWeb3({
      chain: "solana",
      wallet,
      statement: SIGN_IN_STATEMENT,
    });
    if (error) throw error;

    const response = await fetch("/api/auth/bootstrap", { method: "POST" });
    if (!response.ok) {
      // The session is real but the account is not, and every state read will
      // 401 until it is. Surfacing it here beats an empty dashboard.
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "could not provision this account");
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    if (configured) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    setUser(null);
  }, [configured]);

  const identity = tryResolveIdentity(user);
  const walletAddress = identity?.provider === "wallet" ? identity.subject : null;

  return {
    configured,
    email: user?.email ?? null,
    walletAddress,
    /** What the header and the account card show. A wallet account has no email. */
    label: user?.email ?? (walletAddress ? truncateAddressForName(walletAddress) : null),
    loading,
    // Keyed on the user, not the email: a wallet account has none, and keying
    // on the email would render every wallet sign-in as signed out.
    signedIn: Boolean(user),
    signInWithGoogle,
    signInWithWallet,
    signOut,
  };
}
