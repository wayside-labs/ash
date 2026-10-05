import type { PostListItem } from "../posts";
import { toPostRows } from "./list-rows";

const NOW = new Date("2026-10-05T12:00:00.000Z");

function post(overrides: Partial<PostListItem> = {}): PostListItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "um-post",
    lang: "pt",
    translationGroup: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Um post qualquer",
    excerpt: null,
    categoryId: null,
    authorId: null,
    tags: [],
    status: "rascunho",
    featured: false,
    coverUrl: null,
    coverAlt: null,
    feedback: null,
    metaTitle: null,
    metaDescription: null,
    scheduledFor: null,
    publishedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-02T10:00:00.000Z"),
    ...overrides,
  };
}

const CONTEXT = {
  categories: [{ id: "c1", namePt: "Produto" }],
  authors: [{ id: "a1", name: "Lucas" }],
  translated: new Set<string>(),
  now: NOW,
};

describe("toPostRows", () => {
  it("datas viram texto ISO e nada de Date sobra na linha", () => {
    const [row] = toPostRows(
      [
        post({
          publishedAt: new Date("2026-10-03T10:00:00.000Z"),
          scheduledFor: new Date("2026-10-09T10:00:00.000Z"),
        }),
      ],
      CONTEXT,
    );
    expect(row?.updatedAt).toBe("2026-10-02T10:00:00.000Z");
    expect(row?.publishedAt).toBe("2026-10-03T10:00:00.000Z");
    expect(row?.scheduledFor).toBe("2026-10-09T10:00:00.000Z");
    for (const value of Object.values(row ?? {})) expect(value).not.toBeInstanceOf(Date);
    // What crosses to the client survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it("categoria e autor viram nome; os que não existem mais viram null", () => {
    const rows = toPostRows(
      [
        post({ categoryId: "c1", authorId: "a1" }),
        post({ categoryId: "apagada", authorId: null }),
      ],
      CONTEXT,
    );
    expect(rows[0]).toMatchObject({ categoryName: "Produto", authorName: "Lucas" });
    expect(rows[1]).toMatchObject({ categoryName: null, authorName: null });
  });

  it("hasTranslation vem do grupo de tradução", () => {
    const rows = toPostRows(
      [post(), post({ translationGroup: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
      { ...CONTEXT, translated: new Set(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]) },
    );
    expect(rows.map((r) => r.hasTranslation)).toEqual([false, true]);
  });

  describe("overdue: aprovado com data que já passou", () => {
    const cases: [string, Partial<PostListItem>, boolean][] = [
      ["data no passado", { status: "aprovado", scheduledFor: new Date("2026-10-05T11:59:59.000Z") }, true],
      ["data exatamente agora", { status: "aprovado", scheduledFor: NOW }, true],
      ["data no futuro", { status: "aprovado", scheduledFor: new Date("2026-10-05T12:00:01.000Z") }, false],
      ["aprovado sem data", { status: "aprovado", scheduledFor: null }, false],
      ["outro estado com data velha", { status: "rascunho", scheduledFor: new Date("2020-01-01T00:00:00.000Z") }, false],
    ];
    for (const [label, overrides, expected] of cases) {
      it(label, () => {
        expect(toPostRows([post(overrides)], CONTEXT)[0]?.overdue).toBe(expected);
      });
    }
  });
});
