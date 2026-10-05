// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { forceClose, installDialogPolyfill, isInert, pressEscape } from "../../tests/helpers/dom";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";
import { Dialog } from "./dialog";
import { TextField } from "./field";
import { currentNavHref } from "./nav";
import { Tabs } from "./tabs";
import { UNEXPECTED_ERROR, useAction } from "./use-action";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeAll(installDialogPolyfill);
beforeEach(() => refresh.mockReset());

describe("Button", () => {
  it("é type=button, a não ser que peçam outro", () => {
    render(<Button>Salvar</Button>);
    expect(screen.getByRole("button", { name: "Salvar" }).getAttribute("type")).toBe("button");
  });

  it("pending: avisa que está ocupado, não responde ao clique e continua podendo ter o foco", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button pending onClick={onClick}>
        Salvar
      </Button>,
    );
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Salvar" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // Not the disabled attribute: a disabled button drops the focus to <body>.
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("blocked: não responde, e não mostra que é ele que está trabalhando", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button blocked onClick={onClick}>
        Outro
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Outro" });
    expect(isInert(button)).toBe(true);
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(button.querySelector("svg")).toBeNull();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("botão de enviar pendente não envia o formulário, nem por clique nem por Enter no campo", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="campo" />
        <Button type="submit" pending>
          Enviar
        </Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.type(screen.getByLabelText("campo"), "texto{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("TextField", () => {
  it("liga o rótulo, a dica e o erro ao campo", () => {
    render(<TextField label="Endereço" hint="Só minúsculas" error="Inválido" defaultValue="X" />);
    const input = screen.getByLabelText("Endereço");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(["Só minúsculas", "Inválido"]);
  });

  it("sem dica nem erro, não aponta para nada", () => {
    render(<TextField label="Nome" />);
    const input = screen.getByLabelText("Nome");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("Dialog", () => {
  it("fechado não mostra nada; aberto tem nome e conteúdo", () => {
    const { rerender } = render(
      <Dialog open={false} onClose={() => {}} title="Rejeitar post">
        <p>corpo</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("corpo")).toBeNull();

    rerender(
      <Dialog open onClose={() => {}} title="Rejeitar post">
        <p>corpo</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Rejeitar post" })).toBeTruthy();
    expect(screen.getByText("corpo")).toBeTruthy();
  });

  it("Esc fecha e avisa o dono", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Agendar">
        <p>corpo</p>
      </Dialog>,
    );
    let closed = false;
    act(() => {
      closed = pressEscape(screen.getByRole("dialog"));
    });
    expect(closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("com dismissible=false o Esc não fecha e o dono não é avisado", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Agendar" dismissible={false}>
        <p>corpo</p>
      </Dialog>,
    );
    let closed = true;
    act(() => {
      closed = pressEscape(screen.getByRole("dialog"));
    });
    expect(closed).toBe(false);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("navegador que fecha à força (segundo Esc): o diálogo volta, com o conteúdo, e o dono não é avisado", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Agendar" dismissible={false}>
        <p>corpo</p>
      </Dialog>,
    );
    act(() => forceClose(screen.getByRole("dialog")));
    expect(screen.getByRole("dialog", { name: "Agendar" })).toBeTruthy();
    expect(screen.getByText("corpo")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog", () => {
  it("confirma, cancela, e mostra o erro sem fechar", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open title="Publicar?" confirmLabel="Publicar" onConfirm={onConfirm} onClose={onClose}>
        Vai para o site.
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmDialog
        open
        title="Publicar?"
        confirmLabel="Publicar"
        error="O post não está mais em aprovado."
        onConfirm={onConfirm}
        onClose={onClose}
      >
        Vai para o site.
      </ConfirmDialog>,
    );
    expect(screen.getByRole("alert").textContent).toBe("O post não está mais em aprovado.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("enquanto a ação roda, nenhum dos dois botões responde e o Esc não fecha", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog open pending title="Publicar?" confirmLabel="Publicar" onConfirm={onConfirm} onClose={onClose}>
        Vai para o site.
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    act(() => void pressEscape(screen.getByRole("dialog")));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The spinner is on the button that is working, not on Cancel.
    expect(screen.getByRole("button", { name: "Publicar" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Cancelar" }).hasAttribute("aria-busy")).toBe(false);
  });
});

describe("Tabs", () => {
  it("marca a aba atual com aria-current e mostra a contagem", () => {
    render(
      <Tabs
        label="Seções do blog"
        items={[
          { href: "/blog", label: "Posts", count: 12, current: false },
          { href: "/blog?view=revisao", label: "Revisão", count: 3, current: true },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Seções do blog" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([null, "page"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/blog", "/blog?view=revisao"]);
    expect(links[1]?.textContent).toBe("Revisão3");
  });
});

describe("currentNavHref", () => {
  const cases: [string, string | null][] = [
    ["/", "/"],
    ["/blog", "/blog"],
    ["/blog/novo", "/blog"],
    ["/blog/3f2c0d1e-0000-4000-8000-000000000000", "/blog"],
    ["/blog/3f2c0d1e-0000-4000-8000-000000000000/previa", "/blog"],
    ["/blog/categorias", "/blog/categorias"],
    ["/blog/autores", "/blog/autores"],
    // A folder that only starts like an item is not that item.
    ["/blogueiros", null],
    ["/blog/categorias-antigas", "/blog"],
    ["/api/health", null],
  ];
  for (const [pathname, expected] of cases) {
    it(`${pathname} → ${expected ?? "nenhum"}`, () => {
      expect(currentNavHref(pathname)).toBe(expected);
    });
  }
});

describe("useAction", () => {
  type Answer = { ok: true; data: number } | { ok: false; error: string };
  function Probe({
    action,
    after,
    onSuccess,
  }: {
    action: () => Promise<Answer>;
    after?: "refresh" | "stay" | "leave";
    onSuccess?: () => void;
  }) {
    const { pending, error, run, isRunning } = useAction();
    return (
      <div>
        <Button
          pending={isRunning("a")}
          blocked={pending && !isRunning("a")}
          onClick={() => run(action, onSuccess, { key: "a", ...(after ? { after } : {}) })}
        >
          Agir
        </Button>
        <Button
          pending={isRunning("b")}
          blocked={pending && !isRunning("b")}
          onClick={() => run(action, onSuccess, { key: "b" })}
        >
          Outro
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  }
  const agir = () => screen.getByRole("button", { name: "Agir" });

  it("sucesso: atualiza a tela e não mostra erro", async () => {
    const user = userEvent.setup();
    render(<Probe action={async () => ({ ok: true, data: 1 })} />);
    await user.click(agir());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("{ ok: false }: mostra a mensagem como veio, não atualiza e devolve o botão", async () => {
    const user = userEvent.setup();
    render(<Probe action={async () => ({ ok: false, error: "Recarregue a página." })} />);
    await user.click(agir());
    expect((await screen.findByRole("alert")).textContent).toBe("Recarregue a página.");
    expect(refresh).not.toHaveBeenCalled();
    expect(isInert(agir())).toBe(false);
  });

  it("action que lança vira uma mensagem, não uma tela quebrada", async () => {
    const user = userEvent.setup();
    render(
      <Probe
        action={async () => {
          throw new Error("An error occurred in the Server Components render.");
        }}
      />,
    );
    await user.click(agir());
    expect((await screen.findByRole("alert")).textContent).toBe(UNEXPECTED_ERROR);
    expect(isInert(agir())).toBe(false);
  });

  it("enquanto a action não responde: os dois botões param, o giro fica só no que foi clicado, e um segundo clique não repete", async () => {
    const user = userEvent.setup();
    let answer: (value: Answer) => void = () => {};
    const slow = vi.fn(() => new Promise<Answer>((resolve) => (answer = resolve)));
    render(<Probe action={slow} />);
    await user.click(agir());
    const outro = screen.getByRole("button", { name: "Outro" });
    expect(isInert(agir())).toBe(true);
    expect(isInert(outro)).toBe(true);
    expect(agir().getAttribute("aria-busy")).toBe("true");
    expect(outro.hasAttribute("aria-busy")).toBe(false);
    // The focus stays where the admin left it.
    expect(document.activeElement).toBe(agir());

    await user.click(agir());
    await user.click(outro);
    expect(slow).toHaveBeenCalledTimes(1);

    await act(async () => answer({ ok: true, data: 1 }));
    expect(isInert(agir())).toBe(false);
    expect(isInert(outro)).toBe(false);
  });

  it('after "stay": não recarrega nada', async () => {
    const user = userEvent.setup();
    render(<Probe action={async () => ({ ok: true, data: 1 })} after="stay" />);
    await user.click(agir());
    expect(refresh).not.toHaveBeenCalled();
    expect(isInert(agir())).toBe(false);
  });

  it('after "leave": depois do sucesso o botão continua morto, e um segundo clique não chama a action de novo', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<Answer> => ({ ok: true, data: 1 }));
    const onSuccess = vi.fn();
    render(<Probe action={action} after="leave" onSuccess={onSuccess} />);
    await user.click(agir());
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(isInert(agir())).toBe(true);
    await user.click(agir());
    await user.click(screen.getByRole("button", { name: "Outro" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('after "leave" com erro: o botão volta, para tentar de novo', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<Answer> => ({ ok: false, error: "Título muito curto" }));
    render(<Probe action={action} after="leave" />);
    await user.click(agir());
    expect((await screen.findByRole("alert")).textContent).toBe("Título muito curto");
    expect(isInert(agir())).toBe(false);
    await user.click(agir());
    expect(action).toHaveBeenCalledTimes(2);
  });
});
