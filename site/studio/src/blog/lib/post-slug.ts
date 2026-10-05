const MAX_LENGTH = 120;
// blog_posts_slug_chk needs at least two characters; a title made of symbols leaves fewer.
const FALLBACK = "post";

// No floor: may come back empty or with a single character. toc.ts uses it for heading ids,
// which have their own fallback.
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    // Strips the accents, not the letters. Written as escapes: boringco's source had the raw
    // combining bytes in the regex, invisible in an editor.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function postSlug(title: string): string {
  const slug = slugify(title);
  return slug.length < 2 ? FALLBACK : slug;
}
