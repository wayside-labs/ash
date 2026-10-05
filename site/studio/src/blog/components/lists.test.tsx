// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { forceClose, installDialogPolyfill, isInert, pressEscape } from "../../../tests/helpers/dom";
import type { PostRowView } from "../lib/list-rows";
import type { PostStatus } from "../lib/post-status";
import { PostList } from "./post-list";
import { ReviewList } from "./review-list";
import { ScheduleDialog } from "./schedule-dialog";
import { ScheduledList } from "./scheduled-list";

// The server actions are replaced: a jsdom test never reaches the database.
const actions = vi.hoisted(() => ({ setPostStatus: vi.fn(), rejectPost: vi.fn() }));
vi.mock("@/blog/actions/status", () => actions);

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
const TITLE = "Um post de teste qualquer";
const SP = "America/Sao_Paulo";
const ZONE = "Horário de Brasília (America/Sao_Paulo)";
const WHEN = "2027-03-10T12:30:00.000Z";
// The row's updatedAt: the version every transition of the lists says it is acting on.
const UPDATED = "2026-10-02T13:00:00.000Z";

function row(overrides: Partial<PostRowView> = {}): PostRowView {
  return {
    id: ID,
    title: TITLE,
    slug: "um-post-de-teste-qualquer",
    lang: "pt",
    status: "rascunho",
    excerpt: null,
    feedback: null,
    categoryName: "Produto",
    authorName: "Lucas",
    updatedAt: UPDATED,
    publishedAt: null,
    scheduledFor: null,
    overdue: false,
    hasTranslation: true,
    ...overrides,
  };
}

type Moved = { ok: true; data: { id: string; slug: string; lang: string; status: PostStatus; updatedAt: string } };
const moved = (status: PostStatus): Moved => ({
  ok: true,
  data: { id: ID, slug: "um-post", lang: "pt", status, updatedAt: "2026-10-05T12:00:00.000Z" },
});

beforeAll(installDialogPolyfill);
beforeEach(() => {
  actions.setPostStatus.mockReset().mockResolvedValue(moved("revisao"));
  actions.rejectPost.mockReset().mockResolvedValue(moved("rejeitado"));
  router.refresh.mockReset();
  router.push.mockReset();
});

// A control of the row: its accessible name carries the post's title.
const control = (label: string) => screen.getByRole("button", { name: `${label}: ${TITLE}` });
// A button inside a dialog, or anywhere a plain name is enough.
const button = (name: string) => screen.getByRole("button", { name });

describe("PostList: as ações de cada estado", () => {
  const cases: [string, Partial<PostRowView>, string[]][] = [
    ["rascunho", { status: "rascunho" }, ["Editar", "Enviar para revisão"]],
    ["revisao", { status: "revisao" }, ["Editar", "Ver na revisão"]],
    ["aprovado sem data", { status: "aprovado" }, ["Editar", "Publicar agora", "Agendar"]],
    [
      "aprovado com data",
      { status: "aprovado", scheduledFor: WHEN },
      ["Editar", "Publicar agora", "Reagendar", "Desagendar"],
    ],
    ["publicado", { status: "publicado", publishedAt: WHEN }, ["Editar", "Despublicar"]],
    ["rejeitado", { status: "rejeitado", feedback: "Falta a fonte." }, ["Editar", "Reabrir"]],
  ];

  for (const [label, overrides, expected] of cases) {
    for (const hasTranslation of [true, false]) {
      it(`${label}, ${hasTranslation ? "com" : "sem"} tradução`, () => {
        const { container } = render(
          <PostList posts={[row({ ...overrides, hasTranslation })]} tz={SP} zone={ZONE} />,
        );
        const body = container.querySelector("tbody") as HTMLElement;
        const controls = [...body.querySelectorAll("a, button")];
        // A post with no sibling in the other language offers one, whatever its state.
        const visible = hasTranslation ? expected : [...expected, "Criar tradução"];
        expect(controls.map((el) => el.textContent)).toEqual(visible);
        // With twenty rows on screen, each control says which post it acts on.
        expect(controls.map((el) => el.getAttribute("aria-label"))).toEqual(
          visible.map((text) => `${text}: ${TITLE}`),
        );
      });
    }
  }

  it("Editar e Criar tradução apontam para o post", () => {
    render(<PostList posts={[row({ hasTranslation: false })]} tz={SP} zone={ZONE} />);
    expect(screen.getByRole("link", { name: `Editar: ${TITLE}` }).getAttribute("href")).toBe(
      `/blog/${ID}`,
    );
    expect(
      screen.getByRole("link", { name: `Criar tradução: ${TITLE}` }).getAttribute("href"),
    ).toBe(`/blog/novo?traducao_de=${ID}`);
  });

  it("o comentário da rejeição continua à vista depois de reaberto (o núcleo o mantém de propósito)", () => {
    render(
      <PostList posts={[row({ status: "rascunho", feedback: "Falta a fonte do número." })]} tz={SP} zone={ZONE} />,
    );
    const line = screen.getByRole("row", { name: /Um post de teste qualquer/ });
    expect(within(line).getByText("Comentário da última rejeição:")).toBeTruthy();
    expect(within(line).getByText(/Falta a fonte do número\./)).toBeTruthy();
  });

  it("mostra o estado, as datas no fuso do blog e o motivo da rejeição", () => {
    render(
      <PostList
        posts={[row({ status: "rejeitado", feedback: "Falta a fonte do número." })]}
        tz={SP}
        zone={ZONE}
      />,
    );
    const line = screen.getByRole("row", { name: /Um post de teste qualquer/ });
    expect(within(line).getByText("Rejeitado")).toBeTruthy();
    // 13:00 UTC is 10:00 in São Paulo.
    expect(within(line).getByText("02/10/2026 10:00")).toBeTruthy();
    expect(within(line).getByText(/Falta a fonte do número\./)).toBeTruthy();
  });
});

