import type { ReactNode } from "react";

export type NoticeTone = "error" | "warning" | "success" | "info";

const TONE: Record<NoticeTone, string> = {
  error: "border-deny/50 text-deny",
  warning: "border-warning/50 text-warning",
  success: "border-settle/50 text-settle",
  info: "border-line-strong text-muted",
};

// The inline message next to what it is about. An error interrupts (role="alert"); the others
// are announced when the reader is idle.
export function Notice({
  tone = "error",
  children,
  className = "",
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border bg-elevated px-3 py-2 text-[13px] leading-relaxed ${TONE[tone]} ${className}`.trim()}
    >
      {children}
    </p>
  );
}
