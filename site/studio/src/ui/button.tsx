import type { ButtonHTMLAttributes, MouseEvent } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-settle text-settle-ink hover:bg-settle/85",
  secondary: "border border-line-strong bg-elevated text-ink hover:border-faint",
  danger: "bg-deny text-settle-ink hover:bg-deny/85",
  ghost: "text-muted hover:bg-elevated hover:text-ink",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-[13px]",
  md: "px-4 py-2 text-sm",
};

// For a link that should look like a button (next/link takes a className, not a variant).
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();
}

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 animate-spin" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // The action THIS button started is running: spinner, and no further clicks.
  pending?: boolean;
  // Something else is running (another button of the same row): no clicks, no spinner.
  blocked?: boolean;
  className?: string;
};

// type="button" unless said otherwise: a button inside a form must not submit it by accident.
//
// `pending` and `blocked` do not use the `disabled` attribute. A disabled button cannot hold
// focus: the one that was just clicked would drop it to <body>, and a dialog that closes could
// not give focus back to the button that opened it. They are aria-disabled, with the click
// swallowed here (a submit button included: the form is not submitted). `disabled` itself is
// still there for a control that is not available at all.
export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  blocked = false,
  type = "button",
  className = "",
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const inert = pending || blocked;
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }
  return (
    <button
      {...rest}
      type={type}
      onClick={click}
      aria-disabled={inert || undefined}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}
