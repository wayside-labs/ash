// What a server page hands to the list components. A Drizzle row carries Date objects and the
// ids of its category and author; a client component gets plain text: ISO instants and names.
import type { PostListItem } from "../posts";
import type { PostLang, PostStatus } from "./post-status";

export type PostRowView = {
  id: string;
  title: string;
  slug: string;
  lang: PostLang;
  status: PostStatus;
  excerpt: string | null;
  feedback: string | null;
  categoryName: string | null;
  authorName: string | null;
  updatedAt: string;
  publishedAt: string | null;
  scheduledFor: string | null;
  // Approved, with a date that has passed: publish-due.ts should have taken it and did not.
  // Decided on the server, with the server's clock, so the first render and hydration agree.
  overdue: boolean;
  hasTranslation: boolean;
};

export function toPostRows(
  posts: readonly PostListItem[],
  context: {
    categories: readonly { id: string; namePt: string }[];
    authors: readonly { id: string; name: string }[];
    translated: ReadonlySet<string>;
    now: Date;
  },
): PostRowView[] {
  const categoryNames = new Map(context.categories.map((c) => [c.id, c.namePt]));
  const authorNames = new Map(context.authors.map((a) => [a.id, a.name]));
  return posts.map((post) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    lang: post.lang,
    status: post.status,
    excerpt: post.excerpt,
    feedback: post.feedback,
    categoryName: (post.categoryId && categoryNames.get(post.categoryId)) || null,
    authorName: (post.authorId && authorNames.get(post.authorId)) || null,
    updatedAt: post.updatedAt.toISOString(),
    publishedAt: post.publishedAt?.toISOString() ?? null,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    overdue:
      post.status === "aprovado" &&
      post.scheduledFor !== null &&
      post.scheduledFor.getTime() <= context.now.getTime(),
    hasTranslation: context.translated.has(post.translationGroup),
  }));
}
