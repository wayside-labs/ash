"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Notice } from "./notice";

// The question before an action that shows on the site or cannot be taken back. It stays open
// while the action runs and when it fails, with the error where the admin is looking.
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  pending = false,
  error = null,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  // What is about to happen, in a sentence.
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissible={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} blocked={pending}>
            Cancelar
          </Button>
          <Button variant={tone} onClick={onConfirm} pending={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-muted">{children}</div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Dialog>
  );
}
