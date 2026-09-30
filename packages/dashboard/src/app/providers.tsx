"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "@/i18n/locale-provider";
import { recoverFromAuthError, retryUnlessAuth } from "@/lib/auth/session-recovery";
import { useAppStore } from "@/stores/app-store";

function makeQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => recoverFromAuthError(error, client),
    }),
    mutationCache: new MutationCache({
      onError: (error) => recoverFromAuthError(error, client),
    }),
    defaultOptions: {
      queries: {
        retry: retryUnlessAuth,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
      },
    },
  });
  return client;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    const mark = () => useAppStore.getState().setHasHydrated(true);
    if (useAppStore.persist.hasHydrated()) mark();
    return useAppStore.persist.onFinishHydration(mark);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ToastProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
