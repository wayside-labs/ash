/**
 * Text handling for the knowledge base: extraction from what an operator uploads, chunking,
 * and the lexical half of retrieval. Kept free of I/O so it is testable offline.
 */

export const CHUNK_CHARS = 1_200;
export const CHUNK_OVERLAP = 200;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Readable text from HTML: scripts, styles and markup gone, block structure kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre)\b[^>]*>/gi,
      "\n\n",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Paragraph-aware chunks of roughly `size` characters, overlapping so a sentence cut at a
 * boundary is still whole in one of the two neighbours.
 */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = current.length > overlap ? current.slice(-overlap) : "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      for (let i = 0; i < paragraph.length; i += size - overlap) {
        if (current) flush();
        current = paragraph.slice(i, i + size);
        flush();
      }
      current = "";
      continue;
    }
    if (current.length + paragraph.length + 2 > size) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]{2,}/g) ?? []
  );
}

/** Okapi BM25 over the candidate chunks. k1/b are the textbook defaults. */
export function bm25(query: string, docs: string[], k1 = 1.2, b = 0.75): number[] {
  const q = [...new Set(tokens(query))];
  const docTokens = docs.map(tokens);
  const n = docs.length;
  const avg = docTokens.reduce((sum, d) => sum + d.length, 0) / Math.max(n, 1);
  const df = new Map<string, number>();
  for (const d of docTokens) for (const term of new Set(d)) df.set(term, (df.get(term) ?? 0) + 1);
  return docTokens.map((d) => {
    const tf = new Map<string, number>();
    for (const term of d) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / Math.max(avg, 1)));
    }
    return score;
  });
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
