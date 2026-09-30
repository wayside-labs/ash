/** A non-2xx answer from one of the dashboard's own routes, with the status kept for callers. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    /** The route's `{ error }` string, when it sent one. */
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** `missingAccountResponse()` in lib/server/state/context.ts; other 403s are CSRF refusals. */
export const ACCOUNT_NOT_PROVISIONED = "account not provisioned";

export function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpError && error.status === 401;
}

export function isUnprovisioned(error: unknown): boolean {
  return (
    error instanceof HttpError && error.status === 403 && error.code === ACCOUNT_NOT_PROVISIONED
  );
}
