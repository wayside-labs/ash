"use client";

import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { Notice } from "@/ui/notice";
import { type ImageOwner, type UploadedImage, uploadImage } from "./upload-image";

export type ChosenImage = UploadedImage & { alt: string };

type Props = {
  open: boolean;
  onClose: () => void;
  // The post or the author the file is stored under.
  owner: ImageOwner;
  title: string;
  confirmLabel: string;
  // "required" for an image that carries meaning (body, cover); "none" for one that sits next
  // to the name it illustrates (an avatar), where a description would only repeat it.
  alt?: "required" | "none";
  onChoose: (image: ChosenImage) => void;
};

const MAX_ALT = 160;

// Two steps in one dialog: the file goes up as soon as it is chosen, and the image is only
// handed over once the upload succeeded and (when asked for) has its description. A failed
// upload leaves nothing to insert.
function ImageForm({
  uploading,
  setUploading,
  onClose,
  owner,
  confirmLabel,
  alt = "required",
  onChoose,
}: Omit<Props, "open" | "title"> & { uploading: boolean; setUploading: (value: boolean) => void }) {
  const [uploaded, setUploaded] = useState<UploadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [text, setText] = useState("");
  const [altProblem, setAltProblem] = useState<string | null>(null);
  // The upload in flight. A second file chosen while the first is still going up stops the
  // first, and only the last answer counts.
  const inFlight = useRef<AbortController | null>(null);
  // Closing the dialog some other way must not leave a request running behind it.
  useEffect(() => () => inFlight.current?.abort(), []);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setError(null);
    setCancelled(false);
    setUploaded(null);
    setUploading(true);
    const result = await uploadImage(file, owner, { signal: controller.signal });
    if (inFlight.current !== controller) return;
    inFlight.current = null;
    setUploading(false);
    if (result.ok) setUploaded({ url: result.url, width: result.width, height: result.height });
    else if (result.cancelled) setCancelled(true);
    else setError(result.error);
  }

  // While a file is going up, "cancel" means the upload, not the dialog: the request is
  // stopped, the dialog stays, and from then on it closes as usual.
  function cancel() {
    if (!uploading) {
      onClose();
      return;
    }
    inFlight.current?.abort();
    inFlight.current = null;
    setUploading(false);
    setCancelled(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!uploaded || uploading) return;
    const description = text.trim();
    if (alt === "required" && !description) {
      setAltProblem("Descreva a imagem: é o que lê quem não a vê.");
      return;
    }
    onChoose({ ...uploaded, alt: description });
    onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="image-file" className="block text-sm font-medium text-ink">
          Arquivo
        </label>
        <input
          id="image-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={choose}
          aria-describedby="image-file-hint"
          className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-elevated file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
        <p id="image-file-hint" className="text-xs text-muted">
          JPG, PNG ou WebP, até 5 MB. A imagem é reduzida e regravada no servidor, sem os dados da
          câmera.
        </p>
      </div>

      {uploading ? <Notice tone="info">Enviando a imagem…</Notice> : null}
      {cancelled ? <Notice tone="info">Envio cancelado. Escolha o arquivo de novo para enviar.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {uploaded ? (
        <>
          {/* A plain img: the file is ours (/media) and next/image is off (next.config.ts). */}
          <img src={uploaded.url} alt="" className="max-h-56 w-auto rounded-md border border-line" />
          {alt === "required" ? (
            <TextField
              label="Texto alternativo"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MAX_ALT}
              hint="O que a imagem mostra, em uma frase. Leitores de tela leem este texto."
              error={altProblem}
            />
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={cancel}>
          {uploading ? "Cancelar envio" : "Cancelar"}
        </Button>
        {/* Not available at all until there is an uploaded image to hand over. */}
        <Button type="submit" variant="primary" disabled={!uploaded} pending={uploading}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

// `uploading` lives above the Dialog: while the file is going up the dialog refuses Esc, so the
// answer (an error, most of all) has somewhere to be shown. "Cancelar envio" stops the request,
// and the dialog can be dismissed again.
export function ImageDialog({ open, onClose, title, ...rest }: Props) {
  const [uploading, setUploading] = useState(false);
  const close = () => {
    setUploading(false);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} dismissible={!uploading} title={title}>
      <ImageForm uploading={uploading} setUploading={setUploading} onClose={close} {...rest} />
    </Dialog>
  );
}
