import { POST_LANG, POST_STATUS } from "@/db/schema";
import { POST_LANGS } from "../schemas";
import {
  LANG_LABEL,
  POST_STATUSES,
  type PostStatus,
  STATUS_LABEL,
  otherLang,
  rowActions,
} from "./post-status";

describe("estados do post para a tela", () => {
  it("a lista é a mesma do banco, na mesma ordem", () => {
    expect([...POST_STATUSES]).toEqual([...POST_STATUS]);
  });

  it("todo estado e todo idioma têm nome em português", () => {
    for (const status of POST_STATUS) expect(STATUS_LABEL[status]).toMatch(/\S/);
    for (const lang of POST_LANG) expect(LANG_LABEL[lang]).toMatch(/\S/);
    expect(Object.keys(LANG_LABEL).sort()).toEqual([...POST_LANGS].sort());
  });

  it("o outro idioma", () => {
    expect(otherLang("pt")).toBe("en");
    expect(otherLang("en")).toBe("pt");
  });
});

describe("rowActions: o que cada estado deixa fazer", () => {
  const WHEN = "2026-12-01T12:00:00.000Z";
  const cases: [PostStatus, string | null, string[]][] = [
    ["rascunho", null, ["submit"]],
    // Approve and reject live in the review tab, with the feedback dialog.
    ["revisao", null, []],
    ["aprovado", null, ["publish", "schedule"]],
    ["aprovado", WHEN, ["publish", "schedule", "unschedule"]],
    ["publicado", null, ["unpublish"]],
    ["rejeitado", null, ["reopen"]],
    // A date left on a state that cannot be scheduled changes nothing.
    ["rascunho", WHEN, ["submit"]],
    ["publicado", WHEN, ["unpublish"]],
  ];
  for (const [status, scheduledFor, expected] of cases) {
    it(`${status}${scheduledFor ? " com data" : ""}: ${expected.join(", ") || "nada"}`, () => {
      expect(rowActions({ status, scheduledFor })).toEqual(expected);
    });
  }
});
