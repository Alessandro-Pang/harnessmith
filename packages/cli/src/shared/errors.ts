/** @public Stable code emitted by the CLI error contract. */
export type HarnessmithErrorCode =
  | 'CLI_USAGE'
  | 'SAFETY_CONFLICT'
  | 'UNSAFE_PATH'
  | 'OPERATION_LOCKED'
  | 'INTEGRITY_ERROR'
  | 'STATE_CONFLICT'
  | 'INTERNAL_ERROR';

export type HarnessmithErrorOptions = ErrorOptions & { reason?: string };

export class HarnessmithError extends Error {
  readonly code: HarnessmithErrorCode;
  readonly exitCode: number;
  readonly reason?: string | undefined;

  constructor(
    code: HarnessmithErrorCode,
    message: string,
    exitCode: number,
    options: HarnessmithErrorOptions = {},
  ) {
    const { reason, ...errorOptions } = options;
    super(message, errorOptions);
    this.name = 'HarnessmithError';
    this.code = code;
    this.exitCode = exitCode;
    this.reason = reason;
  }
}

/** @public Machine-readable CLI error report used by launchers and JSON consumers. */
export interface MachineErrorReport {
  version: 1;
  ok: false;
  error: {
    code: HarnessmithErrorCode;
    message: string;
    exitCode: number;
  };
}

export function machineErrorReport(error: unknown): MachineErrorReport {
  const commanderCode =
    error instanceof Error && 'code' in error
      ? String((error as Error & { code?: string }).code)
      : '';
  const failure =
    error instanceof HarnessmithError
      ? error
      : commanderCode.startsWith('commander.')
        ? new HarnessmithError('CLI_USAGE', errorMessage(error), 2, {
            cause: error instanceof Error ? error : undefined,
          })
        : new HarnessmithError('INTERNAL_ERROR', errorMessage(error), 1, {
            cause: error instanceof Error ? error : undefined,
          });
  return {
    version: 1,
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      exitCode: failure.exitCode,
    },
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
