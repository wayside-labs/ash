/**
 * An error that is already fit for a developer's terminal.
 *
 * The distinction from a plain `Error` is deliberate: a `CliError` is something the CLI
 * anticipated and can tell the user what to do about, so `cli.ts` prints `message` plus
 * `hint` and exits. Anything else is a bug and gets a stack trace, because hiding one
 * behind a friendly sentence is how a broken CLI looks like a broken chain.
 */
export class CliError extends Error {
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(
    message: string,
    options: { hint?: string; exitCode?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliError";
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}