describe("PostList: o que cada botão faz", () => {
  it("enviar para revisão chama a action e atualiza a lista", async () => {
    const user = userEvent.setup();
    render(<PostList posts={[row()]} tz={SP} zone={ZONE} />);
    await user.click(control("Enviar para revisão"));
    // With the version the row was rendered from.
    expect(actions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "submit",
      if_updated_at: UPDATED,
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("{ ok: false } aparece ao lado da linha, como veio, e o botão volta", async () => {
    const user = userEvent.setup();
    const message = 'O post não está mais em "rascunho" (ou não existe). Recarregue a página.';
    actions.setPostStatus.mockResolvedValue({ ok: false, error: message });
    render(<PostList posts={[row()]} tz={SP} zone={ZONE} />);
    await user.click(control("Enviar para revisão"));
    const line = screen.getByRole("row", { name: /Um post de teste qualquer/ });
    expect((await within(line).findByRole("alert")).textContent).toBe(message);
    expect(isInert(control("Enviar para revisão"))).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("enquanto a action roda, a linha inteira para, o giro fica só no botão clicado e o foco não se perde", async () => {
    const user = userEvent.setup();
    let answer: (value: Moved) => void = () => {};
    actions.setPostStatus.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(
      <PostList posts={[row({ status: "aprovado", scheduledFor: WHEN })]} tz={SP} zone={ZONE} />,
    );
    await user.click(control("Desagendar"));
    for (const name of ["Publicar agora", "Reagendar", "Desagendar"]) {
      expect(isInert(control(name)), name).toBe(true);
    }
    expect(control("Desagendar").getAttribute("aria-busy")).toBe("true");
    expect(control("Publicar agora").hasAttribute("aria-busy")).toBe(false);
    expect(control("Reagendar").hasAttribute("aria-busy")).toBe(false);
    expect(document.activeElement).toBe(control("Desagendar"));

    // Clicks while it runs do nothing: no second request, no dialog.
    await user.click(control("Desagendar"));
    await user.click(control("Publicar agora"));
    expect(actions.setPostStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => answer(moved("aprovado")));
    expect(isInert(control("Desagendar"))).toBe(false);
  });

  it("publicar pede confirmação antes de chamar a action", async () => {
    const user = userEvent.setup();
    actions.setPostStatus.mockResolvedValue(moved("publicado"));
    render(<PostList posts={[row({ status: "aprovado" })]} tz={SP} zone={ZONE} />);
    await user.click(control("Publicar agora"));
    expect(actions.setPostStatus).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Publicar agora?" });
    await user.click(within(dialog).getByRole("button", { name: "Publicar agora" }));
    expect(actions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "publish",
      if_updated_at: UPDATED,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancelar a confirmação não publica", async () => {
    const user = userEvent.setup();
    render(<PostList posts={[row({ status: "aprovado" })]} tz={SP} zone={ZONE} />);
    await user.click(control("Publicar agora"));
    await user.click(button("Cancelar"));
    expect(actions.setPostStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("despublicar também pede confirmação, e o erro fica dentro do diálogo", async () => {
    const user = userEvent.setup();
    actions.setPostStatus.mockResolvedValue({ ok: false, error: "Recarregue a página." });
    render(
      <PostList posts={[row({ status: "publicado", publishedAt: WHEN })]} tz={SP} zone={ZONE} />,
    );
    await user.click(control("Despublicar"));
    const dialog = screen.getByRole("dialog", { name: "Despublicar?" });
    await user.click(within(dialog).getByRole("button", { name: "Despublicar" }));
    expect(actions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "unpublish",
      if_updated_at: UPDATED,
    });
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Recarregue a página.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("desagendar e reabrir vão direto", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <PostList posts={[row({ status: "aprovado", scheduledFor: WHEN })]} tz={SP} zone={ZONE} />,
    );
    await user.click(control("Desagendar"));
    expect(actions.setPostStatus).toHaveBeenLastCalledWith({
      id: ID,
      action: "unschedule",
      if_updated_at: UPDATED,
    });
    unmount();
    render(<PostList posts={[row({ status: "rejeitado" })]} tz={SP} zone={ZONE} />);
    await user.click(control("Reabrir"));
    expect(actions.setPostStatus).toHaveBeenLastCalledWith({
      id: ID,
      action: "reopen",
      if_updated_at: UPDATED,
    });
  });
});

describe("ReviewList", () => {
  it("aprovar chama a action com approve", async () => {
    const user = userEvent.setup();
    render(<ReviewList posts={[row({ status: "revisao" })]} tz={SP} />);
    await user.click(control("Aprovar"));
    // The reviewer approves the version that was on the list, and says which one it was.
    expect(actions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "approve",
      if_updated_at: UPDATED,
    });
  });

  it("texto mudou depois que a lista abriu: a recusa do servidor aparece no item, e nada é aprovado às cegas", async () => {
    const user = userEvent.setup();
    const message = "Alguém salvou este post depois que você abriu. Recarregue.";
    actions.setPostStatus.mockResolvedValue({ ok: false, error: message });
    render(<ReviewList posts={[row({ status: "revisao" })]} tz={SP} />);
    await user.click(control("Aprovar"));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("post sem corpo: a recusa do servidor aparece no item", async () => {
    const user = userEvent.setup();
    const message = "Post sem corpo: escreva o texto antes de aprovar.";
    actions.setPostStatus.mockResolvedValue({ ok: false, error: message });
    render(<ReviewList posts={[row({ status: "revisao" })]} tz={SP} />);
    await user.click(control("Aprovar"));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(isInert(control("Aprovar"))).toBe(false);
  });

  it("rejeitar recusa comentário com menos de 5 caracteres, sem chamar o servidor", async () => {
    const user = userEvent.setup();
    render(<ReviewList posts={[row({ status: "revisao" })]} tz={SP} />);
    await user.click(control("Rejeitar"));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar post" });
    const field = within(dialog).getByLabelText("O que precisa mudar");

    await user.click(within(dialog).getByRole("button", { name: "Rejeitar post" }));
    expect(actions.rejectPost).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert").textContent).toMatch(/pelo menos 5 caracteres/);

    // Four letters, and spaces that do not count.
    await user.type(field, "  ruim   ");
    await user.click(within(dialog).getByRole("button", { name: "Rejeitar post" }));
    expect(actions.rejectPost).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("rejeitar com comentário manda o id e o texto aparado, e fecha", async () => {
    const user = userEvent.setup();
    render(<ReviewList posts={[row({ status: "revisao" })]} tz={SP} />);
    await user.click(control("Rejeitar"));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar post" });
    await user.type(within(dialog).getByLabelText("O que precisa mudar"), "  Falta a fonte. ");
    await user.click(within(dialog).getByRole("button", { name: "Rejeitar post" }));
    expect(actions.rejectPost).toHaveBeenCalledWith({
      id: ID,
      feedback: "Falta a fonte.",
      if_updated_at: UPDATED,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("rejeição recusada pelo servidor fica no diálogo", async () => {
    const user = userEvent.setup();
    actions.rejectPost.mockResolvedValue({ ok: false, error: "Recarregue a página." });
    render(<ReviewList posts={[row({ status: "revisao" })]} tz={SP} />);
    await user.click(control("Rejeitar"));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar post" });
    await user.type(within(dialog).getByLabelText("O que precisa mudar"), "Falta a fonte.");
    await user.click(within(dialog).getByRole("button", { name: "Rejeitar post" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Recarregue a página.");
  });

  it("Esc com a rejeição em andamento não fecha o diálogo, e o erro que chega depois é mostrado", async () => {
    const user = userEvent.setup();
    let answer: (value: { ok: false; error: string }) => void = () => {};
    actions.rejectPost.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<ReviewList posts={[row({ status: "revisao" })]} tz={SP} />);
    await user.click(control("Rejeitar"));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar post" });
    await user.type(within(dialog).getByLabelText("O que precisa mudar"), "Falta a fonte.");
    await user.click(within(dialog).getByRole("button", { name: "Rejeitar post" }));

    let closed = true;
    act(() => {
      closed = pressEscape(dialog);
    });
    expect(closed).toBe(false);
    // A browser that closes it anyway (a second Esc in Chrome): it comes back.
    act(() => forceClose(dialog));
    expect(screen.getByRole("dialog", { name: "Rejeitar post" })).toBeTruthy();
    // Cancel does not answer either while the request is in flight.
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog", { name: "Rejeitar post" })).toBeTruthy();

    await act(async () => answer({ ok: false, error: "O post não está mais em revisão." }));
    const open = screen.getByRole("dialog", { name: "Rejeitar post" });
    expect(within(open).getByRole("alert").textContent).toBe("O post não está mais em revisão.");
    // What was typed is still there to try again.
    expect(within(open).getByLabelText<HTMLTextAreaElement>("O que precisa mudar").value).toBe(
      "Falta a fonte.",
    );
    // Once the answer is in, Esc works again, and the error does not come back on reopening.
    act(() => void pressEscape(open));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(control("Rejeitar"));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });
});

describe("ScheduleDialog: o horário passa por local-time, no fuso do blog", () => {
  const post = { id: ID, title: TITLE, scheduledFor: null, updatedAt: UPDATED };
  const FIELD = "Dia e hora da publicação";

  it("09:30 em São Paulo vai para o servidor como 12:30Z", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDone = vi.fn();
    actions.setPostStatus.mockResolvedValue(moved("aprovado"));
    render(<ScheduleDialog open onClose={onClose} post={post} tz={SP} zone={ZONE} onDone={onDone} />);
    expect(screen.getByText(`No fuso do blog: ${ZONE}.`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: "2027-03-10T09:30" } });
    await user.click(button("Agendar"));
    expect(actions.setPostStatus).toHaveBeenCalledWith({
      id: ID,
      action: "schedule",
      scheduled_for: "2027-03-10T12:30:00.000Z",
      if_updated_at: UPDATED,
    });
    expect(onDone).toHaveBeenCalledWith({
      updatedAt: "2026-10-05T12:00:00.000Z",
      scheduledFor: "2027-03-10T12:30:00.000Z",
    });
    expect(onClose).toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("refresh={false}: quem chamou guarda o resultado, e nada é recarregado", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    actions.setPostStatus.mockResolvedValue(moved("aprovado"));
    render(
      <ScheduleDialog open onClose={() => {}} post={post} tz={SP} zone={ZONE} onDone={onDone} refresh={false} />,
    );
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: "2027-03-10T09:30" } });
    await user.click(button("Agendar"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("o mesmo valor em outro fuso dá outro instante: quem manda é o fuso passado", async () => {
    const user = userEvent.setup();
    render(
      <ScheduleDialog open onClose={() => {}} post={post} tz="Asia/Tokyo" zone="Horário do Japão (Asia/Tokyo)" />,
    );
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: "2027-03-10T09:30" } });
    await user.click(button("Agendar"));
    expect(actions.setPostStatus).toHaveBeenCalledWith(
      expect.objectContaining({ scheduled_for: "2027-03-10T00:30:00.000Z" }),
    );
  });

  it("hora que não existe (começo do horário de verão) mostra a mensagem e não chama o servidor", async () => {
    const user = userEvent.setup();
    render(
      <ScheduleDialog
        open
        onClose={() => {}}
        post={post}
        tz="America/New_York"
        zone="Horário do Leste (America/New_York)"
      />,
    );
    // 14 March 2027, 02:00 jumps to 03:00 in New York.
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: "2027-03-14T02:30" } });
    await user.click(button("Agendar"));
    expect(actions.setPostStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Esse horário não existe no fuso do blog/);
  });

  it("sem data, pede a data e não chama o servidor", async () => {
    const user = userEvent.setup();
    render(<ScheduleDialog open onClose={() => {}} post={post} tz={SP} zone={ZONE} />);
    await user.click(button("Agendar"));
    expect(actions.setPostStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Escolha o dia e a hora.");
  });

  it("reagendar abre com o horário atual, convertido para o fuso do blog", () => {
    render(
      <ScheduleDialog open onClose={() => {}} post={{ ...post, scheduledFor: WHEN }} tz={SP} zone={ZONE} />,
    );
    expect(screen.getByRole("dialog", { name: "Reagendar publicação" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(FIELD).value).toBe("2027-03-10T09:30");
  });

  it("data recusada pelo servidor (no passado) aparece no diálogo, que continua aberto", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const message = 'Data precisa ser no futuro. Para agora, use "Publicar agora".';
    actions.setPostStatus.mockResolvedValue({ ok: false, error: message });
    render(<ScheduleDialog open onClose={onClose} post={post} tz={SP} zone={ZONE} />);
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: "2020-01-01T09:30" } });
    await user.click(button("Agendar"));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(isInert(button("Agendar"))).toBe(false);
  });

  it("Esc com o agendamento em andamento não fecha, e o erro que chega depois é mostrado", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let answer: (value: { ok: false; error: string }) => void = () => {};
    actions.setPostStatus.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<ScheduleDialog open onClose={onClose} post={post} tz={SP} zone={ZONE} />);
    fireEvent.change(screen.getByLabelText(FIELD), { target: { value: "2027-03-10T09:30" } });
    await user.click(button("Agendar"));
    act(() => void pressEscape(screen.getByRole("dialog")));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer({ ok: false, error: "Este post não está agendado." }));
    expect(screen.getByRole("alert").textContent).toBe("Este post não está agendado.");
  });
});

describe("ScheduledList", () => {
  const scheduled = row({ status: "aprovado", scheduledFor: WHEN });

  it("mostra o horário no fuso do blog, com o fuso por extenso", () => {
    render(<ScheduledList posts={[scheduled]} tz={SP} zone={ZONE} />);
    expect(screen.getByText("10/03/2027 09:30")).toBeTruthy();
    expect(screen.getByText(new RegExp(ZONE.replace(/[()]/g, "\\$&")))).toBeTruthy();
    expect(screen.queryByText(/Atrasado/)).toBeNull();
  });

  it("post com a data vencida ganha o aviso", () => {
    render(<ScheduledList posts={[{ ...scheduled, overdue: true }]} tz={SP} zone={ZONE} />);
    expect(screen.getByRole("status").textContent).toMatch(/^Atrasado: o horário já passou/);
  });

  it("desagendar vai direto; publicar agora pede confirmação", async () => {
    const user = userEvent.setup();
    render(<ScheduledList posts={[scheduled]} tz={SP} zone={ZONE} />);
    await user.click(control("Desagendar"));
    expect(actions.setPostStatus).toHaveBeenLastCalledWith({
      id: ID,
      action: "unschedule",
      if_updated_at: UPDATED,
    });

    await user.click(control("Publicar agora"));
    expect(actions.setPostStatus).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "Publicar agora?" });
    await user.click(within(dialog).getByRole("button", { name: "Publicar agora" }));
    expect(actions.setPostStatus).toHaveBeenLastCalledWith({
      id: ID,
      action: "publish",
      if_updated_at: UPDATED,
    });
  });

  it("reagendar abre o diálogo com o horário atual", async () => {
    const user = userEvent.setup();
    render(<ScheduledList posts={[scheduled]} tz={SP} zone={ZONE} />);
    await user.click(control("Reagendar"));
    const dialog = screen.getByRole("dialog", { name: "Reagendar publicação" });
    expect(within(dialog).getByLabelText<HTMLInputElement>("Dia e hora da publicação").value).toBe(
      "2027-03-10T09:30",
    );
  });
});
