"use client";

import { type FormEvent, useState } from "react";
import { setPostStatus } from "@/blog/actions/status";
import { isoToLocal, localToIso } from "@/blog/lib/local-time";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { Notice } from "@/ui/notice";
import { type Action, useAction } from "@/ui/use-action";

type Props = {
  open: boolean;
  onClose: () => void;
  // updatedAt is the version the caller's screen is showing: it goes with the request, and the
  // server refuses the schedule if the post was saved or moved since.
  post: { id: string; title: string; scheduledFor: string | null; updatedAt: string };
  // PUBLISH_TZ and its written-out name, both read on the server.
  tz: string;
  zone: string;
  // The new token and date, for a caller that keeps the post in its own state (the editor).
  onDone?: (result: { updatedAt: string; scheduledFor: string }) => void;
  // false when the caller must not have its page re-rendered (the editor, with unsaved text).
  refresh?: boolean;
};

const NO_SUCH_TIME =
  "Esse horário não existe no fuso do blog: é a hora pulada quando o horário de verão começa, ou a data não é válida. Escolha outro horário.";

// The field speaks wall-clock time with no zone. It goes to and from an instant only through
// local-time.ts, in the editorial zone: never new Date(value), which would read it in the zone
// of whoever is clicking.
function ScheduleForm({
  action,
  onClose,
  post,
  tz,
  zone,
  onDone,
  refresh = true,
}: Omit<Props, "open"> & { action: Action }) {
  const { pending, error, run } = action;
  const [value, setValue] = useState(() =>
    post.scheduledFor ? isoToLocal(post.scheduledFor, tz) : "",
  );
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value) {
      setProblem("Escolha o dia e a hora.");
      return;
    }
    const iso = localToIso(value, tz);
    if (iso === null) {
      setProblem(NO_SUCH_TIME);
      return;
    }
    setProblem(null);
    // A date in the past or too far ahead is the server's to refuse: it has the clock.
    run(
      () =>
        setPostStatus({
          id: post.id,
          action: "schedule",
          scheduled_for: iso,
          if_updated_at: post.updatedAt,
        }),
      (data) => {
        onDone?.({ updatedAt: data.updatedAt, scheduledFor: iso });
        onClose();
      },
      { after: refresh ? "refresh" : "stay" },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-muted">
        <span className="text-ink">{post.title}</span> vai ao ar sozinho no horário escolhido.
      </p>
      <TextField
        label="Dia e hora da publicação"
        type="datetime-local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        hint={`No fuso do blog: ${zone}.`}
        error={problem}
        readOnly={pending}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} blocked={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" pending={pending}>
          {post.scheduledFor ? "Salvar novo horário" : "Agendar"}
        </Button>
      </div>
    </form>
  );
}

// The action's state lives here, above the Dialog, and not in the form: the dialog must know a
// request is running to refuse Esc, and the answer must have a mounted place to land.
export function ScheduleDialog({ open, onClose, post, ...rest }: Props) {
  const action = useAction();
  const close = () => {
    action.clearError();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!action.pending}
      title={post.scheduledFor ? "Reagendar publicação" : "Agendar publicação"}
    >
      <ScheduleForm action={action} onClose={close} post={post} {...rest} />
    </Dialog>
  );
}
