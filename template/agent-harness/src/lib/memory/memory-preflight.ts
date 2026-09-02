import type { MemoryRootKind } from './memory-autopilot-document-rules.js';
import { type MemoryDiagnosticCode, memoryDiagnosticCode } from './memory-diagnostic.js';
import { validateMemoryRoot } from './memory-validation.js';

export function validateMemoryPreflight(
  root: string,
  rootKind: Exclude<MemoryRootKind, 'auto'>,
  {
    contentOverrides = new Map(),
    allowNonCanonicalReferences = false,
    allowInputIdentityDiagnostics = false,
    allowHandoffIdentityDiagnostics = false,
  }: {
    contentOverrides?: Map<string, string>;
    allowNonCanonicalReferences?: boolean;
    allowInputIdentityDiagnostics?: boolean;
    allowHandoffIdentityDiagnostics?: boolean;
  } = {},
): void {
  const diagnostics: Array<{ message: string; code?: MemoryDiagnosticCode }> = [];
  try {
    validateMemoryRoot(
      root,
      {
        log: () => {},
        error: (message, ...optional) =>
          diagnostics.push({
            message: String(message),
            code: optional.map(memoryDiagnosticCode).find(Boolean),
          }),
      },
      { quietSuccess: true, contentOverrides, rootKind },
    );
  } catch (error) {
    const exclusivelyMatches = (...codes: MemoryDiagnosticCode[]) =>
      diagnostics.length > 0 &&
      diagnostics.every(({ code }) => code !== undefined && codes.includes(code));
    const repairableReferences = exclusivelyMatches('non-canonical-reference');
    if (allowNonCanonicalReferences && repairableReferences) return;
    if (allowInputIdentityDiagnostics && exclusivelyMatches('input-identity')) return;
    if (
      allowHandoffIdentityDiagnostics &&
      exclusivelyMatches('handoff-identity', 'non-canonical-reference')
    )
      return;
    const details = diagnostics
      .slice(0, 5)
      .map(({ message }) => message)
      .join('; ');
    throw new Error(
      `Memory preflight failed: ${error instanceof Error ? error.message : String(error)}${details ? `; ${details}` : ''}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
