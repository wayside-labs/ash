// The one configuration of the editor, used by the component and by
// tests/editor-roundtrip.test.ts. The rule that governs it: every node and mark switched on here
// renders a tag that sanitizePostHtml keeps (ALLOWED_TAGS in lib/sanitize.ts). One that does not
// fails cruelly: the admin formats the text, sees it on screen, saves, and the formatting is
// gone with no error. The round-trip test is what holds the two lists together.
//
// Client-safe: no import here may reach sanitize-html (tests/client-bundle.test.ts).
import { type Editor, Extension, type Extensions, Mark, Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { isSafeHref } from "@/blog/lib/href";
import { isMediaPath } from "@/blog/lib/image-rules";
import { editorHtmlToStored, storedHtmlToEditor } from "@/blog/lib/shortcode-html";
import { ShortcodeNode } from "./shortcode-node";

// StarterKit's document is "block+". This one names the shortcode next to it, and the shortcode
// belongs to no group: the top level is then the only place the schema lets it be. Pasted or
// dragged into a list item or a quote, it is lifted out to the top by the parser itself, instead
// of landing where the server would refuse the save (validateShortcodes: block level only).
const TopLevelDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(block | shortcode)+",
});

// Only images of our own /media, as the sanitizer demands: a pasted <img> from anywhere else is
// not parsed into the document at all, instead of being shown now and stripped on save.
const MediaImage = Image.extend({
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (element) => (isMediaPath(element.getAttribute("src") ?? "") ? null : false),
      },
    ];
  },
}).configure({ inline: false, allowBase64: false });

// StarterKit's strike renders <s>, and the allowlist has <del>. This one reads all three
// spellings and writes the one that is kept. No keyboard shortcut: the usual one (Mod-Shift-S)
// belongs to the browser in Edge and Firefox, and none is better than one that clashes.
const Strike = Mark.create({
  name: "strike",
  parseHTML() {
    return [{ tag: "del" }, { tag: "s" }, { tag: "strike" }];
  },
  renderHTML() {
    return ["del", 0];
  },
});

// Puts a block that cannot be typed into (a shortcode, an image) in the document, and leaves a
// text cursor after it.
//
// insertContent would leave the new node selected: the next key typed replaces it, and Enter
// deletes it. And with the cursor inside a list item or a quote it would put the node in there.
// So: the block goes at the top level, in place of the empty paragraph the cursor is in or else
// after the top-level block around the cursor; a paragraph follows it (the next one, or a new
// one), and the cursor goes into that paragraph.
export function insertBlock(
  editor: Editor,
  type: "shortcode" | "image",
  attrs: Record<string, unknown>,
): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const nodeType = state.schema.nodes[type];
      if (!nodeType || !state.schema.nodes.paragraph) return false;
      if (dispatch) placeBlock(tr, nodeType.create(attrs)).scrollIntoView();
      return true;
    })
    .run();
}

// The placement itself, on the transaction as it stands (so several blocks can be placed one
// after the other in the same transaction: each lands after the previous one).
function placeBlock(tr: Transaction, block: ProseMirrorNode): Transaction {
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  if (!paragraph) return tr;
  const { $from, to } = tr.selection;

  let at: number;
  const around = $from.depth >= 1 ? $from.node(1) : null;
  if ($from.depth === 1 && around?.type === paragraph && around.content.size === 0) {
    at = $from.before(1);
    tr.replaceWith(at, $from.after(1), block);
  } else {
    // depth 0 is a selected top-level node (a chip that was clicked): go after it.
    at = $from.depth === 0 ? to : $from.after(1);
    tr.insert(at, block);
  }

  const after = at + block.nodeSize;
  if (tr.doc.resolve(after).nodeAfter?.type !== paragraph) tr.insert(after, paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, after + 1));
}

// A pasted chip (copied from this editor, or from the stale-version panel) goes where the
// toolbar would have put it. Left to the default paste, a chip pasted with the cursor inside a
// list item split the list around itself and left an empty bullet behind. Only a paste that is
// nothing but chips is taken over; anything else is the default paste.
const ShortcodePaste = Extension.create({
  name: "shortcodePaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, _event, slice) {
            const chips: ProseMirrorNode[] = [];
            slice.content.forEach((node) => chips.push(node));
            if (chips.length === 0 || chips.some((node) => node.type.name !== "shortcode")) {
              return false;
            }
            const tr = view.state.tr;
            for (const chip of chips) placeBlock(tr, chip);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

export const editorExtensions: Extensions = [
  TopLevelDocument,
  StarterKit.configure({
    document: false,
    // h1 is the post title. The toolbar offers h2 and h3 (what the table of contents lists);
    // h4 is in the schema only so a stored <h4> is not flattened into a paragraph by an edit.
    heading: { levels: [2, 3, 4] },
    // Off because of what they render: <s> (replaced by Strike above) and <u> (not allowed, and
    // underlined text on the web reads as a link that does not work).
    strike: false,
    underline: false,
    link: {
      // A click in the editor places the cursor; it never navigates away from unsaved text.
      openOnClick: false,
      // The same rule the sanitizer applies to href, so nothing is linked here that the save
      // would unlink: http(s), mailto, an anchor, or a path from the root.
      isAllowedUri: (url) => isSafeHref(url),
      shouldAutoLink: (url) => isSafeHref(url),
      defaultProtocol: "https",
      // The sanitizer keeps href and title only; do not write what it would remove.
      HTMLAttributes: { target: null, rel: null, class: null },
    },
  }),
  Strike,
  MediaImage,
  ShortcodeNode,
  ShortcodePaste,
];

// The sanitizer keeps these, and the editor has no node for them: loading such a body turns a
// table into loose paragraphs and a figure into an image plus a paragraph. Nothing in the panel
// writes them (they would come from psql or an import), so the editor warns instead of growing a
// table editor. tests/editor-roundtrip.test.ts pins the list.
const UNSUPPORTED_RE = /<(?:table|figure)\b/i;

export function hasUnsupportedMarkup(stored: string): boolean {
  return UNSUPPORTED_RE.test(stored);
}

const EMPTY_PARAGRAPH = "<p></p>";

// What the editor is given for a stored body.
export function storedToEditor(stored: string): string {
  return storedHtmlToEditor(stored) || EMPTY_PARAGRAPH;
}

// What goes to the server for the editor's document. The editor keeps an empty paragraph after
// a last block that is not text (an image, a shortcode, a list), so there is always somewhere to
// type; those are the editor's, not the author's, and are dropped. A blank document comes out as
// the empty string. Index arithmetic, not a regex anchored at the end: that one is quadratic on
// a long run of empty paragraphs.
export function editorToStored(editorHtml: string): string {
  const stored = editorHtmlToStored(editorHtml);
  let end = stored.length;
  while (end >= EMPTY_PARAGRAPH.length && stored.startsWith(EMPTY_PARAGRAPH, end - EMPTY_PARAGRAPH.length)) {
    end -= EMPTY_PARAGRAPH.length;
  }
  return stored.slice(0, end);
}
