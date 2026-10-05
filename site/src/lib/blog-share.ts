// The share row of a post: ordinary links to each network's own "share this address" page.
// Nothing is loaded from them and nothing is sent until the reader clicks.

export interface ShareLink { id: "x" | "linkedin" | "whatsapp" | "email"; href: string }

// Half of a pair of UTF-16 surrogates on its own is not a character, and encodeURIComponent
// throws on it ("URI malformed"). With the u flag a pair is one code point and never matches;
// what matches is the stray half, which becomes U+FFFD as it would on the page itself.
const LONE_SURROGATE = /\p{Cs}/gu;
const REPLACEMENT = String.fromCharCode(0xfffd);

// `url` is the post's absolute address; `title` is plain text and is only ever percent-encoded.
export function shareLinks(url: string, title: string): ShareLink[] {
  const text = title.replace(LONE_SURROGATE, REPLACEMENT);
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return [
    { id: "x", href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { id: "linkedin", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { id: "whatsapp", href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
    { id: "email", href: `mailto:?subject=${t}&body=${u}` },
  ];
}

// Names of companies, the same in every language; "email" takes its label from the copy.
export const SHARE_NAMES: Record<Exclude<ShareLink["id"], "email">, string> = { x: "X", linkedin: "LinkedIn", whatsapp: "WhatsApp" };
