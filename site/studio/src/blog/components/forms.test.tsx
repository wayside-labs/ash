// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { installDialogPolyfill, isInert, pressEscape } from "../../../tests/helpers/dom";
import { SHORT_SLUG_HELP } from "../lib/short-slug";
import { NewPostForm } from "./new-post-form";
import { type AuthorView, AuthorManager } from "./taxonomy-authors";
import { type CategoryView, CategoryManager } from "./taxonomy-categories";

// The server actions are replaced: a jsdom test never reaches the database.
const posts = vi.hoisted(() => ({ createPost: vi.fn(), createTranslation: vi.fn() }));
const categories = vi.hoisted(() => ({ upsertCategory: vi.fn(), deleteCategory: vi.fn() }));
const authors = vi.hoisted(() => ({ upsertAuthor: vi.fn(), deleteAuthor: vi.fn() }));
const upload = vi.hoisted(() => ({ uploadImage: vi.fn() }));
vi.mock("@/blog/actions/posts", () => posts);
vi.mock("@/blog/actions/categories", () => categories);
vi.mock("@/blog/actions/authors", () => authors);
vi.mock("./editor/upload-image", () => upload);

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/blog" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NEW_ID = "22222222-2222-4222-8222-222222222222";
const created = { ok: true as const, data: { id: NEW_ID, slug: "x", updatedAt: "2026-10-05T12:00:00.000Z" } };

beforeAll(installDialogPolyfill);
beforeEach(() => {
  for (const mock of [
    ...Object.values(posts),
    ...Object.values(categories),
    ...Object.values(authors),
    ...Object.values(upload),
  ]) {
    mock.mockReset();
  }
  posts.createPost.mockResolvedValue(created);
  posts.createTranslation.mockResolvedValue(created);
  categories.upsertCategory.mockResolvedValue({ ok: true, data: {} });
  categories.deleteCategory.mockResolvedValue({ ok: true, data: undefined });
  authors.upsertAuthor.mockResolvedValue({ ok: true, data: {} });
  authors.deleteAuthor.mockResolvedValue({ ok: true, data: undefined });
  router.refresh.mockReset();
  router.push.mockReset();
});

