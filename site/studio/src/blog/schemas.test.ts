import { POST_LANG } from "@/db/schema";
import {
  POST_ACTIONS,
  POST_LANGS,
  RejectPostSchema,
  SetPostStatusSchema,
  UpsertAuthorSchema,
  UpsertCategorySchema,
  UpsertPostSchema,
} from "./schemas";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe("SetPostStatusSchema", () => {
  it("aceita agendamento pra daqui a 7 dias", () => {
    const r = SetPostStatusSchema.safeParse({
      id: ID,
      action: "schedule",
      scheduled_for: inDays(7),
    });
    expect(r.success).toBe(true);
  });

  it("exige data quando a ação é agendar", () => {
    const r = SetPostStatusSchema.safeParse({ id: ID, action: "schedule" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Escolha uma data.");
    expect(r.error?.issues[0]?.path).toEqual(["scheduled_for"]);
  });

  it("recusa data no passado apontando o botão de publicar agora, pelo nome que ele tem na tela", () => {
    const r = SetPostStatusSchema.safeParse({
      id: ID,
      action: "schedule",
      scheduled_for: inDays(-1),
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(
      'Data precisa ser no futuro. Para agora, use "Publicar agora".',
    );
  });

  it("recusa data além de 12 meses", () => {
    const r = SetPostStatusSchema.safeParse({
      id: ID,
      action: "schedule",
      scheduled_for: inDays(400),
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("12 meses");
    expect(
      SetPostStatusSchema.safeParse({ id: ID, action: "schedule", scheduled_for: inDays(360) })
        .success,
    ).toBe(true);
  });

  it("publish não exige data", () => {
    expect(SetPostStatusSchema.safeParse({ id: ID, action: "publish" }).success).toBe(true);
  });

  it("unpublish ignora data no passado (o refine só morde no schedule)", () => {
    const r = SetPostStatusSchema.safeParse({
      id: ID,
      action: "unpublish",
      scheduled_for: inDays(-30),
    });
    expect(r.success).toBe(true);
  });

  it("aceita as ações da máquina do M1 e só elas", () => {
    expect([...POST_ACTIONS]).toEqual([
      "submit",
      "approve",
      "reopen",
      "schedule",
      "unschedule",
      "publish",
      "unpublish",
    ]);
    for (const action of ["submit", "approve", "reopen", "unschedule", "publish", "unpublish"]) {
      expect(SetPostStatusSchema.safeParse({ id: ID, action }).success, action).toBe(true);
    }
    // reject carries feedback and has its own schema; regenerate is an AI action (M2).
    for (const action of ["reject", "regenerate", "delete", ""]) {
      expect(SetPostStatusSchema.safeParse({ id: ID, action }).success, action).toBe(false);
    }
  });

  it("recusa id que não é uuid", () => {
    expect(SetPostStatusSchema.safeParse({ id: "1", action: "publish" }).success).toBe(false);
    expect(SetPostStatusSchema.safeParse({ action: "publish" }).success).toBe(false);
  });

  it("recusa data que não é um instante ISO em UTC", () => {
    for (const scheduled_for of ["2026-10-05T09:30", "2026-10-05", "amanhã", "2026-10-05T09:30:00-03:00"]) {
      const r = SetPostStatusSchema.safeParse({ id: ID, action: "schedule", scheduled_for });
      expect(r.success, scheduled_for).toBe(false);
    }
  });
});

describe("RejectPostSchema", () => {
  it("exige feedback com conteúdo", () => {
    expect(RejectPostSchema.safeParse({ id: ID, feedback: "Falta a fonte do número." }).success).toBe(
      true,
    );
    const short = RejectPostSchema.safeParse({ id: ID, feedback: "  não " });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe("Explique o que precisa mudar");
    expect(RejectPostSchema.safeParse({ id: ID }).success).toBe(false);
  });

  it("limita o feedback a 2000 caracteres", () => {
    expect(RejectPostSchema.safeParse({ id: ID, feedback: "a".repeat(2000) }).success).toBe(true);
    expect(RejectPostSchema.safeParse({ id: ID, feedback: "a".repeat(2001) }).success).toBe(false);
  });
});

describe("UpsertPostSchema", () => {
  const base = {
    lang: "pt",
    title: "Um título suficientemente longo",
    body_html: "<p>corpo</p>",
    author_id: ID,
  };
  const parse = (extra: Record<string, unknown>) => UpsertPostSchema.safeParse({ ...base, ...extra });

  it("aceita o mínimo e preenche os padrões", () => {
    const r = UpsertPostSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({
      ...base,
      excerpt: null,
      category_id: null,
      tags: [],
      featured: false,
      meta_title: null,
      meta_description: null,
      cover_url: null,
      cover_alt: null,
    });
  });

  it("o upsert carrega o documento inteiro: campo omitido é campo limpo", () => {
    const full = parse({
      excerpt: "Resumo",
      category_id: ID,
      tags: ["solana"],
      featured: true,
      meta_title: "Meta",
      meta_description: "Descrição",
      cover_url: "/media/a.webp",
      cover_alt: "Capa",
    });
    expect(full.success).toBe(true);
    // The same post saved again without those fields: every one of them goes back to empty.
    const cleared = UpsertPostSchema.safeParse(base);
    expect(cleared.success && cleared.data).toMatchObject({
      excerpt: null,
      category_id: null,
      tags: [],
      featured: false,
      meta_title: null,
      meta_description: null,
      cover_url: null,
      cover_alt: null,
    });
  });

  it("texto opcional vazio, só de espaços ou nulo vira null: uma representação só de vazio", () => {
    for (const field of ["excerpt", "meta_title", "meta_description", "cover_alt"] as const) {
      for (const value of ["", "   ", "\n\t", null, undefined]) {
        const r = parse({ [field]: value });
        expect(r.success && r.data[field], `${field} ${JSON.stringify(value)}`).toBeNull();
      }
      const kept = parse({ [field]: "  texto  " });
      expect(kept.success && kept.data[field], field).toBe("texto");
    }
  });

  it("corpo tem teto de 300 mil caracteres", () => {
    expect(parse({ body_html: "a".repeat(300_000) }).success).toBe(true);
    const r = parse({ body_html: "a".repeat(300_001) });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Corpo grande demais");
  });

  it("os idiomas são os mesmos do CHECK da tabela", () => {
    expect([...POST_LANGS]).toEqual([...POST_LANG]);
    expect(parse({ lang: "en" }).success).toBe(true);
    expect(parse({ lang: "es" }).success).toBe(false);
    const { lang: _lang, ...withoutLang } = base;
    expect(UpsertPostSchema.safeParse(withoutLang).success).toBe(false);
  });

  it("título de 8 a 160 caracteres, medido depois de aparar", () => {
    expect(parse({ title: "1234567" }).success).toBe(false);
    expect(parse({ title: "   1234567   " }).success).toBe(false);
    expect(parse({ title: "12345678" }).success).toBe(true);
    expect(parse({ title: "a".repeat(160) }).success).toBe(true);
    expect(parse({ title: "a".repeat(161) }).success).toBe(false);
    expect(parse({ title: "curto" }).error?.issues[0]?.message).toBe("Título muito curto");
  });

  it("rascunho pode ser salvo sem corpo (quem exige corpo é o approve)", () => {
    const { body_html: _body, ...withoutBody } = base;
    const omitted = UpsertPostSchema.safeParse(withoutBody);
    expect(omitted.success && omitted.data.body_html).toBe("");
    const blank = parse({ body_html: "   " });
    expect(blank.success && blank.data.body_html).toBe("");
    const empty = parse({ body_html: "" });
    expect(empty.success && empty.data.body_html).toBe("");
    expect(parse({ body_html: null }).success).toBe(false);
  });

  it("resumo até 400", () => {
    expect(parse({ excerpt: "a".repeat(400) }).success).toBe(true);
    expect(parse({ excerpt: "a".repeat(401) }).success).toBe(false);
  });

  it("até 12 tags de até 40 caracteres, nenhuma vazia", () => {
    expect(parse({ tags: Array.from({ length: 12 }, (_, i) => `tag-${i}`) }).success).toBe(true);
    expect(parse({ tags: Array.from({ length: 13 }, (_, i) => `tag-${i}`) }).success).toBe(false);
    expect(parse({ tags: ["a".repeat(40)] }).success).toBe(true);
    expect(parse({ tags: ["a".repeat(41)] }).success).toBe(false);
    expect(parse({ tags: ["  "] }).success).toBe(false);
    const trimmed = parse({ tags: ["  solana  "] });
    expect(trimmed.success && trimmed.data.tags).toEqual(["solana"]);
  });

  it("tags saem aparadas, em minúsculas e sem repetição, na ordem em que vieram", () => {
    const r = parse({ tags: ["Solana", " solana ", "SOLANA", "Agentes de IA", "pagamento-x402", "AÇÃO"] });
    expect(r.success && r.data.tags).toEqual(["solana", "agentes de ia", "pagamento-x402", "ação"]);
  });

  it("o limite de 12 conta depois de tirar as repetidas", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
    const r = parse({ tags: [...twelve, "TAG-0", " tag-1 "] });
    expect(r.success && r.data.tags).toEqual(twelve);
    expect(parse({ tags: [...twelve, "tag-12"] }).success).toBe(false);
  });

  it("tag só com letras (acentuadas inclusive), números, espaço e hífen", () => {
    for (const tag of ["solana", "ação", "über", "x402", "agentes de ia", "pré-venda", "日本語"]) {
      expect(parse({ tags: [tag] }).success, tag).toBe(true);
    }
    for (const tag of ["a/b", "a_b", "<b>", "a&b", "a.b", "c#", "a?b", "50%", "a\\b", "#tag", "a\tb", "-", "--", "-a"]) {
      expect(parse({ tags: [tag] }).success, JSON.stringify(tag)).toBe(false);
    }
  });

  it("letra acentuada escrita com marca combinante é a mesma tag", () => {
    const decomposed = "acao".replace("c", `c${String.fromCharCode(0x327)}`).replace("ao", `a${String.fromCharCode(0x303)}o`);
    const r = parse({ tags: [decomposed, "ação"] });
    expect(r.success && r.data.tags).toEqual(["ação"]);
  });

  it("meta_title até 70, meta_description até 170, cover_alt até 160", () => {
    expect(parse({ meta_title: "a".repeat(70) }).success).toBe(true);
    expect(parse({ meta_title: "a".repeat(71) }).success).toBe(false);
    expect(parse({ meta_description: "a".repeat(170) }).success).toBe(true);
    expect(parse({ meta_description: "a".repeat(171) }).success).toBe(false);
    expect(parse({ cover_alt: "a".repeat(160) }).success).toBe(true);
    expect(parse({ cover_alt: "a".repeat(161) }).success).toBe(false);
  });

  it("categoria é opcional; autor é obrigatório; os dois são uuid", () => {
    expect(parse({ category_id: ID }).success).toBe(true);
    expect(parse({ category_id: null }).success).toBe(true);
    expect(parse({ category_id: "guias" }).success).toBe(false);
    expect(parse({ author_id: "lucas" }).success).toBe(false);
    const { author_id: _author, ...withoutAuthor } = base;
    expect(UpsertPostSchema.safeParse(withoutAuthor).success).toBe(false);
  });

  it("featured é booleano de verdade", () => {
    const r = parse({ featured: true });
    expect(r.success && r.data.featured).toBe(true);
    expect(parse({ featured: "true" }).success).toBe(false);
  });

  it("aceita post sem capa", () => {
    const r = UpsertPostSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cover_url).toBeNull();
    expect(parse({ cover_url: null }).success).toBe(true);
  });

  it("aceita capa em /media com texto alternativo", () => {
    const r = parse({
      cover_url: `/media/posts/${ID}/${ID}.webp`,
      cover_alt: "Painel de limites aberto",
    });
    expect(r.success).toBe(true);
  });

  it("recusa capa que não é um caminho /media", () => {
    for (const cover_url of [
      "foto.webp",
      "https://xyz.supabase.co/storage/v1/object/public/blog-public/posts/a/b.webp",
      "https://pub.ash.app.br/media/a.webp",
      "//evil.example/media/a.webp",
      "/media/../x",
      "data:image/png;base64,AAAA",
      "",
    ]) {
      const r = parse({ cover_url });
      expect(r.success, cover_url).toBe(false);
      expect(r.error?.issues[0]?.message, cover_url).toBe("Capa inválida");
    }
  });

  it("caminho de mídia tem teto de 300 caracteres", () => {
    const long = `/media/${"a".repeat(289)}.webp`;
    expect(long).toHaveLength(301);
    expect(parse({ cover_url: long }).success).toBe(false);
    expect(parse({ cover_url: long.replace("aa", "a") }).success).toBe(true);
  });

  it("ignora campo que não é do formulário (slug, status, published_at)", () => {
    const r = parse({ slug: "outro", status: "publicado", published_at: inDays(-1) });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty("slug");
    expect(r.data).not.toHaveProperty("status");
    expect(r.data).not.toHaveProperty("published_at");
  });
});

describe("UpsertCategorySchema", () => {
  const base = { slug: "guias", name_pt: "Guias", name_en: "Guides" };

  it("aceita slug e nome nos dois idiomas", () => {
    expect(UpsertCategorySchema.safeParse(base).success).toBe(true);
  });

  it("exige o nome nos dois idiomas, de 2 a 60", () => {
    expect(UpsertCategorySchema.safeParse({ slug: "guias", name_pt: "Guias" }).success).toBe(false);
    expect(UpsertCategorySchema.safeParse({ ...base, name_en: "G" }).success).toBe(false);
    expect(UpsertCategorySchema.safeParse({ ...base, name_pt: "a".repeat(61) }).success).toBe(false);
    expect(UpsertCategorySchema.safeParse({ ...base, name_pt: "a".repeat(60) }).success).toBe(true);
  });

  it("o slug segue o CHECK da tabela", () => {
    for (const slug of ["ab", "guias-de-uso", "a1", "a".repeat(60)]) {
      expect(UpsertCategorySchema.safeParse({ ...base, slug }).success, slug).toBe(true);
    }
    for (const slug of ["a", "", "Guias", "guias-", "-guias", "guias de uso", "guiás", "a".repeat(61)]) {
      expect(UpsertCategorySchema.safeParse({ ...base, slug }).success, slug).toBe(false);
    }
  });
});

describe("UpsertAuthorSchema", () => {
  const base = { slug: "lucas-galvao", name: "Lucas Galvão" };

  it("aceita o mínimo e preenche os padrões", () => {
    const r = UpsertAuthorSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ ...base, bio_pt: "", bio_en: "", avatar_url: null });
  });

  it("nome de 1 a 80; bio até 600 em cada idioma", () => {
    expect(UpsertAuthorSchema.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(UpsertAuthorSchema.safeParse({ ...base, name: "a".repeat(81) }).success).toBe(false);
    expect(UpsertAuthorSchema.safeParse({ ...base, bio_pt: "a".repeat(600) }).success).toBe(true);
    expect(UpsertAuthorSchema.safeParse({ ...base, bio_pt: "a".repeat(601) }).success).toBe(false);
    expect(UpsertAuthorSchema.safeParse({ ...base, bio_en: "a".repeat(601) }).success).toBe(false);
  });

  it("o slug segue o CHECK da tabela", () => {
    expect(UpsertAuthorSchema.safeParse({ ...base, slug: "Lucas Galvão" }).success).toBe(false);
    expect(UpsertAuthorSchema.safeParse({ ...base, slug: "l" }).success).toBe(false);
  });

  it("avatar só de /media", () => {
    expect(UpsertAuthorSchema.safeParse({ ...base, avatar_url: "/media/authors/a.webp" }).success).toBe(
      true,
    );
    expect(
      UpsertAuthorSchema.safeParse({ ...base, avatar_url: "https://gravatar.com/avatar/x" }).success,
    ).toBe(false);
  });
});
