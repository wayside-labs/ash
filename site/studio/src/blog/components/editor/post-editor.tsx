"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { updatePost } from "@/blog/actions/posts";
import { setPostStatus } from "@/blog/actions/status";
import { type EditorField, STALE_POST_MESSAGE, fieldForError } from "@/blog/lib/field-error";
import { formatDateTime } from "@/blog/lib/format-date";
import { type PostLang, type PostStatus, STATUS_LABEL, rowActions } from "@/blog/lib/post-status";
import type { PostAction } from "@/blog/schemas";
import { Button, buttonClass } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { TextField } from "@/ui/field";
import { Notice } from "@/ui/notice";
import { StatusBadge } from "@/ui/status-badge";
import { useAction } from "@/ui/use-action";
import { PostSettings, type PostSettingsValue, commitPendingTag } from "../post-settings";
import { RejectDialog } from "../reject-dialog";
import { ScheduleDialog } from "../schedule-dialog";
import { EditorToolbar } from "./editor-toolbar";
import {
  editorExtensions,
  editorToStored,
  hasUnsupportedMarkup,
  insertBlock,
  storedToEditor,
} from "./extensions";
import { ImageDialog } from "./image-dialog";
import { LinkDialog } from "./link-dialog";

// The post as the server page hands it over: plain values, dates as ISO text.
export type EditorPost = {
  id: string;
  slug: string;
  lang: PostLang;
  status: PostStatus;
  title: string;
  bodyHtml: string;
  excerpt: string | null;
  categoryId: string | null;
  authorId: string | null;
  tags: string[];
  featured: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  feedback: string | null;
  scheduledFor: string | null;
  // The token of the version on screen: sent back as if_updated_at, replaced by every answer.
  updatedAt: string;
};

type Props = {
  post: EditorPost;
  categories: readonly { id: string; namePt: string }[];
  authors: readonly { id: string; name: string }[];
  translation: { id: string; title: string; lang: PostLang } | null;
  // PUBLISH_TZ and its written-out name, read on the server.
  tz: string;
  zone: string;
};

// Same floor as UpsertPostSchema; the server checks again.
const MIN_TITLE = 8;

// Pixels between the caret and whatever edge it was scrolled away from: the bars at the top,
// the window's own edges elsewhere. ProseMirror's default margin is 5; a little more reads
// better under a bar.
const CARET_GAP = 8;

const ACTION_LABEL: Record<PostAction, string> = {
  submit: "Enviar para revisão",
  approve: "Aprovar",
  reopen: "Reabrir como rascunho",
  schedule: "Agendar",
  unschedule: "Desagendar",
  publish: "Publicar agora",
  unpublish: "Despublicar",
};

const SAVE_FIRST =
  "Salve as alterações antes de mudar o estado do post: o que vai para revisão, é aprovado ou publicado é o texto salvo, não o que está na tela.";

type Asking = "publish" | "unpublish" | "schedule" | "reject" | null;

// The mutable part of the post: what an action of this screen changes without a reload.
type Live = {
  status: PostStatus;
  scheduledFor: string | null;
  feedback: string | null;
  token: string;
};

