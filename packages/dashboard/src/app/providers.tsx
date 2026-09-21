"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "@/i18n/locale-provider";
import { useAppStore } from "@/stores/app-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            gcTime: 5 * 60_000,
          },
        },
      }),
  );

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
