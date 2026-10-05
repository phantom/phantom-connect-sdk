/**
 * Jest mock for the `incur` package.
 *
 * incur is ESM-only and cannot be required() in a CJS Jest environment.
 * This shim provides:
 *   - `z` re-exported from zod (incur just re-exports zod's z anyway)
 *   - A minimal `Cli` stub so command files that import `Cli.create` don't crash
 *     during unit tests that only care about the `tools` layer.
 */

export { z } from "zod";

type CliInstance = {
  command: (..._args: unknown[]) => CliInstance;
  use: (..._args: unknown[]) => CliInstance;
  serve: () => void;
};

const makeCliInstance = (): CliInstance => {
  const instance: CliInstance = {
    command: () => instance,
    use: () => instance,
    serve: () => {},
  };
  return instance;
};

export const Cli = {
  create: (_name: string, _config?: unknown): CliInstance => makeCliInstance(),
};

export const middleware = {};

class IncurError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  declare readonly cause?: Error;

  constructor(options: { code: string; message: string; retryable?: boolean; cause?: Error }) {
    super(options.message);
    this.name = "Incur.IncurError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export const Errors = { IncurError };
