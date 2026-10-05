// What jsdom lacks and the components rely on. Each stand-in keeps the contract the code under
// test uses and nothing more.

// jsdom has no HTMLDialogElement.showModal()/close(): `open` reflects the state and "close"
// fires when it ends. Focus trapping is the browser's job and is not simulated.
export function installDialogPolyfill(): void {
  const proto = window.HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof proto.showModal === "function") return;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new window.Event("close"));
  };
}

// What Esc does to a modal dialog in a browser: a cancelable "cancel" event and, unless a
// listener prevented it, the dialog closes. Returns whether it closed.
export function pressEscape(dialog: HTMLElement): boolean {
  const cancel = new window.Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  if (cancel.defaultPrevented) return false;
  (dialog as HTMLDialogElement).close();
  return true;
}

// A browser that closes the dialog whatever the page says (Chrome, on a second Esc).
export function forceClose(dialog: HTMLElement): void {
  (dialog as HTMLDialogElement).close();
}

// What ProseMirror asks of the DOM, with a view on screen, that jsdom does not implement. One
// thing, found by running the editor tests without it: after a command with focus(), the view
// scrolls the selection into sight and asks a Range for its rectangles (coordsAtPos). jsdom does
// no layout and has no Range.getClientRects, so the command worked and an unhandled TypeError
// followed. These answer "no rectangles". Nothing here makes real key presses reach the editor:
// the tests type by dispatching the transaction a key press produces (insertText on the current
// selection), and paste through view.pasteHTML, which builds a ClipboardEvent jsdom lacks.
export function installEditorDomStubs(): void {
  const scope = globalThis as unknown as { ClipboardEvent?: typeof Event };
  if (!scope.ClipboardEvent) scope.ClipboardEvent = class ClipboardEvent extends window.Event {};
  const proto = window.Range.prototype as Range & {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  if (!proto.getClientRects) proto.getClientRects = () => [] as unknown as DOMRectList;
  // What coordsAtPos falls back to when there are no rectangles.
  if (!proto.getBoundingClientRect) {
    proto.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  }
}

// Whether a button takes clicks. A pending button is aria-disabled, not disabled (ui/button.tsx),
// so tests ask this instead of reading `.disabled`.
export function isInert(button: HTMLElement): boolean {
  return (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true";
}
