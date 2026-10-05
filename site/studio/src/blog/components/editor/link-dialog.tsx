"use client";

import { type FormEvent, useState } from "react";
import { isSafeHref } from "@/blog/lib/href";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { TextField } from "@/ui/field";

type Props = {
  open: boolean;
  onClose: () => void;
  // The link under the cursor, when there is one: the dialog then edits or removes it.
  current: string | null;
  onApply: (href: string) => void;
  onRemove: () => void;
};

const UNSAFE =
  "Use um endereço que comece com https://, http://, mailto:, # ou, para uma página do próprio site, com uma barra (/).";

// The same rule the sanitizer applies on save (lib/href.ts): a link that would be stripped
// there is refused here, with the reason, instead of vanishing later.
function LinkForm({ onClose, current, onApply, onRemove }: Omit<Props, "open">) {
  const [href, setHref] = useState(current ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = href.trim();
    if (!value) {
      setProblem("Escreva o endereço do link.");
      return;
    }
    if (!isSafeHref(value)) {
      setProblem(UNSAFE);
      return;
    }
    onApply(value);
    onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Endereço"
        value={href}
        onChange={(event) => setHref(event.target.value)}
        placeholder="https://"
        autoFocus
        spellCheck={false}
        autoCapitalize="none"
        hint="Link para outra página do site começa com /, por exemplo /pt/blog/outro-post. Para fora do site, o endereço completo, com https://."
        error={problem}
      />
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        {current ? (
          <Button
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            Remover link
          </Button>
        ) : null}
        <Button type="submit" variant="primary">
          {current ? "Trocar link" : "Colocar link"}
        </Button>
      </div>
    </form>
  );
}

export function LinkDialog({ open, onClose, ...rest }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={rest.current ? "Editar link" : "Colocar link"}>
      <LinkForm onClose={onClose} {...rest} />
    </Dialog>
  );
}
