import { defaultTreeAdapter as tree } from "parse5";
import { attribute, isElement, isText, parseBody, serializeNodes, type BodyElement, type BodyNode } from "./blog-html";
import { mediaHref } from "./blog-media";
import { isMediaPath } from "./blog-validate";

// Turns a post's `html` into what the page renders: stretches of markup and, between them, the
// components that stand in for the {{name}} markers. The body is parsed (blog-html.ts, which
// refuses anything outside the studio's allowlist), changed on the tree and written back: what a
// page inserts is never the studio's text as it came, it is the serialisation of a tree that was
// checked node by node. The only changes: images and links to /media/ point at the site's own
// copy, and images of the body load lazily.

// The studio's catalogue (studio/src/blog/lib/shortcodes.ts). A name missing here stops the
// build: a marker nobody renders would reach the reader as "{{...}}".
export const KNOWN_SHORTCODES = ["cta:pitch", "cta:newsletter", "cta:contato", "mapa"] as const;
export type KnownShortcode = (typeof KNOWN_SHORTCODES)[number];

export type BodySegment = { kind: "html"; html: string } | { kind: "shortcode"; name: KnownShortcode };

// The studio's grammar, not "anything between braces": text like "{{ x }}" is just text.
const SHORTCODE = /\{\{([a-z]+(?::[a-z0-9-]+)?)\}\}/g;

// Throws on anything the allowlist does not name. Nothing is returned: for the callers that only
// need the answer "could the studio have written this?".
export function assertSafeBody(html: string): void {
  parseBody(html);
}

function known(name: string): KnownShortcode {
  if (!(KNOWN_SHORTCODES as readonly string[]).includes(name)) throw new Error(`blog body: unknown shortcode {{${name}}}`);
  return name as KnownShortcode;
}

// A marker is only a block when it is text at the top level. Inside an element it cannot be
// cut out without handing the page two halves of that element.
function refuseMarkersInside(node: BodyNode): void {
  if (isText(node)) {
    for (const match of node.value.matchAll(SHORTCODE)) {
      throw new Error(`blog body: shortcode {{${known(match[1] as string)}}} is not at block level`);
    }
  } else if (isElement(node)) {
    node.childNodes.forEach(refuseMarkersInside);
  }
}

function setAttribute(el: BodyElement, name: string, value: string): void {
  const found = el.attrs.find((a) => a.name === name);
  if (found) found.value = value;
  else el.attrs.unshift({ name, value });
}

// The cover is the picture above the fold and loads eagerly; every image of the body can wait
// until it is near the screen.
function rewrite(node: BodyNode): void {
  if (!isElement(node)) return;
  if (node.tagName === "img") {
    setAttribute(node, "src", mediaHref(attribute(node, "src") as string));
    setAttribute(node, "decoding", "async");
    setAttribute(node, "loading", "lazy");
  }
  const href = node.tagName === "a" ? attribute(node, "href") : undefined;
  if (href !== undefined && isMediaPath(href)) setAttribute(node, "href", mediaHref(href));
  node.childNodes.forEach(rewrite);
}

// Throws on a body the studio's sanitizer could not have written, on a marker outside the
// catalogue and on one that is not at block level.
export function splitBody(html: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let run: BodyNode[] = [];
  const flush = () => {
    const written = serializeNodes(run);
    if (written.trim()) segments.push({ kind: "html", html: written });
    run = [];
  };

  for (const node of parseBody(html).nodes) {
    if (!isText(node)) {
      refuseMarkersInside(node);
      rewrite(node);
      run.push(node);
      continue;
    }
    let last = 0;
    for (const match of node.value.matchAll(SHORTCODE)) {
      const name = known(match[1] as string);
      const before = node.value.slice(last, match.index);
      if (before) run.push(tree.createTextNode(before));
      flush();
      segments.push({ kind: "shortcode", name });
      last = match.index + match[0].length;
    }
    const rest = node.value.slice(last);
    if (rest) run.push(tree.createTextNode(rest));
  }
  flush();
  return segments;
}
