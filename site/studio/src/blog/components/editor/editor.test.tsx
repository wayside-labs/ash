// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor as TipTapEditor } from "@tiptap/core";
import { type ReactNode, useState } from "react";
import {
  installDialogPolyfill,
  installEditorDomStubs,
  isInert,
  pressEscape,
} from "../../../../tests/helpers/dom";
import { STALE_POST_MESSAGE } from "../../lib/field-error";
import { PostSettings, type PostSettingsValue } from "../post-settings";
import { ImageDialog } from "./image-dialog";
import { LinkDialog } from "./link-dialog";
import { type EditorPost, PostEditor } from "./post-editor";
import { UPLOAD_TIMEOUT_MS, uploadImage } from "./upload-image";

// The server actions are replaced: a jsdom test never reaches the database.
const postActions = vi.hoisted(() => ({ updatePost: vi.fn() }));
const statusActions = vi.hoisted(() => ({ setPostStatus: vi.fn(), rejectPost: vi.fn() }));
vi.mock("@/blog/actions/posts", () => postActions);
vi.mock("@/blog/actions/status", () => statusActions);

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/blog" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "aaaaaaaa-1111-4111-8111-111111111111";
const CATEGORY = "cccccccc-1111-4111-8111-111111111111";
const T0 = "2026-10-05T12:00:00.000Z";
const T1 = "2026-10-05T12:05:00.000Z";
const T2 = "2026-10-05T12:10:00.000Z";
const SP = "America/Sao_Paulo";
const ZONE = "Horário de Brasília (America/Sao_Paulo)";
const IMAGE = "/media/posts/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";

function post(overrides: Partial<EditorPost> = {}): EditorPost {
  return {
    id: ID,
    slug: "um-post-de-teste",
    lang: "pt",
    status: "rascunho",
    title: "Um post de teste",
    bodyHtml: "<p>O texto salvo.</p>",
    excerpt: "Um resumo.",
    categoryId: CATEGORY,
    authorId: AUTHOR,
    tags: ["produto"],
    featured: false,
    metaTitle: null,
    metaDescription: null,
    coverUrl: null,
    coverAlt: null,
    feedback: null,
    scheduledFor: null,
    updatedAt: T0,
    ...overrides,
  };
}

const CATEGORIES = [{ id: CATEGORY, namePt: "Produto" }];
const AUTHORS = [{ id: AUTHOR, name: "Lucas" }];

// Renders the editor and waits for TipTap, which mounts after the first render.
async function open(overrides: Partial<EditorPost> = {}, extra: ReactNode = null) {
  const user = userEvent.setup();
  render(
    <>
      {extra}
      <PostEditor
        post={post(overrides)}
        categories={CATEGORIES}
        authors={AUTHORS}
        translation={null}
        tz={SP}
        zone={ZONE}
      />
    </>,
  );
  await screen.findByRole("textbox", { name: "Texto do post" });
  return user;
}

const button = (name: string) => screen.getByRole("button", { name });
// The TipTap instance behind the text box (TipTap hangs it on the editable element), for what a
// test cannot do through the DOM in jsdom: placing the cursor and typing.
const pmEditor = () =>
  (screen.getByRole("textbox", { name: "Texto do post" }) as unknown as { editor: TipTapEditor }).editor;
// A key press as ProseMirror applies it: the text replaces the current selection.
const typeInto = (text: string) => {
  const editor = pmEditor();
  editor.view.dispatch(editor.state.tr.insertText(text));
};
const saveState = () => screen.getByText(/^(Tudo salvo|Alterações não salvas|Salvando…)$/).textContent;
const saved = (updatedAt: string, status = "rascunho") => ({
  ok: true as const,
  data: { id: ID, slug: "um-post-de-teste", status, updatedAt },
});
const moved = (status: string, updatedAt: string) => ({
  ok: true as const,
  data: { id: ID, slug: "um-post-de-teste", lang: "pt", status, updatedAt },
});
const lastDocument = () => postActions.updatePost.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeAll(() => {
  installDialogPolyfill();
  installEditorDomStubs();
});
beforeEach(() => {
  postActions.updatePost.mockReset().mockResolvedValue(saved(T1));
  statusActions.setPostStatus.mockReset().mockResolvedValue(moved("revisao", T1));
  statusActions.rejectPost.mockReset().mockResolvedValue(moved("rejeitado", T1));
  router.refresh.mockReset();
  router.push.mockReset();
  vi.unstubAllGlobals();
});