export function PostEditor({ post, categories, authors, translation, tz, zone }: Props) {
  const router = useRouter();
  const saving = useAction();
  const moving = useAction();

  const [title, setTitle] = useState(post.title);
  const [settings, setSettings] = useState<PostSettingsValue>({
    categoryId: post.categoryId ?? "",
    authorId: post.authorId ?? "",
    tags: post.tags,
    pendingTag: "",
    excerpt: post.excerpt ?? "",
    coverUrl: post.coverUrl,
    coverAlt: post.coverAlt ?? "",
    featured: post.featured,
    metaTitle: post.metaTitle ?? "",
    metaDescription: post.metaDescription ?? "",
  });
  // The body in its stored form ({{shortcodes}}, no trailing empty paragraph).
  const [body, setBody] = useState(post.bodyHtml);
  const [live, setLive] = useState<Live>({
    status: post.status,
    scheduledFor: post.scheduledFor,
    feedback: post.feedback,
    token: post.updatedAt,
  });

  // What the server has. "Dirty" is the screen differing from this, field by field. A tag typed
  // and not yet closed is in `settings`, so it counts.
  const rest = JSON.stringify({ title, settings });
  const [savedBody, setSavedBody] = useState(post.bodyHtml);
  const [savedRest, setSavedRest] = useState(rest);
  const dirty = body !== savedBody || rest !== savedRest;

  const [titleProblem, setTitleProblem] = useState<string | null>(null);
  const [tagProblem, setTagProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [linking, setLinking] = useState(false);
  const [addingImage, setAddingImage] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [flattened, setFlattened] = useState(false);
  // Set when the admin chose to leave: the guards below then stand aside.
  const leaving = useRef(false);

  const editor = useEditor({
    extensions: editorExtensions,
    content: storedToEditor(post.bodyHtml),
    // Mandatory in the App Router: the document must not be built during the server render.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "post-body min-h-[26rem] px-4 py-4 outline-none",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Texto do post",
      },
      // The parser drops what the schema has no node for, silently. A pasted table arrives as
      // loose paragraphs; the admin is told, instead of finding out after publishing.
      transformPastedHTML: (html) => {
        if (hasUnsupportedMarkup(html)) setFlattened(true);
        return html;
      },
    },
    onCreate: ({ editor: created }) => {
      // The editor's own writing of the stored body is the baseline, not the stored string: a
      // body another tool wrote may come back with different markup for the same content, and
      // that is not an edit the admin made.
      const loaded = editorToStored(created.getHTML());
      setBody(loaded);
      setSavedBody(loaded);
    },
    onUpdate: ({ editor: current }) => setBody(editorToStored(current.getHTML())),
  });

  const stale = saving.error === STALE_POST_MESSAGE;
  const errorField = saving.error && !stale ? fieldForError(saving.error) : null;
  const fieldErrors: Partial<Record<EditorField, string>> = {
    ...(errorField && saving.error ? { [errorField]: saving.error } : {}),
    ...(tagProblem ? { tags: tagProblem } : {}),
  };

  function save() {
    // Nothing to save is nothing to send: a save always moves the token (staling every other
    // open editor of this post), writes an audit row and, on a published post, rebuilds the site.
    if (!dirty || stale || saving.pending) return;
    if (title.trim().length < MIN_TITLE) {
      setTitleProblem(`O título precisa de pelo menos ${MIN_TITLE} caracteres.`);
      return;
    }
    setTitleProblem(null);
    // A tag typed and not closed with Enter goes with this save, or stops it if it is not valid.
    const committed = commitPendingTag(settings);
    if (!committed.ok) {
      setTagProblem(committed.error);
      return;
    }
    setTagProblem(null);
    const current = committed.value;
    if (current !== settings) setSettings(current);
    setBlocked(null);
    // What is sent is what becomes "saved", even if the admin keeps typing during the request.
    const sent = { body, rest: JSON.stringify({ title, settings: current }) };
    saving.run(
      () =>
        updatePost(post.id, {
          // The full document, as every upsert: a field left out would be cleared.
          lang: post.lang,
          title,
          excerpt: current.excerpt,
          body_html: body,
          category_id: current.categoryId || null,
          author_id: current.authorId,
          tags: current.tags,
          featured: current.featured,
          meta_title: current.metaTitle,
          meta_description: current.metaDescription,
          cover_url: current.coverUrl,
          cover_alt: current.coverAlt,
          if_updated_at: live.token,
        }),
      (saved) => {
        setLive((now) => ({ ...now, token: saved.updatedAt, status: saved.status }));
        setSavedBody(sent.body);
        setSavedRest(sent.rest);
        setFlattened(false);
      },
      { after: "stay" },
    );
  }

  // Ctrl+S / Cmd+S anywhere on the page, and only that chord: with Shift it is the browser's
  // "save as" (Edge, Firefox), not ours. The handler reads the latest save through a ref, so the
  // listener is attached once.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      // Always ours, even with nothing to save: the browser's "save page" is never wanted here.
      event.preventDefault();
      saveRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The unsaved-changes guard. The App Router has no "about to leave this route" hook, so it is
  // made of the two things a page can see:
  // - beforeunload: reload, closing the tab, typing another address, a link to another site;
  // - a click on any same-origin link of the page (the top menu included), caught before Next
  //   handles it, and answered with a confirmation.
  // Not covered: the browser's back and forward buttons inside the app, which change the route
  // with no event a page can cancel.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (leaving.current) return;
      event.preventDefault();
      // Chrome needs returnValue set for the prompt to show.
      event.returnValue = "";
    }
    function onClick(event: MouseEvent) {
      if (leaving.current || event.defaultPrevented || event.button !== 0) return;
      // A modified click opens another tab or window: this page, and its text, stay.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      // A link in the text being written is text, not navigation.
      if (anchor.closest(".ProseMirror")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function leave() {
    if (!leaveTo) return;
    leaving.current = true;
    router.push(leaveTo);
  }

  // The save bar sticks to the top and the text toolbar sticks right under it. The bar wraps on
  // a narrow screen, so its height is measured, not assumed.
  const bar = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setBarHeight(bar.current?.offsetHeight ?? 0);
      setToolbarHeight(toolbar.current?.offsetHeight ?? 0);
    };
    const observer = new ResizeObserver(measure);
    if (bar.current) observer.observe(bar.current);
    if (toolbar.current) observer.observe(toolbar.current);
    return () => observer.disconnect();
  }, []);

  // The two sticky bars cover the top of the window, and the editor does not know it: moving up
  // by keyboard (or Ctrl+Home) it scrolled the caret to the very top, under them, and typing
  // there did not bring it back. scrollThreshold says how close to an edge counts as "out of
  // sight", scrollMargin how far from the edge the caret is put: at the top, both are what the
  // bars cover. Set on the view whenever a height changes (the save bar wraps on a narrow
  // screen).
  useEffect(() => {
    if (!editor) return;
    const covered = barHeight + toolbarHeight;
    editor.view.setProps({
      scrollThreshold: { top: covered, right: 0, bottom: 0, left: 0 },
      scrollMargin: { top: covered + CARET_GAP, right: CARET_GAP, bottom: CARET_GAP, left: CARET_GAP },
    });
  }, [editor, barHeight, toolbarHeight]);

  // After a change of state the button that was clicked is gone (the new state has other
  // actions), and focus would fall to <body>. It goes to the state heading instead, next to the
  // new actions; the live region below says the new state.
  const stateHeading = useRef<HTMLHeadingElement>(null);
  const focusState = useRef(false);
  // Runs after the render that shows the new state (and after a dialog that closed in the same
  // render gave focus back to a button that may be gone).
  useEffect(() => {
    if (!focusState.current) return;
    focusState.current = false;
    stateHeading.current?.focus();
  }, [live]);

  // A transition acts on what the server has. With unsaved changes it is refused here, so the
  // server never approves or publishes text the admin has not saved.
  function allowed(): boolean {
    if (stale) return false;
    if (dirty) {
      setBlocked(SAVE_FIRST);
      return false;
    }
    setBlocked(null);
    return true;
  }

  function move(action: PostAction) {
    if (!allowed()) return;
    moving.run(
      // With the token: if someone saved or moved the post since this screen last heard from
      // the server, the transition is refused as stale, instead of handing this screen a fresh
      // token over a version it never showed.
      () => setPostStatus({ id: post.id, action, if_updated_at: live.token }),
      (result) => {
        focusState.current = true;
        setLive((current) => ({
          status: result.status,
          token: result.updatedAt,
          // publish, unpublish and unschedule all clear the date (status.ts).
          scheduledFor: null,
          // approve clears the comment; reopen and the others keep it.
          feedback: action === "approve" ? null : current.feedback,
        }));
        setAsking(null);
      },
      { after: "stay", key: action },
    );
  }

  function ask(what: Exclude<Asking, null>) {
    if (allowed()) setAsking(what);
  }
  const stopAsking = () => {
    setAsking(null);
    moving.clearError();
  };

  // Both forms on the clipboard: pasted into the editor of the current version (the other tab)
  // the HTML keeps headings, links, images and blocks; pasted anywhere else, the plain text.
  async function copyText() {
    const text = editor?.getText({ blockSeparator: "\n\n" }) ?? "";
    const html = editor?.getHTML() ?? "";
    try {
      if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function") {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": new Blob([text], { type: "text/plain" }),
              "text/html": new Blob([html], { type: "text/html" }),
            }),
          ]);
          setCopied("yes");
          return;
        } catch {
          // Fall through to plain text: some browsers refuse text/html, or the whole call.
        }
      }
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  function reload() {
    leaving.current = true;
    window.location.reload();
  }

  const currentLink = (editor?.getAttributes("link").href as string | undefined) ?? null;

  function applyLink(href: string) {
    if (!editor) return;
    if (editor.state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: the address itself becomes the linked text.
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
        .run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  const actions: PostAction[] =
    live.status === "revisao" ? ["approve"] : rowActions({ status: live.status, scheduledFor: live.scheduledFor });
  const state = (action: PostAction) => ({
    pending: moving.isRunning(action),
    blocked: moving.pending && !moving.isRunning(action),
  });
  const scheduled = live.status === "aprovado" && live.scheduledFor ? live.scheduledFor : null;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <h1 className="sr-only">Editar post</h1>

      <div
        ref={bar}
        className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-bg px-4 py-3 sm:-mx-6 sm:px-6"
      >
        <Link href="/blog" className="text-sm text-muted hover:text-ink">
          ← Blog
        </Link>
        <StatusBadge status={live.status} />
        <p role="status" className={`text-sm ${dirty ? "text-warning" : "text-muted"}`}>
          {saving.pending ? "Salvando…" : dirty ? "Alterações não salvas" : "Tudo salvo"}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href={`/blog/${post.id}/previa`} className={buttonClass("secondary")}>
            Prévia do que está salvo
          </Link>
          {/* Not actionable with nothing to save. aria-disabled, not disabled (ui/button.tsx):
              the button keeps the focus it had when the save it started finishes. */}
          <Button
            variant="primary"
            pending={saving.pending}
            blocked={stale || !dirty}
            aria-keyshortcuts="Control+S Meta+S"
            onClick={save}
          >
            Salvar
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {live.status === "publicado" ? (
          <Notice tone="warning">
            Este post está no ar. Salvar vale na hora: o site é reconstruído com o texto novo em
            alguns minutos, sem passar por revisão.
          </Notice>
        ) : null}
        {hasUnsupportedMarkup(post.bodyHtml) ? (
          <Notice tone="warning">
            Este texto tem tabela ou figura com legenda, que o editor não sabe editar: aqui elas
            aparecem como parágrafos soltos, e salvar o texto grava assim. Se precisar delas, não
            salve por esta tela.
          </Notice>
        ) : null}
        {flattened ? (
          <div className="flex flex-wrap items-start gap-3">
            <Notice tone="warning" className="min-w-0 flex-1 basis-64">
              O que você colou tinha tabela ou figura com legenda. O editor não tem essas
              estruturas: o conteúdo entrou como parágrafos soltos. Confira o trecho colado.
            </Notice>
            <Button size="sm" variant="ghost" onClick={() => setFlattened(false)}>
              Entendi
            </Button>
          </div>
        ) : null}
        {stale ? (
          <div role="alert" className="space-y-3 rounded-md border border-deny/50 bg-elevated p-4 text-sm">
            <p className="text-deny">
              Alguém salvou este post, ou mudou o estado dele, depois que você abriu esta tela. O
              seu texto não foi gravado, e continua aqui embaixo.
            </p>
            <p className="text-muted">
              Para não perder o que escreveu: copie o seu texto, abra a versão atual em outra aba
              e cole lá o que for seu. Recarregar esta tela mostra a versão atual e descarta o que
              está nela.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={copyText}>
                Copiar o meu texto
              </Button>
              <a
                href={`/blog/${post.id}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("secondary", "sm")}
              >
                Abrir a versão atual em outra aba
              </a>
              <Button size="sm" variant="ghost" onClick={reload}>
                Recarregar e descartar o meu texto
              </Button>
            </div>
            {copied === "yes" ? <p className="text-settle">Texto copiado.</p> : null}
            {copied === "failed" ? (
              <p className="text-warning">
                O navegador não deixou copiar. Selecione o texto no editor e copie à mão.
              </p>
            ) : null}
          </div>
        ) : null}
        {saving.error && !stale && !errorField ? <Notice tone="error">{saving.error}</Notice> : null}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
          <TextField
            label="Título"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            error={titleProblem ?? fieldErrors.title}
          />

          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Texto</p>
            {/* Under the save bar while the text scrolls, on a long post. */}
            <div ref={toolbar} className="sticky z-10" style={{ top: barHeight }}>
              <EditorToolbar
                editor={editor}
                onLink={() => setLinking(true)}
                onImage={() => setAddingImage(true)}
              />
            </div>
            <div className="rounded-b-lg border border-t-0 border-line bg-surface focus-within:border-settle">
              <EditorContent editor={editor} />
              {editor ? null : <p className="px-4 py-4 text-sm text-muted">Carregando o editor…</p>}
            </div>
            {fieldErrors.body ? (
              <p role="alert" className="mt-1.5 text-xs text-deny">
                {fieldErrors.body}
              </p>
            ) : null}
          </div>
        </div>

        <aside className="space-y-5">
          <section aria-labelledby="state-heading" className="surface-card space-y-3 p-4">
            <h2
              id="state-heading"
              ref={stateHeading}
              tabIndex={-1}
              className="text-xs font-medium uppercase tracking-wide text-muted"
            >
              Estado
            </h2>
            {/* Announced when it changes: the visible badge alone says nothing to a screen reader
                whose focus was on a button that no longer exists. */}
            <p role="status" className="sr-only">
              Estado do post: {STATUS_LABEL[live.status]}
              {scheduled ? `, agendado para ${formatDateTime(scheduled, tz)}` : ""}.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={live.status} />
              {scheduled ? (
                <span className="text-muted">
                  agendado para{" "}
                  <span className="font-mono tabular-nums text-ink">
                    {formatDateTime(scheduled, tz)}
                  </span>
                </span>
              ) : null}
            </div>
            {scheduled ? <p className="text-xs text-muted">No fuso do blog: {zone}.</p> : null}
            {/* Whenever there is one: reopening a rejected post keeps the comment on purpose
                (status.ts), so the draft is fixed with it in sight. Approval clears it. */}
            {live.feedback ? (
              <p className="text-sm text-muted">
                <span className={live.status === "rejeitado" ? "text-deny" : "text-warning"}>
                  Comentário da última rejeição:
                </span>{" "}
                {live.feedback}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {actions.map((action) => {
                if (action === "publish" || action === "unpublish") {
                  return (
                    <Button
                      key={action}
                      size="sm"
                      variant={action === "publish" ? "primary" : "secondary"}
                      blocked={moving.pending || stale}
                      onClick={() => ask(action)}
                    >
                      {ACTION_LABEL[action]}
                    </Button>
                  );
                }
                if (action === "schedule") {
                  return (
                    <Button
                      key={action}
                      size="sm"
                      blocked={moving.pending || stale}
                      onClick={() => ask("schedule")}
                    >
                      {live.scheduledFor ? "Reagendar" : ACTION_LABEL.schedule}
                    </Button>
                  );
                }
                return (
                  <Button
                    key={action}
                    size="sm"
                    variant={action === "submit" || action === "approve" ? "primary" : "secondary"}
                    {...state(action)}
                    blocked={state(action).blocked || stale}
                    onClick={() => move(action)}
                  >
                    {ACTION_LABEL[action]}
                  </Button>
                );
              })}
              {live.status === "revisao" ? (
                <Button size="sm" blocked={moving.pending || stale} onClick={() => ask("reject")}>
                  Rejeitar
                </Button>
              ) : null}
            </div>
            {blocked ? <Notice tone="warning">{blocked}</Notice> : null}
            {moving.error && asking === null ? <Notice tone="error">{moving.error}</Notice> : null}
          </section>

          <div className="surface-card p-4">
            <PostSettings
              value={settings}
              onChange={(next) => {
                setTagProblem(null);
                setSettings(next);
              }}
              categories={categories}
              authors={authors}
              post={post}
              translation={translation}
              errors={fieldErrors}
            />
          </div>
        </aside>
      </div>

      <LinkDialog
        open={linking}
        onClose={() => setLinking(false)}
        current={currentLink}
        onApply={applyLink}
        onRemove={() => editor?.chain().focus().extendMarkRange("link").unsetLink().run()}
      />
      <ImageDialog
        open={addingImage}
        onClose={() => setAddingImage(false)}
        owner={{ postId: post.id }}
        title="Imagem no texto"
        confirmLabel="Inserir imagem"
        onChoose={(image) => {
          if (!editor) return;
          // insertBlock leaves a text cursor after the image: typing next must not replace it.
          insertBlock(editor, "image", {
            src: image.url,
            alt: image.alt,
            ...(image.width > 0 && image.height > 0
              ? { width: image.width, height: image.height }
              : {}),
          });
        }}
      />

      <ConfirmDialog
        open={asking === "publish"}
        title="Publicar agora?"
        confirmLabel="Publicar agora"
        pending={moving.pending}
        error={moving.error}
        onConfirm={() => move("publish")}
        onClose={stopAsking}
      >
        <span className="text-ink">{title}</span> entra no site público assim que o site for
        reconstruído, o que leva alguns minutos.
        {live.scheduledFor ? " O agendamento deste post é cancelado." : ""}
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "unpublish"}
        title="Despublicar?"
        confirmLabel="Despublicar"
        tone="danger"
        pending={moving.pending}
        error={moving.error}
        onConfirm={() => move("unpublish")}
        onClose={stopAsking}
      >
        <span className="text-ink">{title}</span> sai do site público e o link dele deixa de
        funcionar. O post volta para “Aprovado” e pode ser publicado de novo, no mesmo endereço.
      </ConfirmDialog>
      <ScheduleDialog
        open={asking === "schedule"}
        onClose={() => setAsking(null)}
        post={{ id: post.id, title, scheduledFor: live.scheduledFor, updatedAt: live.token }}
        tz={tz}
        zone={zone}
        // The editor keeps its own copy of the post: nothing is reloaded under the text.
        refresh={false}
        onDone={({ updatedAt, scheduledFor }) => {
          focusState.current = true;
          setLive((current) => ({ ...current, token: updatedAt, scheduledFor }));
        }}
      />
      <RejectDialog
        open={asking === "reject"}
        onClose={() => setAsking(null)}
        post={{ id: post.id, title, updatedAt: live.token }}
        refresh={false}
        onDone={({ updatedAt, feedback }) => {
          focusState.current = true;
          setLive({ status: "rejeitado", token: updatedAt, scheduledFor: null, feedback });
        }}
      />

      <ConfirmDialog
        open={leaveTo !== null}
        title="Sair sem salvar?"
        confirmLabel="Sair sem salvar"
        tone="danger"
        onConfirm={leave}
        onClose={() => setLeaveTo(null)}
      >
        Há alterações neste post que ainda não foram salvas. Saindo agora, elas se perdem.
      </ConfirmDialog>
    </main>
  );
}
