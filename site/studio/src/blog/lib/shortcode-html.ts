// The database never sees the span: the editor converts on load and back on save, so
// shortcodes.ts and the public renderer only ever deal with {{name}}.
import type { KnownShortcode } from "./shortcodes";

const STORED_RE = /\{\{([a-z]+(?::[a-z0-9-]+)?)\}\}/g;

// One bounded run for the attributes and one for the label, neither able to cross a "<": the
// earlier version had two [^>]* around the capture and went cubic on repeated '<span data-…'.
// The label run exists because the editor node renders its label as the span's text, so the span
// that comes back from getHTML() is never empty.
const SPAN_RE = /<span\b([^<>]{0,500})>[^<]{0,200}<\/span>/gi;
const NAME_ATTR_RE = /(?:^|\s)data-shortcode="([^"]*)"/;
const NAME_RE = /^[a-z]+(?::[a-z0-9-]+)?$/;

export const SHORTCODE_LABELS: Record<KnownShortcode, string> = {
  "cta:pitch": "CTA: pitch",
  "cta:newsletter": "CTA: newsletter",
  "cta:contato": "CTA: contato",
  mapa: "Mapa do fluxo",
};

export function storedHtmlToEditor(html: string): string {
  return html.replace(STORED_RE, (_m, name: string) => `<span data-shortcode="${name}"></span>`);
}

// A span is replaced only when its name follows the shortcode grammar. The name ends up between
// braces in the stored body, so anything else would be text injected through an attribute.
export function editorHtmlToStored(html: string): string {
  return html.replace(SPAN_RE, (whole, attributes: string) => {
    const name = NAME_ATTR_RE.exec(attributes)?.[1];
    return name !== undefined && NAME_RE.test(name) ? `{{${name}}}` : whole;
  });
}
