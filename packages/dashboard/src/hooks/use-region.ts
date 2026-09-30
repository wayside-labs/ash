"use client";

import { useQuery } from "@tanstack/react-query";
import { countryFromBrowser, DEFAULT_REGION, type Region } from "@/lib/region";

async function fetchRegion(): Promise<Region> {
  // The browser's guess rides along as a hint; the edge's `CF-IPCountry` wins when present.
  const guess = countryFromBrowser(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.languages ?? [navigator.language],
  );
  const res = await fetch(`/api/region${guess ? `?country=${guess}` : ""}`);
  if (!res.ok) return DEFAULT_REGION;
  return (await res.json()) as Region;
}

/** The viewer's display currency and deposit region. USD until known, and on any failure. */
export function useRegion(): Region {
  const { data } = useQuery({
    queryKey: ["region"],
    queryFn: fetchRegion,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return data ?? DEFAULT_REGION;
}
