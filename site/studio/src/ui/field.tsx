import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

type Labelled = {
  label: string;
  // Help that is always there, under the control.
  hint?: ReactNode;
  // What is wrong with the current value; replaces nothing, shows under the hint.
  error?: string | null | undefined;
};

const CONTROL =
  "w-full rounded-md border bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-60";

// Not on the shared class: a <select> always matches :read-only.
const READ_ONLY = "read-only:text-muted";

const controlClass = (error: string | null | undefined, extra = "") =>
  `${CONTROL} ${error ? "border-deny" : "border-line-strong"} ${extra}`.trim();

// The ids the control points at, so a screen reader reads the hint and the error with the label.
function describedBy(id: string, hint: ReactNode, error: string | null | undefined) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function Shell({ id, label, hint, error, children }: Labelled & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-deny">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Without<T> = Omit<T, "id" | "className">;

export function TextField({
  label,
  hint,
  error,
  ...input
}: Labelled & Without<InputHTMLAttributes<HTMLInputElement>>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={controlClass(error, READ_ONLY)}
      />
    </Shell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  rows = 4,
  ...textarea
}: Labelled & Without<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <textarea
        {...textarea}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={controlClass(error, `resize-y ${READ_ONLY}`)}
      />
    </Shell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...select
}: Labelled & Without<SelectHTMLAttributes<HTMLSelectElement>>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <select
        {...select}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={controlClass(error)}
      >
        {children}
      </select>
    </Shell>
  );
}
