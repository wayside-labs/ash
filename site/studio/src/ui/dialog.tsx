"use client";

import { type ReactNode, type SyntheticEvent, useEffect, useId, useRef } from "react";

// A native <dialog> opened with showModal(): the browser traps focus inside it, makes the rest
// of the page inert, closes it on Esc and gives focus back to what opened it. Nothing of that is
// reimplemented here.
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
}: {
  open: boolean;
  // Called when the dialog closes for any reason: Esc, the parent setting `open` to false.
  onClose: () => void;
  title: string;
  children: ReactNode;
  // The buttons, laid out at the bottom.
  footer?: ReactNode;
  // false while an action is running: the request is in flight and its answer (an error, most
  // of all) has to have somewhere to be shown. The owner of the action passes this, so it must
  // hold the action's state itself, not a child that the closing would unmount.
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // React makes "cancel" and "close" bubble, which the browser's own events do not: a dialog
  // opened from inside this one (the photo picker inside the author form) would close this one
  // too when it closes. Only this element's own events count.
  function cancelled(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    if (!dismissible) event.preventDefault();
  }

  function closed(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    // A browser may close the dialog anyway (Chrome does on a second Esc). While it must stay,
    // it is put back, and the owner is not told it closed.
    if (!dismissible && open) {
      ref.current?.showModal();
      return;
    }
    onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={closed}
      onCancel={cancelled}
      className="surface-card m-auto w-[min(34rem,calc(100vw-2rem))] p-0 text-ink"
    >
      {/* Mounted only while open: each opening starts from fresh form state. */}
      {open ? (
        <div className="p-6">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="mt-4 space-y-4 text-sm">{children}</div>
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
