import Link from "next/link";
import { notFound } from "next/navigation";
import { listAuthors } from "@/blog/authors";
import { listCategories } from "@/blog/categories";
import { formatDateTime } from "@/blog/lib/format-date";
import { isMediaPath } from "@/blog/lib/image-rules";
import { LANG_LABEL } from "@/blog/lib/post-status";
import { readingTimeMinutes } from "@/blog/lib/reading-time";
import { BodyTooLargeError, sanitizePostHtml } from "@/blog/lib/sanitize";
import { SHORTCODE_LABELS } from "@/blog/lib/shortcode-html";
import { type PostSegment, parseShortcodes, validateShortcodes } from "@/blog/lib/shortcodes";
import { type TocItem, withToc } from "@/blog/lib/toc";
import { getPost } from "@/blog/posts";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { env } from "@/lib/env";
import { buttonClass } from "@/ui/button";
import { Notice } from "@/ui/notice";
import { StatusBadge } from "@/ui/status-badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prévia · Ash Studio" };

type Prepared =
  | { ok: true; segments: PostSegment[]; toc: TocItem[]; minutes: number }
  | { ok: false; error: string };

// The same order the public API uses (public.ts): sanitize, then heading ids, then cut at the
// shortcodes. Sanitized again here although the body was sanitized on save: a row can arrive by
// psql or a restore, the allowlist can change after a row was written, and this page is read by
// an admin, whose session is the most valuable thing a script could run with.
function prepare(bodyHtml: string): Prepared {
  let clean: string;
  try {
    clean = sanitizePostHtml(bodyHtml);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return { ok: false, error: "O texto deste post passa do tamanho máximo e não pode ser mostrado." };
    }
    throw err;
  }
  const { html, items } = withToc(clean);
  // parseShortcodes cuts the HTML at every {{name}}; a shortcode inside an element would cut it
  // mid-tag. The save refuses those, so this is for a row that did not come through the save:
  // the body is then shown whole, with the marker as text.
  const segments: PostSegment[] = validateShortcodes(html).inline.length === 0
    ? parseShortcodes(html)
    : [{ type: "html", html }];
  return { ok: true, segments, toc: items, minutes: readingTimeMinutes(clean) };
}

const shortcodeLabel = (name: string) =>
  (SHORTCODE_LABELS as Record<string, string | undefined>)[name] ?? name;

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const database = db();
  const post = await getPost(database, id);
  if (!post) notFound();

  const [categories, authors] = await Promise.all([listCategories(database), listAuthors(database)]);
  const category = categories.find((item) => item.id === post.categoryId);
  const author = authors.find((item) => item.id === post.authorId);
  const tz = env().PUBLISH_TZ;
  const prepared = prepare(post.bodyHtml);
  // The column is constrained to /media by the schema; checked again before it becomes a src.
  const cover = post.coverUrl && isMediaPath(post.coverUrl) ? post.coverUrl : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="surface-card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-medium text-ink">Prévia</p>
          <p className="mt-0.5 text-xs text-muted">
            É o que está salvo, na ordem e com a estrutura que vão para o site. As cores e a
            diagramação aqui são do painel: o site tem o visual dele.
          </p>
        </div>
        <StatusBadge status={post.status} />
        <Link href={`/blog/${post.id}`} className={buttonClass("secondary", "sm")}>
          Voltar ao editor
        </Link>
      </div>

      <article className="mt-8">
        <p className="text-xs text-muted">
          {LANG_LABEL[post.lang]} · {category?.namePt ?? "Sem categoria"} ·{" "}
          {author?.name ?? "Sem autor"}
          {prepared.ok ? ` · ${prepared.minutes} min de leitura` : ""} · salvo em{" "}
          <span className="font-mono tabular-nums">
            {formatDateTime(post.updatedAt.toISOString(), tz)}
          </span>
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight">{post.title}</h1>
        {post.excerpt ? <p className="mt-3 text-lg text-muted">{post.excerpt}</p> : null}
        {post.tags.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
            {post.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-sm border border-line-strong bg-elevated px-2 py-0.5 text-xs text-muted"
              >
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
        {cover ? (
          // A plain img: the file is ours (/media) and next/image is off (next.config.ts).
          <img
            src={cover}
            alt={post.coverAlt ?? ""}
            className="mt-6 w-full rounded-lg border border-line"
          />
        ) : null}

        {!prepared.ok ? (
          <Notice tone="error" className="mt-8">
            {prepared.error}
          </Notice>
        ) : (
          <>
            {prepared.toc.length > 1 ? (
              <nav aria-label="Sumário" className="surface-card mt-8 p-4 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Sumário</p>
                <ol className="mt-2 space-y-1">
                  {prepared.toc.map((item) => (
                    // `text` is plain text (toc.ts): React escapes it. The id was written by
                    // withToc from a slug, never taken from the author.
                    <li key={item.id} className={item.level === 3 ? "pl-4" : ""}>
                      <a href={`#${item.id}`} className="text-accent underline">
                        {item.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}

            {prepared.segments.length === 0 ? (
              <p className="mt-8 text-sm text-muted">Este post ainda não tem texto.</p>
            ) : (
              <div className="mt-8 space-y-4">
                {prepared.segments.map((segment, index) =>
                  segment.type === "shortcode" ? (
                    <p
                      // The index is the identity: the segments are a fixed, ordered cut of one string.
                      key={index}
                      className="rounded-md border border-dashed border-line-strong bg-elevated px-3 py-2 font-mono text-xs text-muted"
                    >
                      Bloco especial: {shortcodeLabel(segment.name)}
                    </p>
                  ) : (
                    <div
                      key={index}
                      className="post-body"
                      // Safe because `segment.html` is, and can only be, a piece of what
                      // sanitizePostHtml returned a few lines above (prepare): an allowlist of
                      // tags and attributes, href limited to http(s), mailto, # and root paths,
                      // img only from /media. The raw column never reaches this prop.
                      // tests/pages.test.tsx feeds this page a hostile row and reads the HTML.
                      dangerouslySetInnerHTML={{ __html: segment.html }}
                    />
                  ),
                )}
              </div>
            )}
          </>
        )}
      </article>
    </main>
  );
}
