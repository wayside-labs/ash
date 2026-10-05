// A shortcode in the editor: a block of its own that cannot be typed into. The database never
// sees this span; shortcode-html.ts converts {{name}} to it on load and back on save.
import { Node, mergeAttributes } from "@tiptap/core";
import { SHORTCODE_LABELS } from "@/blog/lib/shortcode-html";

// The same grammar shortcode-html.ts accepts on the way back. A span whose name is anything else
// is not a shortcode and is not parsed as one.
const NAME_RE = /^[a-z]+(?::[a-z0-9-]+)?$/;

export function shortcodeLabel(name: string): string {
  return (SHORTCODE_LABELS as Record<string, string | undefined>)[name] ?? name;
}

export const ShortcodeNode = Node.create({
  name: "shortcode",
  // In no group, on purpose. The server refuses a shortcode anywhere but the top level
  // (validateShortcodes: the site cuts the body at each one), and "block" would let it into a
  // list item or a quote. The document names it instead (extensions.ts, TopLevelDocument), so
  // the top level is the only place the schema has for it.
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-shortcode") ?? "",
        renderHTML: (attributes) => ({ "data-shortcode": String(attributes.name ?? "") }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-shortcode]",
        getAttrs: (element) =>
          NAME_RE.test(element.getAttribute("data-shortcode") ?? "") ? null : false,
      },
    ];
  },

  // The label is the span's text, so the span that getHTML() returns is never empty;
  // editorHtmlToStored expects exactly that. The class is for the screen only: it never reaches
  // the stored body, where the whole span becomes {{name}}.
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class:
          "my-3 block rounded-md border border-dashed border-line-strong bg-elevated px-3 py-2 font-mono text-xs text-muted",
        contenteditable: "false",
      }),
      shortcodeLabel(String(node.attrs.name ?? "")),
    ];
  },
});
