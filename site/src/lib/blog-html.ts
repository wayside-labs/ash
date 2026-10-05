import { defaultTreeAdapter as tree, html as spec, parseFragment, serializeOuter, type DefaultTreeAdapterTypes as Tree } from "parse5";
import { isMediaPath } from "./blog-validate";

// The body of a post is the one field of the payload that reaches a page as markup, so the build
// reads it the way a browser will (parse5 is the HTML standard's own parsing algorithm) and
// accepts only what the studio's sanitizer writes. An allowlist, like the studio's: an element,
// an attribute or a kind of node that is not named here stops the build. Nothing is repaired or
// dropped: a body that does not pass is a body the studio could not have sent, and the right
// answer to that is no deploy.
//
// The lists below are studio/src/blog/lib/sanitize.ts and href.ts, copied. The site never imports
// studio code; tests/unit/blog-html.test.ts reads those two files and fails when a list here and
// a list there stop matching.

export const ALLOWED_TAGS: readonly string[] = [
  "h2", "h3", "h4",
  "p", "br", "hr",
  "ul", "ol", "li",
  "strong", "em", "del", "code", "pre",
  "blockquote",
  "a",
  "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
];

// Every other element takes no attribute at all.
export const ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  h2: ["id"],
  h3: ["id"],
  h4: ["id"],
  a: ["href", "title"],
  img: ["src", "alt", "width", "height"],
  th: ["align"],
  td: ["align"],
};

// The studio's isSafeHref: https://, http://, mailto:, an anchor, or a path from the root. It
// judges the decoded value, which is what the parser hands over, so "java&#115;cript:" is judged
// as the scheme it is.
export const SAFE_HREF_RE = /^(?:https?:\/\/|mailto:|#|\/(?![/\\]))/i;

export function isSafeHref(href: string): boolean {
  for (let i = 0; i < href.length; i++) {
    const code = href.charCodeAt(i);
    // A backslash anywhere, or a control character: browsers delete tab and newline before
    // resolving, so "/<tab>/evil.com" is "//evil.com".
    if (code === 0x5c || code <= 0x1f || code === 0x7f) return false;
  }
  return SAFE_HREF_RE.test(href);
}

export type BodyNode = Tree.ChildNode;
export type BodyElement = Tree.Element;

export interface ParsedBody {
  // The top-level nodes, in order: elements and text, nothing else anywhere below.
  nodes: BodyNode[];
  // Every /media/ path the body refers to (image src, link href), in document order.
  media: string[];
  // The ids on its headings.
  ids: string[];
}

export const isElement = (node: BodyNode): node is BodyElement => tree.isElementNode(node);
export const isText = (node: BodyNode): node is Tree.TextNode => tree.isTextNode(node);
export const attribute = (el: BodyElement, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;
export const serializeNodes = (nodes: readonly BodyNode[]): string => nodes.map((node) => serializeOuter(node)).join("");

const refuse = (reason: string): never => { throw new Error(`blog body: ${reason}`); };

// Parsed as the content of a <div>, which is where the page puts it.
function parse(source: string): BodyNode[] {
  return parseFragment(tree.createElement("div", spec.NS.HTML, []), source, {}).childNodes;
}

// Throws on the first thing outside the allowlist. The message names the element or attribute,
// never its value.
export function parseBody(source: string): ParsedBody {
  const nodes = parse(source);
  const media: string[] = [];
  const ids: string[] = [];

  const walk = (node: BodyNode): void => {
    if (isText(node)) return;
    if (!isElement(node)) return refuse(`a ${node.nodeName.replace("#", "")} is not markup the studio emits`);
    const tag = node.tagName;
    if (node.namespaceURI !== spec.NS.HTML || !ALLOWED_TAGS.includes(tag)) return refuse(`<${tag}> is not markup the studio emits`);
    const allowed = ALLOWED_ATTRIBUTES[tag] ?? [];
    for (const { name } of node.attrs) {
      if (!allowed.includes(name)) refuse(`the attribute "${name}" on <${tag}> is not markup the studio emits`);
    }
    if (tag === "img") {
      const src = attribute(node, "src");
      if (src === undefined || !isMediaPath(src)) return refuse("an image whose src is not a /media/ path");
      media.push(src);
    }
    if (tag === "a") {
      const href = attribute(node, "href");
      if (href !== undefined && !isSafeHref(href)) return refuse("a link whose href is not http(s), mailto, an anchor or a path of this site");
      if (href !== undefined && isMediaPath(href)) media.push(href);
    }
    const id = attribute(node, "id");
    if (id !== undefined) ids.push(id);
    node.childNodes.forEach(walk);
  };
  nodes.forEach(walk);

  // What the page receives is this tree written back as text, which a browser then parses again.
  // If a second parse of that text gives another tree, the first one was not what the reader's
  // browser would build, and nothing checked above can be trusted.
  const written = serializeNodes(nodes);
  if (serializeNodes(parse(written)) !== written) refuse("the markup does not read the same on a second parse");

  return { nodes, media, ids };
}