describe("PostEditor: salvar", () => {
  it("abre sem nada a salvar, com o texto do post no editor", async () => {
    await open();
    expect(saveState()).toBe("Tudo salvo");
    expect(screen.getByRole("textbox", { name: "Texto do post" }).textContent).toBe("O texto salvo.");
    expect(screen.getByLabelText<HTMLInputElement>("Título").value).toBe("Um post de teste");
  });

  it("manda o documento inteiro, com o token da versão aberta, e nada é recarregado", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Título"), " editado");
    expect(saveState()).toBe("Alterações não salvas");
    await user.click(button("Salvar"));

    expect(postActions.updatePost).toHaveBeenCalledTimes(1);
    expect(postActions.updatePost).toHaveBeenCalledWith(ID, {
      lang: "pt",
      title: "Um post de teste editado",
      excerpt: "Um resumo.",
      body_html: "<p>O texto salvo.</p>",
      category_id: CATEGORY,
      author_id: AUTHOR,
      tags: ["produto"],
      featured: false,
      meta_title: "",
      meta_description: "",
      cover_url: null,
      cover_alt: "",
      if_updated_at: T0,
    });
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("depois de salvar, o próximo salvamento usa o token que o servidor devolveu", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Título"), " um");
    await user.click(button("Salvar"));
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));

    postActions.updatePost.mockResolvedValue(saved(T2));
    await user.type(screen.getByLabelText("Título"), " dois");
    await user.click(button("Salvar"));
    expect(lastDocument().if_updated_at).toBe(T1);
    expect(lastDocument().title).toBe("Um post de teste um dois");
  });

  it("Ctrl+S e Cmd+S salvam, e o navegador não abre o salvar página dele", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Título"), " editado");
    const ctrl = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true, bubbles: true });
    await act(async () => {
      window.dispatchEvent(ctrl);
    });
    expect(ctrl.defaultPrevented).toBe(true);
    expect(postActions.updatePost).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));

    await user.type(screen.getByLabelText("Título"), " de novo");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "S", metaKey: true, cancelable: true }));
    });
    expect(postActions.updatePost).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));

    // A plain "s" is a letter; Ctrl+Shift+S is the browser's "save as" (Edge, Firefox).
    await user.type(screen.getByLabelText("Título"), " outra vez");
    const shifted = new KeyboardEvent("keydown", { key: "S", ctrlKey: true, shiftKey: true, cancelable: true });
    const altered = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, altKey: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", cancelable: true }));
      window.dispatchEvent(shifted);
      window.dispatchEvent(altered);
    });
    expect(shifted.defaultPrevented).toBe(false);
    expect(altered.defaultPrevented).toBe(false);
    expect(postActions.updatePost).toHaveBeenCalledTimes(2);
  });

  it("sem nada a salvar, nem o botão nem o Ctrl+S chamam o servidor", async () => {
    const user = await open();
    expect(saveState()).toBe("Tudo salvo");
    // A save with nothing in it would still move the token, write an audit row and, on a
    // published post, rebuild the site.
    expect(isInert(button("Salvar"))).toBe(true);
    await user.click(button("Salvar"));
    const ctrl = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(ctrl);
    });
    expect(postActions.updatePost).not.toHaveBeenCalled();
    // Still ours: the browser's "save page" must not open either.
    expect(ctrl.defaultPrevented).toBe(true);

    // And again right after a save: the second Ctrl+S has nothing to send.
    await user.type(screen.getByLabelText("Título"), "!");
    expect(isInert(button("Salvar"))).toBe(false);
    await user.click(button("Salvar"));
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
    });
    expect(postActions.updatePost).toHaveBeenCalledTimes(1);
    // The button did not take itself out of the tab order by finishing.
    expect(button("Salvar").hasAttribute("disabled")).toBe(false);
  });

  it("um bloco especial posto pela barra vai para o servidor como {{nome}}, fora de parágrafo", async () => {
    const user = await open();
    await user.selectOptions(screen.getByRole("combobox", { name: "Inserir bloco especial" }), "cta:pitch");
    expect(saveState()).toBe("Alterações não salvas");
    await user.click(button("Salvar"));
    // A block of its own, after the paragraph the cursor was in: never inside it.
    expect(lastDocument().body_html).toBe("<p>O texto salvo.</p>{{cta:pitch}}");
  });

  // What a key press does in the browser: the text replaces the current selection. If the
  // inserted block were left selected, the first letter would delete it.
  describe("digitar depois de inserir pela barra", () => {
    const insert = (user: ReturnType<typeof userEvent.setup>, name: string) =>
      user.selectOptions(screen.getByRole("combobox", { name: "Inserir bloco especial" }), name);

    it("o texto digitado vai para depois do bloco, e o bloco fica", async () => {
      const user = await open({ bodyHtml: "" });
      await insert(user, "cta:newsletter");
      act(() => typeInto("continuo escrevendo"));
      await user.click(button("Salvar"));
      expect(lastDocument().body_html).toBe("{{cta:newsletter}}<p>continuo escrevendo</p>");
    });

    it("dois blocos seguidos e depois texto: os dois ficam", async () => {
      const user = await open({ bodyHtml: "" });
      await insert(user, "cta:pitch");
      await insert(user, "mapa");
      act(() => typeInto("fim"));
      await user.click(button("Salvar"));
      expect(lastDocument().body_html).toBe("{{cta:pitch}}{{mapa}}<p>fim</p>");
    });

    it("Enter depois de inserir não apaga o bloco", async () => {
      const user = await open();
      await insert(user, "mapa");
      act(() => {
        pmEditor().commands.keyboardShortcut("Enter");
        typeInto("depois");
      });
      await user.click(button("Salvar"));
      expect(lastDocument().body_html).toBe("<p>O texto salvo.</p>{{mapa}}<p></p><p>depois</p>");
    });

    it("com o cursor dentro de uma lista, o bloco vai para depois da lista, e o servidor o aceitaria", async () => {
      const user = await open({ bodyHtml: "<ul><li><p>um item</p></li></ul>" });
      act(() => {
        pmEditor().commands.setTextSelection(4);
      });
      await insert(user, "cta:contato");
      await user.click(button("Salvar"));
      expect(lastDocument().body_html).toBe("<ul><li><p>um item</p></li></ul>{{cta:contato}}");
    });
  });

  it("corpo com bloco especial e imagem abre sem contar como alteração, e volta igual", async () => {
    const body = `<h2>Seção</h2><p>texto</p>{{mapa}}<img src="${IMAGE}" alt="um gráfico" width="1600" height="900" />`;
    const user = await open({ bodyHtml: body });
    expect(saveState()).toBe("Tudo salvo");
    await user.type(screen.getByLabelText("Título"), "!");
    await user.click(button("Salvar"));
    expect(lastDocument().body_html).toBe(
      `<h2>Seção</h2><p>texto</p>{{mapa}}<img src="${IMAGE}" alt="um gráfico" width="1600" height="900">`,
    );
  });

  it("tag digitada e não fechada com Enter vai junto no salvar, já normalizada", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Tags"), "  Segurança ");
    // Typed text is an unsaved change, even before it becomes a tag.
    expect(saveState()).toBe("Alterações não salvas");
    const ctrl = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(ctrl);
    });
    expect(lastDocument().tags).toEqual(["produto", "segurança"]);
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));
    expect(screen.getByLabelText<HTMLInputElement>("Tags").value).toBe("");
    expect(screen.getByRole("button", { name: "Remover a tag segurança" })).toBeTruthy();
  });

  it("tag pendente que o servidor recusaria segura o salvar, com a mensagem no campo", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Tags"), "com/barra");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
    });
    expect(postActions.updatePost).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Tag só com letras, números, espaço e hífen");
  });

  it("título curto demais não chega ao servidor", async () => {
    const user = await open();
    await user.clear(screen.getByLabelText("Título"));
    await user.type(screen.getByLabelText("Título"), "Curto");
    await user.click(button("Salvar"));
    expect(postActions.updatePost).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("O título precisa de pelo menos 8 caracteres.");
  });

  it("erro que fala de um campo aparece junto do campo; o que não fala, no alto", async () => {
    const user = await open();
    postActions.updatePost.mockResolvedValue({ ok: false, error: "Resumo: no máximo 400 caracteres" });
    await user.type(screen.getByLabelText("Título"), "!");
    await user.click(button("Salvar"));
    const excerpt = await screen.findByLabelText("Resumo");
    const described = (excerpt.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(
      "Resumo: no máximo 400 caracteres",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(saveState()).toBe("Alterações não salvas");

    postActions.updatePost.mockResolvedValue({
      ok: false,
      error: "Shortcode precisa ficar sozinho, fora de parágrafo: cta:pitch",
    });
    await user.click(button("Salvar"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Shortcode precisa ficar sozinho, fora de parágrafo: cta:pitch",
      ),
    );

    postActions.updatePost.mockResolvedValue({ ok: false, error: "O idioma de um post não muda." });
    await user.click(button("Salvar"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("O idioma de um post não muda."),
    );
  });

  it("post publicado avisa que salvar vale na hora", async () => {
    await open({ status: "publicado" });
    expect(screen.getByText(/Este post está no ar\. Salvar vale na hora/)).toBeTruthy();
  });

  it("corpo com tabela avisa que o editor vai desmanchá-la", async () => {
    await open({ bodyHtml: "<table><tbody><tr><td>célula</td></tr></tbody></table>" });
    expect(screen.getByText(/tem tabela ou figura com legenda, que o editor não sabe editar/)).toBeTruthy();
  });
});

describe("PostEditor: versão velha (outro admin salvou antes)", () => {
  it("diz o que houve, não deixa salvar por cima, e oferece copiar o texto em vez de só recarregar", async () => {
    const user = await open();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    postActions.updatePost.mockResolvedValue({ ok: false, error: STALE_POST_MESSAGE });
    await user.type(screen.getByLabelText("Título"), " meu");
    await user.click(button("Salvar"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/O seu texto não foi gravado, e continua aqui embaixo/);
    // The text is still in the editor, and the title still has the edit.
    expect(screen.getByRole("textbox", { name: "Texto do post" }).textContent).toBe("O texto salvo.");
    expect(screen.getByLabelText<HTMLInputElement>("Título").value).toBe("Um post de teste meu");

    // jsdom has no ClipboardItem: the plain-text fallback is what runs here.
    await user.click(within(alert).getByRole("button", { name: "Copiar o meu texto" }));
    expect(writeText).toHaveBeenCalledWith("O texto salvo.");
    expect(within(alert).getByText("Texto copiado.")).toBeTruthy();
    const current = within(alert).getByRole("link", { name: "Abrir a versão atual em outra aba" });
    expect(current.getAttribute("href")).toBe(`/blog/${ID}`);
    expect(current.getAttribute("target")).toBe("_blank");
    expect(within(alert).getByRole("button", { name: "Recarregar e descartar o meu texto" })).toBeTruthy();

    // Saving again cannot work, and is not offered; nor is a change of state.
    expect(isInert(button("Salvar"))).toBe(true);
    await user.click(button("Salvar"));
    expect(postActions.updatePost).toHaveBeenCalledTimes(1);
    await user.click(button("Enviar para revisão"));
    expect(statusActions.setPostStatus).not.toHaveBeenCalled();
  });

  it("onde o navegador deixa, a cópia leva texto puro e HTML, para colar na outra aba com a formatação", async () => {
    const body = "<h2>Seção</h2><p>Um <strong>texto</strong>.</p>{{mapa}}";
    const user = await open({ bodyHtml: body });
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.fn(async (_items: FakeClipboardItem[]) => {});
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { write, writeText }, configurable: true });
    postActions.updatePost.mockResolvedValue({ ok: false, error: STALE_POST_MESSAGE });
    await user.type(screen.getByLabelText("Título"), " meu");
    await user.click(button("Salvar"));
    await user.click(await screen.findByRole("button", { name: "Copiar o meu texto" }));

    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0]?.[0]?.[0];
    expect(Object.keys(item?.items ?? {}).sort()).toEqual(["text/html", "text/plain"]);
    const html = await item?.items["text/html"]?.text();
    expect(html).toContain("<h2>Seção</h2>");
    expect(html).toContain("<strong>texto</strong>");
    // The block travels as the chip the editor of the other tab knows how to read.
    expect(html).toContain('data-shortcode="mapa"');
    expect(await item?.items["text/plain"]?.text()).toContain("Um texto.");
    expect(await screen.findByText("Texto copiado.")).toBeTruthy();
  });

  it("se a cópia com HTML é recusada, cai para o texto puro", async () => {
    const user = await open();
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly items: Record<string, Blob>) {}
      },
    );
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { write: vi.fn(async () => Promise.reject(new Error("NotAllowedError"))), writeText },
      configurable: true,
    });
    postActions.updatePost.mockResolvedValue({ ok: false, error: STALE_POST_MESSAGE });
    await user.type(screen.getByLabelText("Título"), " meu");
    await user.click(button("Salvar"));
    await user.click(await screen.findByRole("button", { name: "Copiar o meu texto" }));
    expect(writeText).toHaveBeenCalledWith("O texto salvo.");
    expect(await screen.findByText("Texto copiado.")).toBeTruthy();
  });

  it("se o navegador não deixa copiar, diz para copiar à mão", async () => {
    const user = await open();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    postActions.updatePost.mockResolvedValue({ ok: false, error: STALE_POST_MESSAGE });
    await user.type(screen.getByLabelText("Título"), " meu");
    await user.click(button("Salvar"));
    await user.click(await screen.findByRole("button", { name: "Copiar o meu texto" }));
    expect(await screen.findByText(/O navegador não deixou copiar/)).toBeTruthy();
  });
});

