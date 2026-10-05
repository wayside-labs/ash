"use client";

import { type FormEvent, useState } from "react";
import { rejectPost } from "@/blog/actions/status";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { TextAreaField } from "@/ui/field";
import { Notice } from "@/ui/notice";
import { type Action, useAction } from "@/ui/use-action";

type Props = {
  open: boolean;
  onClose: () => void;
  // updatedAt is the version the caller's screen is showing: the server refuses the rejection if
  // the post was saved or moved since.
  post: { id: string; title: string; updatedAt: string };
  // The new token and the comment as sent, for a caller that keeps the post in its own state.
  onDone?: (result: { updatedAt: string; feedback: string }) => void;
  refresh?: boolean;
};

// Same floor as RejectPostSchema. The server checks again; this only saves the round trip.
const MIN_FEEDBACK = 5;

function RejectForm({
  action,
  onClose,
  post,
  onDone,
  refresh = true,
}: Omit<Props, "open"> & { action: Action }) {
  const { pending, error, run } = action;
  const [feedback, setFeedback] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = feedback.trim();
    if (text.length < MIN_FEEDBACK) {
      setProblem(`Explique o que precisa mudar, com pelo menos ${MIN_FEEDBACK} caracteres.`);
      return;
    }
    setProblem(null);
    run(
      () => rejectPost({ id: post.id, feedback: text, if_updated_at: post.updatedAt }),
      (data) => {
        onDone?.({ updatedAt: data.updatedAt, feedback: text });
        onClose();
      },
      { after: refresh ? "refresh" : "stay" },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-muted">
        <span className="text-ink">{post.title}</span> volta para quem escreveu, com o seu
        comentário. Depois de reaberto, o post vira rascunho de novo.
      </p>
      <TextAreaField
        label="O que precisa mudar"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        maxLength={2000}
        rows={5}
        hint="Quem escreveu vê este texto junto do post."
        error={problem}
        readOnly={pending}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} blocked={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="danger" pending={pending}>
          Rejeitar post
        </Button>
      </div>
    </form>
  );
}

// The action's state lives above the Dialog (see schedule-dialog.tsx for why).
export function RejectDialog({ open, onClose, ...rest }: Props) {
  const action = useAction();
  const close = () => {
    action.clearError();
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} dismissible={!action.pending} title="Rejeitar post">
      <RejectForm action={action} onClose={close} {...rest} />
    </Dialog>
  );
}