const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("NewPostForm", () => {
  const AUTHORS = [
    { id: "a1", name: "Lucas" },
    { id: "a2", name: "Ronaldo" },
  ];
  const CREATE = "Criar rascunho e abrir o editor";

  it("cria o rascunho com o documento inteiro e abre o editor", async () => {
    const user = userEvent.setup();
    render(<NewPostForm authors={AUTHORS} source={null} />);
    await user.type(screen.getByLabelText("Título"), "  Um título de teste  ");
    await user.selectOptions(screen.getByLabelText("Idioma"), "en");
    await user.selectOptions(screen.getByLabelText("Autor"), "a2");
    await user.click(button(CREATE));

    expect(posts.createPost).toHaveBeenCalledWith({
      lang: "en",
      title: "Um título de teste",
      excerpt: null,
      body_html: "",
      category_id: null,
      author_id: "a2",
      tags: [],
      featured: false,
      meta_title: null,
      meta_description: null,
      cover_url: null,
      cover_alt: null,
    });
    expect(router.push).toHaveBeenCalledWith(`/blog/${NEW_ID}`);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("depois de criar, o botão fica morto enquanto o editor carrega: clicar de novo não cria outro rascunho", async () => {
    const user = userEvent.setup();
    render(<NewPostForm authors={AUTHORS} source={null} />);
    await user.type(screen.getByLabelText("Título"), "Um título de teste");
    await user.selectOptions(screen.getByLabelText("Autor"), "a1");
    await user.click(button(CREATE));
    expect(posts.createPost).toHaveBeenCalledTimes(1);

    expect(isInert(button(CREATE))).toBe(true);
    await user.click(button(CREATE));
    await user.click(button(CREATE));
    // Enter in the title field is the same submission.
    await user.type(screen.getByLabelText("Título"), "{Enter}");
    expect(posts.createPost).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("dois cliques seguidos, antes de o servidor responder, criam um rascunho só", async () => {
    const user = userEvent.setup();
    let answer: (value: typeof created) => void = () => {};
    posts.createPost.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<NewPostForm authors={AUTHORS} source={null} />);
    await user.type(screen.getByLabelText("Título"), "Um título de teste");
    await user.selectOptions(screen.getByLabelText("Autor"), "a1");
    await user.dblClick(button(CREATE));
    expect(posts.createPost).toHaveBeenCalledTimes(1);
    await act(async () => answer(created));
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("título curto ou autor em branco não chegam ao servidor", async () => {
    const user = userEvent.setup();
    render(<NewPostForm authors={AUTHORS} source={null} />);
    await user.type(screen.getByLabelText("Título"), "Curto");
    await user.click(button(CREATE));
    expect(posts.createPost).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole("alert").map((el) => el.textContent);
    expect(alerts).toEqual([
      "O título precisa de pelo menos 8 caracteres.",
      "Escolha quem assina o post.",
    ]);
  });

  it("com um autor só, ele já vem escolhido", () => {
    render(<NewPostForm authors={[{ id: "a1", name: "Lucas" }]} source={null} />);
    expect(screen.getByLabelText<HTMLSelectElement>("Autor").value).toBe("a1");
  });

  it("erro do servidor aparece no formulário e o botão volta", async () => {
    const user = userEvent.setup();
    posts.createPost.mockResolvedValue({ ok: false, error: "Autor não encontrado" });
    render(<NewPostForm authors={AUTHORS} source={null} />);
    await user.type(screen.getByLabelText("Título"), "Um título de teste");
    await user.selectOptions(screen.getByLabelText("Autor"), "a1");
    await user.click(button(CREATE));
    expect((await screen.findByRole("alert")).textContent).toBe("Autor não encontrado");
    expect(router.push).not.toHaveBeenCalled();
    expect(isInert(button(CREATE))).toBe(false);
  });

  it("tradução: idioma fixo no outro, título do original à vista, createTranslation com o id", async () => {
    const user = userEvent.setup();
    const source = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "O título original",
      lang: "pt" as const,
      authorId: "a2",
      categoryId: "c1",
    };
    render(<NewPostForm authors={AUTHORS} source={source} />);
    expect(screen.getByText("O título original")).toBeTruthy();
    const lang = screen.getByLabelText<HTMLSelectElement>("Idioma");
    expect(lang.value).toBe("en");
    expect(lang.disabled).toBe(true);
    // The author of the original comes selected.
    expect(screen.getByLabelText<HTMLSelectElement>("Autor").value).toBe("a2");

    await user.type(screen.getByLabelText("Título em inglês"), "The original title");
    await user.click(button("Criar tradução e abrir o editor"));
    expect(posts.createPost).not.toHaveBeenCalled();
    expect(posts.createTranslation).toHaveBeenCalledWith(
      source.id,
      expect.objectContaining({
        lang: "en",
        title: "The original title",
        author_id: "a2",
        category_id: "c1",
        body_html: "",
      }),
    );
    expect(router.push).toHaveBeenCalledWith(`/blog/${NEW_ID}`);
  });

  it("tradução de um post em inglês é em português", () => {
    const source = { id: "x", title: "Original", lang: "en" as const, authorId: null, categoryId: null };
    render(<NewPostForm authors={AUTHORS} source={source} />);
    expect(screen.getByLabelText<HTMLSelectElement>("Idioma").value).toBe("pt");
    expect(screen.getByLabelText("Título em português")).toBeTruthy();
  });
});

describe("CategoryManager", () => {
  const PRODUTO: CategoryView = {
    id: "c1",
    slug: "produto",
    namePt: "Produto",
    nameEn: "Product",
    postCount: 3,
    publishedCount: 1,
  };

  it("lista com as contagens; vazio diz o que fazer", () => {
    const { unmount } = render(<CategoryManager categories={[PRODUTO]} />);
    const line = screen.getByRole("row", { name: /Produto/ });
    expect(within(line).getByText("3 posts")).toBeTruthy();
    expect(within(line).getByText(/1 publicado$/)).toBeTruthy();
    unmount();
    render(<CategoryManager categories={[]} />);
    expect(screen.getByText("Nenhuma categoria ainda.")).toBeTruthy();
  });

  it("criar: o endereço sai do nome em português e vai com os dois nomes", async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={[PRODUTO]} />);
    await user.click(button("Nova categoria"));
    const dialog = screen.getByRole("dialog", { name: "Nova categoria" });
    await user.type(within(dialog).getByLabelText("Nome em português"), "Segurança & Produção");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Endereço (slug)").value).toBe(
      "seguranca-producao",
    );
    await user.type(within(dialog).getByLabelText("Nome em inglês"), "Security");
    await user.click(within(dialog).getByRole("button", { name: "Criar categoria" }));
    expect(categories.upsertCategory).toHaveBeenCalledWith({
      slug: "seguranca-producao",
      name_pt: "Segurança & Produção",
      name_en: "Security",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("endereço fora do padrão do schema não chega ao servidor", async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={[]} />);
    await user.click(button("Nova categoria"));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nome em português"), "Guias");
    await user.type(within(dialog).getByLabelText("Nome em inglês"), "Guides");
    const slug = within(dialog).getByLabelText("Endereço (slug)");
    for (const bad of ["Com Espaço", "-guias", "g"]) {
      await user.clear(slug);
      await user.type(slug, bad);
      await user.click(within(dialog).getByRole("button", { name: "Criar categoria" }));
      expect(within(dialog).getByRole("alert").textContent, bad).toBe(SHORT_SLUG_HELP);
    }
    expect(categories.upsertCategory).not.toHaveBeenCalled();
    // Once typed, the slug stops following the name.
    await user.type(within(dialog).getByLabelText("Nome em português"), " novos");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Endereço (slug)").value).toBe("g");
  });

  it("endereço que já existe: avisa que salvar renomeia a existente", async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={[PRODUTO]} />);
    await user.click(button("Nova categoria"));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nome em português"), "Produto");
    expect(within(dialog).getByRole("status").textContent).toMatch(
      /Já existe uma categoria com este endereço: “Produto”\. Salvar vai trocar o nome dela/,
    );
    expect(within(dialog).getByRole("button", { name: "Renomear a existente" })).toBeTruthy();
  });

  it("editar: o endereço não é editável, a dica diz por quê, e salvar manda o mesmo slug", async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={[PRODUTO]} />);
    await user.click(button("Editar: Produto"));
    const dialog = screen.getByRole("dialog", { name: "Editar categoria" });
    const slug = within(dialog).getByLabelText<HTMLInputElement>("Endereço (slug)");
    expect(slug.readOnly).toBe(true);
    expect(within(dialog).getByText(/não muda\. Salvar troca só os nomes/)).toBeTruthy();
    const name = within(dialog).getByLabelText("Nome em português");
    await user.clear(name);
    await user.type(name, "Produtos");
    await user.click(within(dialog).getByRole("button", { name: "Salvar nomes" }));
    expect(categories.upsertCategory).toHaveBeenCalledWith({
      slug: "produto",
      name_pt: "Produtos",
      name_en: "Product",
    });
  });

  it("Esc com o salvamento em andamento não fecha o formulário, e o erro que chega depois aparece nele", async () => {
    const user = userEvent.setup();
    let answer: (value: { ok: false; error: string }) => void = () => {};
    categories.upsertCategory.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<CategoryManager categories={[PRODUTO]} />);
    await user.click(button("Editar: Produto"));
    const dialog = screen.getByRole("dialog", { name: "Editar categoria" });
    await user.click(within(dialog).getByRole("button", { name: "Salvar nomes" }));

    let closed = true;
    act(() => {
      closed = pressEscape(dialog);
    });
    expect(closed).toBe(false);
    await act(async () => answer({ ok: false, error: "Nome (pt): no mínimo 2 caracteres" }));
    const open = screen.getByRole("dialog", { name: "Editar categoria" });
    expect(within(open).getByRole("alert").textContent).toBe("Nome (pt): no mínimo 2 caracteres");
    // Closed and opened again, the old error is gone.
    await user.click(within(open).getByRole("button", { name: "Cancelar" }));
    await user.click(button("Editar: Produto"));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });

  it("apagar pede confirmação e diz o que acontece com os posts", async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={[PRODUTO]} />);
    await user.click(button("Apagar: Produto"));
    expect(categories.deleteCategory).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Apagar categoria?" });
    expect(dialog.textContent).toMatch(/3 posts ficam sem categoria/);
    await user.click(within(dialog).getByRole("button", { name: "Apagar" }));
    expect(categories.deleteCategory).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AuthorManager", () => {
  const PHOTO = "/media/autores/a1a1a1a1-1111-4111-8111-111111111111/foto.webp";
  const LUCAS: AuthorView = {
    id: "a1a1a1a1-1111-4111-8111-111111111111",
    slug: "lucas",
    name: "Lucas",
    bioPt: "Escreve sobre produto.",
    bioEn: "",
    avatarUrl: PHOTO,
    postCount: 2,
    publishedCount: 0,
  };
  const SEM_POSTS: AuthorView = { ...LUCAS, postCount: 0 };

  it("criar manda o documento inteiro, sem avatar, e diz que a foto entra depois", async () => {
    const user = userEvent.setup();
    render(<AuthorManager authors={[]} />);
    await user.click(button("Novo autor"));
    const dialog = screen.getByRole("dialog", { name: "Novo autor" });
    expect(within(dialog).getByText(/A foto entra depois/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /foto/ })).toBeNull();
    await user.type(within(dialog).getByLabelText("Nome"), "Ana Pádua");
    await user.type(within(dialog).getByLabelText("Bio em português"), " Engenheira. ");
    await user.click(within(dialog).getByRole("button", { name: "Criar autor" }));
    expect(authors.upsertAuthor).toHaveBeenCalledWith({
      slug: "ana-padua",
      name: "Ana Pádua",
      bio_pt: "Engenheira.",
      bio_en: "",
      avatar_url: null,
    });
  });

  it("editar sem mexer na foto devolve a que o autor já tinha, para o upsert não apagá-la", async () => {
    const user = userEvent.setup();
    render(<AuthorManager authors={[LUCAS]} />);
    await user.click(button("Editar: Lucas"));
    const dialog = screen.getByRole("dialog", { name: "Editar autor" });
    expect(within(dialog).getByLabelText<HTMLInputElement>("Endereço (slug)").readOnly).toBe(true);
    await user.type(within(dialog).getByLabelText("Bio em inglês"), "Writes about product.");
    await user.click(within(dialog).getByRole("button", { name: "Salvar autor" }));
    expect(authors.upsertAuthor).toHaveBeenCalledWith({
      slug: "lucas",
      name: "Lucas",
      bio_pt: "Escreve sobre produto.",
      bio_en: "Writes about product.",
      avatar_url: PHOTO,
    });
  });

  it("trocar a foto: envia para a pasta do autor, e a foto nova só vai com o salvar", async () => {
    const user = userEvent.setup();
    const NEW = "/media/autores/a1a1a1a1-1111-4111-8111-111111111111/nova.webp";
    upload.uploadImage.mockResolvedValue({ ok: true, url: NEW, width: 512, height: 512 });
    render(<AuthorManager authors={[LUCAS]} />);
    await user.click(button("Editar: Lucas"));
    await user.click(button("Trocar foto"));
    const picker = screen.getByRole("dialog", { name: "Foto do autor" });
    // Nothing to hand over until a file went up.
    expect(within(picker).getByRole<HTMLButtonElement>("button", { name: "Usar esta foto" }).disabled).toBe(true);
    const file = new File(["x"], "foto.png", { type: "image/png" });
    await user.upload(within(picker).getByLabelText("Arquivo"), file);
    expect(upload.uploadImage).toHaveBeenCalledWith(
      file,
      { authorId: LUCAS.id },
      { signal: expect.any(AbortSignal) },
    );
    // An avatar asks for no description.
    expect(within(picker).queryByLabelText("Texto alternativo")).toBeNull();
    await user.click(within(picker).getByRole("button", { name: "Usar esta foto" }));
    expect(authors.upsertAuthor).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Editar autor" });
    expect(within(dialog).getByText("A foto só muda de verdade quando você salvar.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Salvar autor" }));
    expect(authors.upsertAuthor).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: NEW }));
  });

  it("envio que falha mostra o erro do servidor e não troca a foto", async () => {
    const user = userEvent.setup();
    upload.uploadImage.mockResolvedValue({ ok: false, error: "Use JPG, PNG ou WebP" });
    render(<AuthorManager authors={[LUCAS]} />);
    await user.click(button("Editar: Lucas"));
    await user.click(button("Trocar foto"));
    const picker = screen.getByRole("dialog", { name: "Foto do autor" });
    await user.upload(within(picker).getByLabelText("Arquivo"), new File(["x"], "a.png", { type: "image/png" }));
    expect((await within(picker).findByRole("alert")).textContent).toBe("Use JPG, PNG ou WebP");
    expect(within(picker).getByRole<HTMLButtonElement>("button", { name: "Usar esta foto" }).disabled).toBe(true);
    await user.click(within(picker).getByRole("button", { name: "Cancelar" }));
    await user.click(button("Salvar autor"));
    expect(authors.upsertAuthor).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: PHOTO }));
  });

  it("remover a foto manda null", async () => {
    const user = userEvent.setup();
    render(<AuthorManager authors={[LUCAS]} />);
    await user.click(button("Editar: Lucas"));
    await user.click(button("Remover foto"));
    await user.click(button("Salvar autor"));
    expect(authors.upsertAuthor).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: null }));
  });

  it("autor com posts: o diálogo explica e não oferece um Apagar que só pode falhar", async () => {
    const user = userEvent.setup();
    render(<AuthorManager authors={[LUCAS]} />);
    await user.click(button("Apagar: Lucas"));
    const dialog = screen.getByRole("dialog", { name: "Este autor tem posts" });
    expect(dialog.textContent).toMatch(/assina 2 posts/);
    expect(within(dialog).queryByRole("button", { name: "Apagar" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Entendi" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(authors.deleteAuthor).not.toHaveBeenCalled();
  });

  it("autor sem posts é apagado depois da confirmação", async () => {
    const user = userEvent.setup();
    render(<AuthorManager authors={[SEM_POSTS]} />);
    await user.click(button("Apagar: Lucas"));
    const dialog = screen.getByRole("dialog", { name: "Apagar autor?" });
    await user.click(within(dialog).getByRole("button", { name: "Apagar" }));
    expect(authors.deleteAuthor).toHaveBeenCalledWith(SEM_POSTS.id);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ganhou um post desde que a tela carregou: o erro do servidor aparece como veio, e o diálogo fica aberto", async () => {
    const user = userEvent.setup();
    const message = "Este autor tem posts. Troque o autor desses posts antes de apagar.";
    authors.deleteAuthor.mockResolvedValue({ ok: false, error: message });
    render(<AuthorManager authors={[SEM_POSTS]} />);
    await user.click(button("Apagar: Lucas"));
    const dialog = screen.getByRole("dialog", { name: "Apagar autor?" });
    await user.click(within(dialog).getByRole("button", { name: "Apagar" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
    expect(screen.getByRole("dialog", { name: "Apagar autor?" })).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