describe("PostEditor: sair com alterações não salvas", () => {
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  // A link of the page that is not inside the editor component, as the top menu is. Its own
  // click handler stands for Next's: reached, the app would navigate; not reached, the guard
  // caught the click first.
  const followed = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  const MENU = (
    <a href="/blog/categorias" onClick={followed}>
      Categorias
    </a>
  );
  // Braces on purpose: a function returned from beforeEach is run as its cleanup.
  beforeEach(() => {
    followed.mockClear();
  });

  it("sem alterações, nada é interceptado", async () => {
    const user = await open({}, MENU);
    expect(unload()).toBe(false);
    await user.click(screen.getByRole("link", { name: "Categorias" }));
    expect(followed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("com alterações: recarregar ou fechar a aba pede confirmação ao navegador", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Título"), "!");
    expect(unload()).toBe(true);
    await user.click(button("Salvar"));
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));
    expect(unload()).toBe(false);
  });

  it("com alterações: um link da página, inclusive do menu, abre a confirmação em vez de navegar", async () => {
    const user = await open({}, MENU);
    await user.type(screen.getByLabelText("Título"), "!");

    await user.click(screen.getByRole("link", { name: "Categorias" }));
    const dialog = screen.getByRole("dialog", { name: "Sair sem salvar?" });
    // The link's own handler never saw the click.
    expect(followed).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Título").value).toBe("Um post de teste!");

    // The editor's own links are held to the same question.
    await user.click(screen.getByRole("link", { name: "← Blog" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Sair sem salvar?" })).getByRole("button", {
        name: "Sair sem salvar",
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/blog");
    // Having chosen to leave, the browser's own prompt does not ask a second time.
    expect(unload()).toBe(false);
  });

  it("clique com Ctrl ou em link que abre outra aba não é interceptado: esta página fica", async () => {
    const user = await open(
      {},
      <>
        {MENU}
        <a href="/api/health" target="_blank" rel="noreferrer" onClick={followed}>
          Saúde
        </a>
      </>,
    );
    await user.type(screen.getByLabelText("Título"), "!");
    fireEvent.click(screen.getByRole("link", { name: "Categorias" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "Saúde" }));
    // Both clicks went through to the links.
    expect(followed).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("PostEditor: mudar o estado", () => {
  it("com alterações não salvas a mudança é recusada, com o motivo, e o servidor não é chamado", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Título"), "!");
    await user.click(button("Enviar para revisão"));
    expect(statusActions.setPostStatus).not.toHaveBeenCalled();
    expect(screen.getByText(/Salve as alterações antes de mudar o estado do post/)).toBeTruthy();

    // Saved, the same click goes through, and the warning is gone.
    await user.click(button("Salvar"));
    await waitFor(() => expect(saveState()).toBe("Tudo salvo"));
    statusActions.setPostStatus.mockResolvedValue(moved("revisao", T2));
    await user.click(button("Enviar para revisão"));
    // With the token the save just handed back: the transition is about that version.
    expect(statusActions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "submit",
      if_updated_at: T1,
    });
    expect(screen.queryByText(/Salve as alterações antes/)).toBeNull();
  });

  it("toda transição leva o token da versão na tela, e o seguinte leva o que a anterior devolveu", async () => {
    const user = await open();
    await user.click(button("Enviar para revisão"));
    expect(statusActions.setPostStatus).toHaveBeenLastCalledWith({
      id: ID,
      action: "submit",
      if_updated_at: T0,
    });
    statusActions.setPostStatus.mockResolvedValue(moved("aprovado", T2));
    await user.click(await screen.findByRole("button", { name: "Aprovar" }));
    expect(statusActions.setPostStatus).toHaveBeenLastCalledWith({
      id: ID,
      action: "approve",
      if_updated_at: T1,
    });
    // And the dialogs carry it too.
    statusActions.setPostStatus.mockResolvedValue(moved("aprovado", T0));
    await user.click(await screen.findByRole("button", { name: "Agendar" }));
    const dialog = screen.getByRole("dialog", { name: "Agendar publicação" });
    fireEvent.change(within(dialog).getByLabelText("Dia e hora da publicação"), {
      target: { value: "2027-03-10T09:30" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Agendar" }));
    expect(statusActions.setPostStatus).toHaveBeenLastCalledWith({
      id: ID,
      action: "schedule",
      scheduled_for: "2027-03-10T12:30:00.000Z",
      if_updated_at: T2,
    });
  });

  it("transição recusada porque outro admin salvou: a mensagem aparece na barra de estado, e nada muda", async () => {
    const user = await open();
    statusActions.setPostStatus.mockResolvedValue({ ok: false, error: STALE_POST_MESSAGE });
    await user.click(button("Enviar para revisão"));
    const bar = screen.getByRole("region", { name: "Estado" });
    expect((await within(bar).findByRole("alert")).textContent).toBe(STALE_POST_MESSAGE);
    expect(button("Enviar para revisão")).toBeTruthy();
    // No fresh token was handed to this screen: a later save still says which version it saw.
    await user.type(screen.getByLabelText("Título"), "!");
    await user.click(button("Salvar"));
    expect(lastDocument().if_updated_at).toBe(T0);
  });

  it("depois de mudar o estado, o foco vai para a barra de estado e o estado novo é anunciado", async () => {
    const user = await open();
    const live = () =>
      within(screen.getByRole("region", { name: "Estado" }))
        .getAllByRole("status")
        .map((el) => el.textContent)
        .join(" ");
    expect(live()).toContain("Estado do post: Rascunho.");
    await user.click(button("Enviar para revisão"));
    await screen.findByRole("button", { name: "Aprovar" });
    // The clicked button is gone; focus is not left on <body>.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Estado" }));
    expect(live()).toContain("Estado do post: Em revisão.");

    // Through a dialog too: its opener is gone when it closes.
    await user.click(button("Rejeitar"));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar post" });
    await user.type(within(dialog).getByLabelText("O que precisa mudar"), "Falta a fonte.");
    await user.click(within(dialog).getByRole("button", { name: "Rejeitar post" }));
    await screen.findByRole("button", { name: "Reabrir como rascunho" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Estado" }));
    expect(live()).toContain("Estado do post: Rejeitado.");
  });

  it("o comentário da rejeição continua à vista depois de reabrir, e some quando o post é aprovado", async () => {
    const user = await open({ status: "rejeitado", feedback: "Falta a fonte do número." });
    const bar = () => screen.getByRole("region", { name: "Estado" });
    expect(within(bar()).getByText("Comentário da última rejeição:")).toBeTruthy();
    statusActions.setPostStatus.mockResolvedValue(moved("rascunho", T1));
    await user.click(button("Reabrir como rascunho"));
    await screen.findByRole("button", { name: "Enviar para revisão" });
    expect(within(bar()).getByText(/Falta a fonte do número\./)).toBeTruthy();

    statusActions.setPostStatus.mockResolvedValue(moved("revisao", T2));
    await user.click(button("Enviar para revisão"));
    statusActions.setPostStatus.mockResolvedValue(moved("aprovado", T2));
    await user.click(await screen.findByRole("button", { name: "Aprovar" }));
    await screen.findByRole("button", { name: "Publicar agora" });
    expect(within(bar()).queryByText(/Falta a fonte do número\./)).toBeNull();
  });

  it("depois de uma mudança de estado, a barra mostra o estado novo e o salvar usa o token novo", async () => {
    const user = await open();
    await user.click(button("Enviar para revisão"));
    // The actions of the new state, without a reload.
    expect(await screen.findByRole("button", { name: "Aprovar" })).toBeTruthy();
    expect(button("Rejeitar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enviar para revisão" })).toBeNull();
    expect(screen.getAllByText("Em revisão").length).toBeGreaterThan(0);
    expect(router.refresh).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Título"), "!");
    await user.click(button("Salvar"));
    expect(lastDocument().if_updated_at).toBe(T1);
  });

  it("as ações de cada estado", async () => {
    const cases: [Partial<EditorPost>, string[]][] = [
      [{ status: "rascunho" }, ["Enviar para revisão"]],
      [{ status: "revisao" }, ["Aprovar", "Rejeitar"]],
      [{ status: "aprovado" }, ["Publicar agora", "Agendar"]],
      [{ status: "aprovado", scheduledFor: "2027-03-10T12:30:00.000Z" }, ["Publicar agora", "Reagendar", "Desagendar"]],
      [{ status: "publicado" }, ["Despublicar"]],
      [{ status: "rejeitado", feedback: "Falta a fonte." }, ["Reabrir como rascunho"]],
    ];
    for (const [overrides, expected] of cases) {
      const view = render(
        <PostEditor post={post(overrides)} categories={CATEGORIES} authors={AUTHORS} translation={null} tz={SP} zone={ZONE} />,
      );
      const bar = screen.getByRole("region", { name: "Estado" });
      expect(
        within(bar).getAllByRole("button").map((el) => el.textContent),
        JSON.stringify(overrides),
      ).toEqual(expected);
      view.unmount();
    }
  });

  it("agendado mostra a data no fuso do blog; rejeitado mostra o motivo", async () => {
    await open({ status: "aprovado", scheduledFor: "2027-03-10T12:30:00.000Z" });
    const bar = screen.getByRole("region", { name: "Estado" });
    expect(within(bar).getByText("10/03/2027 09:30")).toBeTruthy();
    expect(within(bar).getByText(`No fuso do blog: ${ZONE}.`)).toBeTruthy();
  });

  it("publicar pede confirmação; confirmado, o estado e o token mudam", async () => {
    const user = await open({ status: "aprovado" });
    statusActions.setPostStatus.mockResolvedValue(moved("publicado", T1));
    await user.click(button("Publicar agora"));
    expect(statusActions.setPostStatus).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Publicar agora?" });
    await user.click(within(dialog).getByRole("button", { name: "Publicar agora" }));
    expect(statusActions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "publish",
      if_updated_at: T0,
    });
    expect(await screen.findByRole("button", { name: "Despublicar" })).toBeTruthy();
    expect(screen.getByText(/Este post está no ar/)).toBeTruthy();

    await user.type(screen.getByLabelText("Título"), "!");
    postActions.updatePost.mockResolvedValue(saved(T2, "publicado"));
    await user.click(button("Salvar"));
    expect(lastDocument().if_updated_at).toBe(T1);
  });

  it("agendar pelo diálogo guarda a data e o token, sem recarregar a página", async () => {
    const user = await open({ status: "aprovado" });
    statusActions.setPostStatus.mockResolvedValue(moved("aprovado", T1));
    await user.click(button("Agendar"));
    const dialog = screen.getByRole("dialog", { name: "Agendar publicação" });
    fireEvent.change(within(dialog).getByLabelText("Dia e hora da publicação"), {
      target: { value: "2027-03-10T09:30" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Agendar" }));
    expect(statusActions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "schedule",
      scheduled_for: "2027-03-10T12:30:00.000Z",
      if_updated_at: T0,
    });
    expect(await screen.findByRole("button", { name: "Reagendar" })).toBeTruthy();
    expect(screen.getByText("10/03/2027 09:30")).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Título"), "!");
    await user.click(button("Salvar"));
    expect(lastDocument().if_updated_at).toBe(T1);
  });

  it("rejeitar pelo diálogo mostra o motivo, troca as ações e guarda o token", async () => {
    const user = await open({ status: "revisao" });
    await user.click(button("Rejeitar"));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar post" });
    await user.type(within(dialog).getByLabelText("O que precisa mudar"), "Falta a fonte.");
    await user.click(within(dialog).getByRole("button", { name: "Rejeitar post" }));
    expect(statusActions.rejectPost).toHaveBeenCalledWith({
      id: ID,
      feedback: "Falta a fonte.",
      if_updated_at: T0,
    });
    expect(await screen.findByRole("button", { name: "Reabrir como rascunho" })).toBeTruthy();
    expect(screen.getByText("Falta a fonte.")).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("mudança recusada pelo servidor aparece na barra de estado, e nada muda", async () => {
    const user = await open();
    const message = 'O post não está mais em "rascunho" (ou não existe). Recarregue a página.';
    statusActions.setPostStatus.mockResolvedValue({ ok: false, error: message });
    await user.click(button("Enviar para revisão"));
    const bar = screen.getByRole("region", { name: "Estado" });
    expect((await within(bar).findByRole("alert")).textContent).toBe(message);
    expect(button("Enviar para revisão")).toBeTruthy();
  });
});

describe("PostEditor: barra do texto", () => {
  it("os botões são só do que o sanitizador guarda, com nome e estado para leitor de tela", async () => {
    await open();
    const bar = screen.getByRole("toolbar", { name: "Formatação do texto" });
    expect(within(bar).getAllByRole("button").map((el) => el.getAttribute("aria-label"))).toEqual([
      "Negrito",
      "Itálico",
      "Riscado",
      "Código no meio do texto",
      "Título de seção",
      "Subtítulo",
      "Lista com marcadores",
      "Lista numerada",
      "Citação",
      "Bloco de código",
      "Linha divisória",
      "Link",
      "Imagem",
    ]);
    // No underline: the allowlist has no <u>.
    expect(within(bar).queryByRole("button", { name: /Sublinhado/ })).toBeNull();
    // Every target is at least 24 px each way (the class asks for 28), the one-letter ones too.
    for (const el of within(bar).getAllByRole("button")) {
      expect(el.className, el.getAttribute("aria-label") ?? "").toMatch(/\bmin-h-7\b.*\bmin-w-7\b/);
    }
    // The block menu sits next to the toolbar, with a tab stop of its own.
    expect(within(bar).queryByRole("combobox")).toBeNull();
    const options = within(
      screen.getByRole("combobox", { name: "Inserir bloco especial" }),
    ).getAllByRole("option");
    expect(options.map((el) => el.textContent)).toEqual([
      "Bloco especial…",
      "CTA: pitch",
      "CTA: newsletter",
      "CTA: contato",
      "Mapa do fluxo",
    ]);
  });

  it("o que as barras presas cobrem vira a margem de rolagem do editor, e acompanha a altura delas", async () => {
    // jsdom has neither layout nor ResizeObserver: the heights are given here, and the observer
    // is one the test can fire.
    const heights = { bar: 57, toolbar: 41 };
    const fire: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          fire.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (!this.classList.contains("sticky")) return 0;
        // The save bar is the sticky element that holds the Save button.
        return this.querySelector('[aria-keyshortcuts="Control+S Meta+S"]') ? heights.bar : heights.toolbar;
      });
    try {
      await open();
      const resize = () => act(() => fire.forEach((callback) => callback()));
      const props = () => pmEditor().view.props;

      resize();
      // Top: the two bars, plus a little air. A caret closer to the top than the bars are tall
      // counts as hidden, and is scrolled to just under them.
      expect(props().scrollThreshold).toEqual({ top: 98, right: 0, bottom: 0, left: 0 });
      expect(props().scrollMargin).toEqual({ top: 106, right: 8, bottom: 8, left: 8 });
      // The toolbar itself sticks right under the save bar.
      const toolbar = screen.getByRole("toolbar").closest(".sticky") as HTMLElement;
      expect(toolbar.style.top).toBe("57px");

      // A narrow window: the save bar wraps into two rows.
      heights.bar = 104;
      resize();
      expect(props().scrollThreshold).toEqual({ top: 145, right: 0, bottom: 0, left: 0 });
      expect(props().scrollMargin).toEqual({ top: 153, right: 8, bottom: 8, left: 8 });
      expect(toolbar.style.top).toBe("104px");
      // The rest of the view's configuration was not replaced by the update.
      expect(screen.getByRole("textbox", { name: "Texto do post" }).className).toContain("post-body");
    } finally {
      offsetHeight.mockRestore();
    }
  });

  it("a barra é uma parada só do Tab, e as setas andam entre os botões", async () => {
    const user = await open();
    const bar = screen.getByRole("toolbar", { name: "Formatação do texto" });
    const buttons = within(bar).getAllByRole("button");
    const stops = () => buttons.filter((el) => el.tabIndex === 0).map((el) => el.getAttribute("aria-label"));
    expect(stops()).toEqual(["Negrito"]);

    buttons[0]?.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(buttons[1]);
    expect(stops()).toEqual(["Itálico"]);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    // Wraps around.
    expect(document.activeElement).toBe(buttons.at(-1));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(buttons[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(buttons.at(-1));
    expect(stops()).toEqual(["Imagem"]);
    // The arrows moved the focus and did nothing else.
    expect(saveState()).toBe("Tudo salvo");
  });

  it("colar uma tabela avisa que a estrutura virou parágrafos; colar texto comum não avisa", async () => {
    const user = await open();
    act(() => {
      pmEditor().view.pasteHTML("<p>um parágrafo <strong>comum</strong></p>");
    });
    expect(screen.queryByText(/O que você colou tinha tabela/)).toBeNull();
    act(() => {
      pmEditor().view.pasteHTML("<table><tbody><tr><td>célula um</td><td>célula dois</td></tr></tbody></table>");
    });
    expect(await screen.findByText(/O que você colou tinha tabela ou figura com legenda/)).toBeTruthy();
    // The text came in; the table did not.
    expect(screen.getByRole("textbox", { name: "Texto do post" }).textContent).toContain("célula um");
    expect(screen.getByRole("textbox", { name: "Texto do post" }).querySelector("table")).toBeNull();
    await user.click(button("Entendi"));
    expect(screen.queryByText(/O que você colou tinha tabela/)).toBeNull();
  });

  it("um botão de bloco muda o texto e fica marcado como ativo", async () => {
    const user = await open();
    const bar = screen.getByRole("toolbar", { name: "Formatação do texto" });
    const heading = within(bar).getByRole("button", { name: "Título de seção" });
    expect(heading.getAttribute("aria-pressed")).toBe("false");
    await user.click(heading);
    await waitFor(() => expect(heading.getAttribute("aria-pressed")).toBe("true"));
    await user.click(button("Salvar"));
    expect(lastDocument().body_html).toBe("<h2>O texto salvo.</h2>");
  });

  it("o link passa pelo diálogo: destino inseguro é recusado, o seguro entra no texto", async () => {
    const user = await open();
    await user.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Link" }));
    const dialog = screen.getByRole("dialog", { name: "Colocar link" });
    await user.type(within(dialog).getByLabelText("Endereço"), "javascript:alert(1)");
    await user.click(within(dialog).getByRole("button", { name: "Colocar link" }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Use um endereço que comece com/);
    expect(saveState()).toBe("Tudo salvo");

    await user.clear(within(dialog).getByLabelText("Endereço"));
    await user.type(within(dialog).getByLabelText("Endereço"), "/pt/blog/outro-post");
    await user.click(within(dialog).getByRole("button", { name: "Colocar link" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(button("Salvar"));
    expect(lastDocument().body_html).toContain('<a href="/pt/blog/outro-post">');
  });

  it("a imagem só entra no texto depois do envio dar certo e de ter texto alternativo", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ok: true, url: IMAGE, width: 1600, height: 900, bytes: 1234 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const user = await open();
    await user.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Imagem" }));
    const dialog = screen.getByRole("dialog", { name: "Imagem no texto" });
    await user.upload(
      within(dialog).getByLabelText("Arquivo"),
      new File(["bytes"], "grafico.png", { type: "image/png" }),
    );
    await within(dialog).findByLabelText("Texto alternativo");
    // The request: same-origin, multipart, with the post it belongs to.
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/upload");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("post_id")).toBe(ID);
    expect((init.body as FormData).get("author_id")).toBeNull();
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);

    // Without the description it is not inserted.
    await user.click(within(dialog).getByRole("button", { name: "Inserir imagem" }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Descreva a imagem/);
    expect(saveState()).toBe("Tudo salvo");

    await user.type(within(dialog).getByLabelText("Texto alternativo"), "Um gráfico de barras");
    await user.click(within(dialog).getByRole("button", { name: "Inserir imagem" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(button("Salvar"));
    expect(lastDocument().body_html).toContain(
      `<img src="${IMAGE}" alt="Um gráfico de barras" width="1600" height="900">`,
    );
  });
});

describe("LinkDialog", () => {
  const unsafe = [
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.example",
    "/\\evil.example",
    "ftp://example.com",
    "example.com",
    "pt/blog/relativo",
  ];
  for (const href of unsafe) {
    it(`recusa ${href}`, async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<LinkDialog open onClose={() => {}} current={null} onApply={onApply} onRemove={() => {}} />);
      await user.type(screen.getByLabelText("Endereço"), href.replace(/[{[]/g, "$&$&"));
      await user.click(button("Colocar link"));
      expect(onApply).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toMatch(/Use um endereço que comece com/);
    });
  }

  for (const href of ["https://example.com/a?b=1", "http://example.com", "mailto:oi@example.com", "#secao", "/pt/blog/outro"]) {
    it(`aceita ${href}`, async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      const onClose = vi.fn();
      render(<LinkDialog open onClose={onClose} current={null} onApply={onApply} onRemove={() => {}} />);
      await user.type(screen.getByLabelText("Endereço"), `  ${href} `);
      await user.click(button("Colocar link"));
      expect(onApply).toHaveBeenCalledWith(href);
      expect(onClose).toHaveBeenCalled();
    });
  }

  it("diz que link interno começa com barra, e não aceita campo vazio", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<LinkDialog open onClose={() => {}} current={null} onApply={onApply} onRemove={() => {}} />);
    expect(screen.getByText(/Link para outra página do site começa com \//)).toBeTruthy();
    await user.click(button("Colocar link"));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Escreva o endereço do link.");
  });

  it("com um link sob o cursor: mostra o endereço atual, troca ou remove", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onRemove = vi.fn();
    render(
      <LinkDialog open onClose={() => {}} current="https://example.com/velho" onApply={onApply} onRemove={onRemove} />,
    );
    expect(screen.getByRole("dialog", { name: "Editar link" })).toBeTruthy();
    const field = screen.getByLabelText<HTMLInputElement>("Endereço");
    expect(field.value).toBe("https://example.com/velho");
    await user.clear(field);
    await user.type(field, "https://example.com/novo");
    await user.click(button("Trocar link"));
    expect(onApply).toHaveBeenCalledWith("https://example.com/novo");
    await user.click(button("Remover link"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("uploadImage", () => {
  const file = new File(["bytes"], "foto.png", { type: "image/png" });
  const owner = { postId: ID };
  const answering = (response: Response) => ({
    fetcher: vi.fn(async () => response) as unknown as typeof fetch,
  });
  // A request that only ends when it is aborted, as fetch does: it rejects with an AbortError.
  const hanging = () =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

  it("devolve a mensagem do servidor como veio, em 400, 404 e 413", async () => {
    for (const [status, error] of [
      [400, "Use JPG, PNG ou WebP"],
      [404, "Post não encontrado"],
      [413, "Imagem até 5MB"],
      [403, "Pedido de outra origem recusado."],
    ] as const) {
      const result = await uploadImage(file, owner, answering(Response.json({ ok: false, error }, { status })));
      expect(result, String(status)).toEqual({ ok: false, error });
    }
  });

  it("resposta que não é nossa (página de erro de um proxy, queda de conexão) vira uma mensagem legível", async () => {
    const html = new Response("<html>413 Request Entity Too Large</html>", { status: 413 });
    expect(await uploadImage(file, owner, answering(html))).toEqual({ ok: false, error: "Imagem até 5MB" });
    const gateway = new Response("bad gateway", { status: 502 });
    expect(await uploadImage(file, owner, answering(gateway))).toEqual({
      ok: false,
      error: "Não foi possível enviar a imagem (erro 502).",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await uploadImage(file, owner, { fetcher: offline })).toEqual({
      ok: false,
      error: "Não foi possível falar com o servidor. Confira a conexão e tente de novo.",
    });
  });

  it("servidor que não responde: o envio é interrompido no tempo limite, com uma mensagem que diz isso", async () => {
    const fetcher = hanging();
    const result = await uploadImage(file, owner, {
      fetcher: fetcher as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(result).toEqual({
      ok: false,
      error: "O envio demorou mais de um minuto e foi interrompido. Confira a conexão e tente de novo.",
    });
    // The request itself was aborted, not just abandoned.
    expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it("cancelado por quem chamou: para o pedido e volta dizendo que foi cancelamento, não falha", async () => {
    const fetcher = hanging();
    const controller = new AbortController();
    const pending = uploadImage(file, owner, {
      fetcher: fetcher as unknown as typeof fetch,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: "Envio cancelado.", cancelled: true });
    expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    // Already cancelled before it starts: nothing is sent.
    const never = vi.fn();
    expect(
      (await uploadImage(file, owner, { fetcher: never as unknown as typeof fetch, signal: controller.signal })).ok,
    ).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });

  it("o tempo limite padrão é de um minuto", () => {
    expect(UPLOAD_TIMEOUT_MS).toBe(60_000);
  });

  it("arquivo grande demais ou vazio nem sai do navegador", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.png");
    expect(await uploadImage(big, owner, { fetcher })).toEqual({ ok: false, error: "Imagem até 5MB" });
    expect(await uploadImage(new File([], "vazio.png"), owner, { fetcher })).toEqual({
      ok: false,
      error: "Arquivo vazio",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("um 200 com endereço que não é do nosso /media não é aceito", async () => {
    for (const url of ["https://evil.example/x.webp", "/outra/pasta.webp", "", undefined]) {
      const result = await uploadImage(file, owner, answering(Response.json({ ok: true, url })));
      expect(result.ok, String(url)).toBe(false);
    }
  });

  it("avatar vai com author_id, e não com post_id", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, url: IMAGE, width: 512, height: 512 }));
    const result = await uploadImage(
      file,
      { authorId: AUTHOR },
      { fetcher: fetcher as unknown as typeof fetch },
    );
    expect(result).toEqual({ ok: true, url: IMAGE, width: 512, height: 512 });
    const body = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(body.get("author_id")).toBe(AUTHOR);
    expect(body.get("post_id")).toBeNull();
  });
});

describe("ImageDialog", () => {
  const choose = async (response: Response | Promise<Response>) => {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onClose = vi.fn();
    render(
      <ImageDialog
        open
        onClose={onClose}
        owner={{ postId: ID }}
        title="Imagem no texto"
        confirmLabel="Inserir imagem"
        onChoose={onChoose}
      />,
    );
    await user.upload(screen.getByLabelText("Arquivo"), new File(["bytes"], "a.png", { type: "image/png" }));
    return { user, onChoose, onClose };
  };

  it("envio recusado: mostra o erro do servidor e não há o que inserir", async () => {
    const { user, onChoose } = await choose(
      Response.json({ ok: false, error: "Imagem grande demais em pixels (máx. 50 megapixels)" }, { status: 400 }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Imagem grande demais em pixels (máx. 50 megapixels)",
    );
    const insert = screen.getByRole<HTMLButtonElement>("button", { name: "Inserir imagem" });
    expect(insert.disabled).toBe(true);
    await user.click(insert);
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Texto alternativo")).toBeNull();
  });

  it("enquanto envia, avisa, não deixa inserir e o Esc não fecha", async () => {
    let answer: (value: Response) => void = () => {};
    const { user, onChoose, onClose } = await choose(new Promise<Response>((resolve) => (answer = resolve)));
    expect(screen.getByText("Enviando a imagem…")).toBeTruthy();
    expect(isInert(button("Inserir imagem"))).toBe(true);
    let closed = true;
    act(() => {
      closed = pressEscape(screen.getByRole("dialog"));
    });
    expect(closed).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer(Response.json({ ok: true, url: IMAGE, width: 10, height: 10 })));
    await user.type(await screen.findByLabelText("Texto alternativo"), "  Uma foto  ");
    await user.click(button("Inserir imagem"));
    expect(onChoose).toHaveBeenCalledWith({ url: IMAGE, width: 10, height: 10, alt: "Uma foto" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancelar envio para o pedido, deixa o diálogo aberto e ele volta a fechar normalmente", async () => {
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onClose = vi.fn();
    render(
      <ImageDialog
        open
        onClose={onClose}
        owner={{ postId: ID }}
        title="Imagem no texto"
        confirmLabel="Inserir imagem"
        onChoose={onChoose}
      />,
    );
    await user.upload(screen.getByLabelText("Arquivo"), new File(["bytes"], "a.png", { type: "image/png" }));
    await user.click(button("Cancelar envio"));
    expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Enviando a imagem…")).toBeNull();
    expect(screen.getByText(/Envio cancelado/)).toBeTruthy();
    // Not an error, and nothing to insert.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Inserir imagem" }).disabled).toBe(true);
    // Dismissible again: Esc closes, and so does the button, now back to its plain name.
    let closed = false;
    act(() => {
      closed = pressEscape(screen.getByRole("dialog"));
    });
    expect(closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("PostSettings", () => {
  const value: PostSettingsValue = {
    categoryId: CATEGORY,
    authorId: AUTHOR,
    tags: ["produto"],
    pendingTag: "",
    excerpt: "Um resumo.",
    coverUrl: null,
    coverAlt: "",
    featured: false,
    metaTitle: "",
    metaDescription: "",
  };
  function Harness({ initial = value, translation = null }: { initial?: PostSettingsValue; translation?: { id: string; title: string; lang: "pt" | "en" } | null }) {
    const [current, setCurrent] = useState(initial);
    return (
      <>
        <PostSettings
          value={current}
          onChange={setCurrent}
          categories={CATEGORIES}
          authors={AUTHORS}
          post={{ id: ID, slug: "um-post-de-teste", lang: "pt" }}
          translation={translation}
          errors={{}}
        />
        <output data-testid="value">{JSON.stringify(current)}</output>
      </>
    );
  }
  const current = () => JSON.parse(screen.getByTestId("value").textContent ?? "{}") as PostSettingsValue;

  it("contadores do resumo e dos campos de busca, com o limite do schema no próprio campo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const excerpt = screen.getByLabelText<HTMLTextAreaElement>("Resumo");
    expect(excerpt.maxLength).toBe(400);
    expect(screen.getByLabelText<HTMLInputElement>("Título para buscadores").maxLength).toBe(70);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Descrição para buscadores").maxLength).toBe(170);
    expect(screen.getByText("10/400")).toBeTruthy();
    expect(screen.getByText("0/70")).toBeTruthy();
    expect(screen.getByText("0/170")).toBeTruthy();
    await user.type(excerpt, " Mais.");
    expect(screen.getByText("16/400")).toBeTruthy();
    await user.type(screen.getByLabelText("Título para buscadores"), "SEO");
    expect(screen.getByText("3/70")).toBeTruthy();
    expect(current().metaTitle).toBe("SEO");
  });

  it("tags: Enter e vírgula fecham, a tag aparece como o servidor vai gravar, sem repetir", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Tags");
    await user.type(field, "  Segurança {Enter}");
    await user.type(field, "PRODUTO,");
    await user.type(field, "pagamento,");
    expect(current().tags).toEqual(["produto", "segurança", "pagamento"]);
    expect(screen.getByText("3/12")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remover a tag segurança" }));
    expect(current().tags).toEqual(["produto", "pagamento"]);
  });

  it("tag que o servidor recusaria é recusada aqui, com a mensagem dele; e o teto de 12", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...value, tags: Array.from({ length: 12 }, (_, i) => `tag ${i}`) }} />);
    const field = screen.getByLabelText("Tags");
    await user.type(field, "mais uma{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("No máximo 12 tags");
    expect(current().tags).toHaveLength(12);
    await user.clear(field);
    await user.type(field, "com/barra{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Tag só com letras, números, espaço e hífen");
  });

  it("categoria, autor e destaque", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Categoria"), "");
    await user.click(screen.getByRole("checkbox", { name: /Destaque/ }));
    expect(current()).toMatchObject({ categoryId: "", featured: true, authorId: AUTHOR });
  });

  it("capa: escolher pelo envio (com texto alternativo), editar o texto com contador, remover", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, url: IMAGE, width: 1600, height: 900 })));
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("Sem capa.")).toBeTruthy();
    await user.click(button("Escolher capa"));
    const dialog = screen.getByRole("dialog", { name: "Capa do post" });
    await user.upload(within(dialog).getByLabelText("Arquivo"), new File(["x"], "capa.png", { type: "image/png" }));
    await user.type(await within(dialog).findByLabelText("Texto alternativo"), "Uma capa");
    await user.click(within(dialog).getByRole("button", { name: "Usar como capa" }));
    expect(current()).toMatchObject({ coverUrl: IMAGE, coverAlt: "Uma capa" });

    const alt = screen.getByLabelText<HTMLInputElement>("Texto alternativo da capa");
    expect(alt.maxLength).toBe(160);
    expect(screen.getByText("8/160")).toBeTruthy();
    await user.click(button("Remover capa"));
    expect(current()).toMatchObject({ coverUrl: null, coverAlt: "" });
  });

  it("endereço e idioma são só leitura, com a explicação; sem tradução, oferece criar", () => {
    render(<Harness />);
    expect(screen.getByText("um-post-de-teste")).toBeTruthy();
    expect(screen.getByText(/não mudam: estão no endereço público/)).toBeTruthy();
    expect(screen.queryByLabelText(/slug/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Criar tradução" }).getAttribute("href")).toBe(
      `/blog/novo?traducao_de=${ID}`,
    );
  });

  it("com tradução, o link leva ao post irmão", () => {
    render(<Harness translation={{ id: "22222222-2222-4222-8222-222222222222", title: "The English one", lang: "en" }} />);
    expect(screen.getByRole("link", { name: "The English one" }).getAttribute("href")).toBe(
      "/blog/22222222-2222-4222-8222-222222222222",
    );
    expect(screen.queryByRole("link", { name: "Criar tradução" })).toBeNull();
  });
});
