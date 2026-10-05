// The short slug of a category or an author, for the forms. The check is the schema's own field,
// not a copy of its pattern: the form and the server cannot come to disagree.
import { UpsertCategorySchema } from "../schemas";
import { slugify } from "./post-slug";

const SHORT_SLUG_MAX = 60;

export const SHORT_SLUG_HELP =
  "Use letras minúsculas sem acento, números e hífen: de 2 a 60 caracteres, sem hífen no começo nem no fim.";

export function isShortSlug(value: string): boolean {
  return UpsertCategorySchema.shape.slug.safeParse(value).success;
}

// A starting point typed from the name; may be too short to be valid, and the form says so.
export function suggestShortSlug(name: string): string {
  return slugify(name).slice(0, SHORT_SLUG_MAX).replace(/-+$/, "");
}
