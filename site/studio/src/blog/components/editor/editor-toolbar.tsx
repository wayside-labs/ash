"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
// The commands (toggleBold…) are typed by module augmentation of the extensions; without this
// type import this file does not see them.
import type {} from "@tiptap/starter-kit";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { SHORTCODE_LABELS } from "@/blog/lib/shortcode-html";
import { KNOWN_SHORTCODES } from "@/blog/lib/shortcodes";
import { insertBlock } from "./extensions";

// A button exists here only for what the sanitizer keeps (extensions.ts holds the same rule for
// the schema, and tests/editor-roundtrip.test.ts runs every one of these commands through the
// save path). No underline: the allowlist has no <u>.
type Tool = {
  key: string;
  // What the button shows, and its full name for a screen reader and the tooltip.
  face: ReactNode;
  name: string;
  active: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const TOOLS: Tool[] = [
  {
    key: "bold",
    face: <span className="font-semibold">N</span>,
    name: "Negrito",
    active: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    key: "italic",
    face: <span className="italic">I</span>,
    name: "Itálico",
    active: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    key: "strike",
    face: <span className="line-through">R</span>,
    name: "Riscado",
    active: (e) => e.isActive("strike"),
    run: (e) => e.chain().focus().toggleMark("strike").run(),
  },
  {
    key: "code",
    face: <span className="font-mono text-xs">{"</>"}</span>,
    name: "Código no meio do texto",
    active: (e) => e.isActive("code"),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    key: "h2",
    face: "H2",
    name: "Título de seção",
    active: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    face: "H3",
    name: "Subtítulo",
    active: (e) => e.isActive("heading", { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    key: "bulletList",
    face: "Lista",
    name: "Lista com marcadores",
    active: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: "orderedList",
    face: "1. Lista",
    name: "Lista numerada",
    active: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "blockquote",
    face: "Citação",
    name: "Citação",
    active: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    key: "codeBlock",
    face: "Bloco de código",
    name: "Bloco de código",
    active: (e) => e.isActive("codeBlock"),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: "rule",
    face: "Linha",
    name: "Linha divisória",
    active: () => false,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

// min 28 px each way: a one-letter button ("I") is otherwise narrower than a finger or a
// pointer target should be (WCAG 2.2, 2.5.8 asks for 24).
const BUTTON =
  "inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-2 py-1 text-[13px] text-muted hover:bg-elevated hover:text-ink aria-pressed:bg-elevated aria-pressed:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export function EditorToolbar({
  editor,
  onLink,
  onImage,
  disabled = false,
}: {
  editor: Editor | null;
  // The dialogs live in the editor component, which also knows the post the image belongs to.
  onLink: () => void;
  onImage: () => void;
  disabled?: boolean;
}) {
  // The editor does not re-render React on its own: this subscribes to what the buttons show.
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            ...Object.fromEntries(TOOLS.map((tool) => [tool.key, tool.active(current)])),
            link: current.isActive("link"),
          }
        : null,
  }) as Record<string, boolean> | null;

  const inert = disabled || !editor;
  const guard = (run: () => void) => () => {
    if (!inert) run();
  };

  const buttons = [
    ...TOOLS.map((tool) => ({
      key: tool.key,
      name: tool.name,
      face: tool.face,
      pressed: active?.[tool.key] ?? false,
      run: () => editor && tool.run(editor),
    })),
    { key: "link", name: "Link", face: "Link" as ReactNode, pressed: active?.link ?? false, run: onLink },
    // Not a toggle: no pressed state.
    { key: "image", name: "Imagem", face: "Imagem" as ReactNode, pressed: null, run: onImage },
  ];

  // The toolbar pattern: one tab stop for the whole row, the arrow keys move inside it. Tab
  // then goes straight from the title to the toolbar to the text, not through thirteen buttons.
  const [current, setCurrent] = useState(0);
  const row = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = buttons.length - 1;
    const next =
      event.key === "ArrowRight"
        ? current === last
          ? 0
          : current + 1
        : event.key === "ArrowLeft"
          ? current === 0
            ? last
            : current - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setCurrent(next);
    row.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  return (
    // One row that scrolls sideways on a narrow screen instead of wrapping into three: it sticks
    // to the top while the text scrolls, and must not take the screen from the text.
    <div className="flex items-center gap-2 rounded-t-lg border border-line bg-surface px-2 py-1.5">
      <div
        ref={row}
        role="toolbar"
        aria-label="Formatação do texto"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:flex-wrap sm:overflow-visible"
      >
        {buttons.map((button, index) => (
          <button
            key={button.key}
            type="button"
            title={button.name}
            aria-label={button.name}
            aria-pressed={button.pressed ?? undefined}
            aria-disabled={inert || undefined}
            tabIndex={index === current ? 0 : -1}
            onFocus={() => setCurrent(index)}
            onClick={guard(button.run)}
            className={BUTTON}
          >
            {button.face}
          </button>
        ))}
      </div>
      {/* Outside the toolbar's arrow keys, with a tab stop of its own: in a select the arrows
          choose the option. Native, so the keyboard works with no code of ours. */}
      <select
        aria-label="Inserir bloco especial"
        value=""
        disabled={inert}
        onChange={(event) => {
          const name = event.target.value;
          if (!name || !editor) return;
          insertBlock(editor, "shortcode", { name });
        }}
        className="min-h-7 shrink-0 rounded-md border border-line-strong bg-bg px-2 py-1 text-[13px] text-muted"
      >
        <option value="">Bloco especial…</option>
        {KNOWN_SHORTCODES.map((name) => (
          <option key={name} value={name}>
            {SHORTCODE_LABELS[name]}
          </option>
        ))}
      </select>
    </div>
  );
}
