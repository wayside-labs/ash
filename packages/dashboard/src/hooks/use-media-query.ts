"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, for layout decisions CSS alone cannot make (a resizable
 * panel group's orientation is a prop, not a class). `false` on the server and on first paint,
 * so a query should name the *exception* — `(max-width: …)` — and default to the wide layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
