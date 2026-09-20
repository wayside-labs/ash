import type { ReactNode } from "react";

/**
 * The system prompt asks Claude for light markdown, so the panel has to render
 * at least bold, italic and inline code — otherwise the reader sees asterisks.
 * Deliberately a tokenizer that builds React nodes: no HTML is ever parsed or
 * injected, so assistant output cannot smuggle markup into the page.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((token, index) => {
      const key = `${keyPrefix}-${index}`;
      if (token.startsWith("**") && token.endsWith("**")) {
        return (
          <strong key={key} className="font-semibold">
            {token.slice(2, -2)}
          </strong>
        );
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return (
          <code key={key} className="num rounded bg-background/60 px-1 py-0.5 text-[0.9em]">
            {token.slice(1, -1)}
          </code>
        );
      }
      if (token.startsWith("*") && token.endsWith("*")) {
        return (
          <em key={key} className="italic">
            {token.slice(1, -1)}
          </em>
        );
      }
      return <span key={key}>{token}</span>;
    });
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => {
        const key = `line-${index}`;
        const trimmed = line.trim();

        if (!trimmed) return <div key={key} className="h-1.5" />;

        const ordered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
        if (ordered) {
          return (
            <div key={key} className="flex gap-2">
              <span className="num shrink-0 text-muted-foreground">{ordered[1]}.</span>
              <span>{renderInline(ordered[2] ?? "", key)}</span>
            </div>
          );
        }

        const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
        if (bullet) {
          return (
            <div key={key} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground">•</span>
              <span>{renderInline(bullet[1] ?? "", key)}</span>
            </div>
          );
        }

        const heading = /^#{1,4}\s+(.*)$/.exec(trimmed);
        if (heading) {
          return (
            <p key={key} className="font-semibold">
              {renderInline(heading[1] ?? "", key)}
            </p>
          );
        }

        return <p key={key}>{renderInline(line, key)}</p>;
      })}
    </div>
  );
}
