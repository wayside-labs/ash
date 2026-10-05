import { type PostStatus, STATUS_LABEL } from "@/blog/lib/post-status";

// The colour map of the M1b plan: published is "good" (settle), approved is the blue of the
// source (accent), waiting for review is a warning, rejected is the one red. A draft has no
// colour: nothing has been said about it yet.
const TONE: Record<PostStatus, string> = {
  rascunho: "border-line-strong text-muted",
  revisao: "border-warning/50 text-warning",
  aprovado: "border-accent/50 text-accent",
  publicado: "border-settle/50 text-settle",
  rejeitado: "border-deny/50 text-deny",
};

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-sm border bg-elevated px-2 py-0.5 text-xs font-medium ${TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
