/** SSR-safe storage for react-resizable-panels layout persistence. */
const noopStorage: Storage = {
  get length() {
    return 0;
  },
  clear() {},
  getItem() {
    return null;
  },
  key() {
    return null;
  },
  removeItem() {},
  setItem() {},
};

export function getPanelLayoutStorage(): Storage {
  if (typeof window === "undefined") return noopStorage;
  try {
    return window.localStorage;
  } catch {
    return noopStorage;
  }
}
