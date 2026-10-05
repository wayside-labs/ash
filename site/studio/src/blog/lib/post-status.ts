// What the screens need to know about a post's state, with no import from the database layer:
// client components use this, and @/db/schema must never reach their bundle
// (tests/client-bundle.test.ts). post-status.test.ts holds the list equal to the schema's.
import type { POST_LANGS, PostAction } from "../schemas";

export const POST_STATUSES = ["rascunho", "revisao", "aprovado", "publicado", "rejeitado"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export type PostLang = (typeof POST_LANGS)[number];

export const STATUS_LABEL: Record<PostStatus, string> = {
  rascunho: "Rascunho",
  revisao: "Em revisão",
  aprovado: "Aprovado",
  publicado: "Publicado",
  rejeitado: "Rejeitado",
};

export const LANG_LABEL: Record<PostLang, string> = { pt: "Português", en: "Inglês" };

export function otherLang(lang: PostLang): PostLang {
  return lang === "pt" ? "en" : "pt";
}

// The transitions a list row offers, in the order the buttons appear. It mirrors MACHINE in
// status.ts, minus approve and reject: those belong to the review tab, where the feedback is.
export function rowActions(post: {
  status: PostStatus;
  scheduledFor: string | null;
}): PostAction[] {
  switch (post.status) {
    case "rascunho":
      return ["submit"];
    case "revisao":
      return [];
    case "aprovado":
      return post.scheduledFor ? ["publish", "schedule", "unschedule"] : ["publish", "schedule"];
    case "publicado":
      return ["unpublish"];
    case "rejeitado":
      return ["reopen"];
  }
}
