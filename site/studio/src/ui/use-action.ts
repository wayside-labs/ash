"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

// The shape every server action of the panel answers with (src/blog/result.ts).
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// An action that threw instead of answering: an outage, a bug, or a session that ended. The
// server's own message is replaced by Next in production, so there is nothing better to show.
export const UNEXPECTED_ERROR = "Não foi possível concluir. Recarregue a página e tente de novo.";

type After =
  // Reload the server-rendered data of this page (the default).
  | "refresh"
  // The caller keeps its own copy of the data (the editor): nothing is reloaded.
  | "stay"
  // The caller navigates away in onSuccess. `pending` then never goes back to false: between the
  // answer and the new page the button must stay dead, or a second click repeats the action.
  | "leave";

// Runs one server action for one piece of screen (a row, a dialog): `pending` to block its
// buttons, `error` to show next to it, and on success a refresh of the server-rendered data.
//
// The Next docs offer two ways to show fresh data after a mutation: refresh() from next/cache
// inside the action, or router.refresh() here. The second is used so the actions stay free of
// screen concerns: the editor calls the same ones and must not have its page re-rendered under
// unsaved text. Every page is force-dynamic, so there is no server cache to invalidate.
export function useAction() {
  const router = useRouter();
  const [inTransition, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  // What `pending` says one render late: two clicks in the same tick both see pending=false.
  const busy = useRef(false);
  // Which of the caller's buttons started the action, for the spinner.
  const [running, setRunning] = useState<string | null>(null);

  function run<T>(
    action: () => Promise<Result<T>>,
    onSuccess?: (data: T) => void,
    options: { after?: After; key?: string } = {},
  ): void {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setRunning(options.key ?? null);
    startTransition(async () => {
      let result: Result<T>;
      try {
        result = await action();
      } catch {
        busy.current = false;
        setError(UNEXPECTED_ERROR);
        return;
      }
      // No refresh on failure: the row would move or vanish and take its error with it. The
      // messages that need a reload say so.
      if (!result.ok) {
        busy.current = false;
        setError(result.error);
        return;
      }
      const after = options.after ?? "refresh";
      if (after === "leave") {
        // busy stays true on purpose: this piece of screen is done.
        setLeft(true);
        onSuccess?.(result.data);
        return;
      }
      busy.current = false;
      onSuccess?.(result.data);
      if (after === "stay") return;
      // A transition of its own, because the one above ended at the await: `pending` stays true
      // until the new list is on screen.
      startTransition(() => router.refresh());
    });
  }

  const pending = inTransition || left;
  return {
    pending,
    error,
    run,
    clearError: () => setError(null),
    // True for the button whose key started the running action.
    isRunning: (key: string) => pending && running === key,
  };
}

export type Action = ReturnType<typeof useAction>;
