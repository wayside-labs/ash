import { StateAccessError } from "./context";

/** Maps `StateAccessError` to its HTTP response inside route handlers. */
export function stateAccessResponse(error: unknown): Response | null {
  if (error instanceof StateAccessError) return error.response;
  return null;
}
