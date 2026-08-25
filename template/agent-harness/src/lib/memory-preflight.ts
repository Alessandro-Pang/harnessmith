import type { MemoryRootKind } from './memory-autopilot-document-rules.js';
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
  const diagnostics: string[] = [];
  try {
    validateMemoryRoot(
      root,
      {
        log: () => {},
        error: (message) => diagnostics.push(String(message)),
      },
      { quietSuccess: true, contentOverrides, rootKind },
    );
  } catch (error) {
    const nonCanonicalReference = (diagnostic: string) =>
      /^Invalid memory reference memory:[^:]+: Memory document reference is not canonical: .+$/.test(
        diagnostic,
      );
    const inputIdentity = (diagnostic: string) =>
      /^(?:Input content digest does not match its payload semantics|Duplicate input identity sha256:[a-f0-9]{64}): /.test(
        diagnostic,
      );
    const handoffIdentity = (diagnostic: string) =>
      /^Invalid typed handoff canonical path: /.test(diagnostic) ||
      /^Invalid typed handoff generation identity: /.test(diagnostic) ||
      nonCanonicalReference(diagnostic);
    const exclusivelyMatches = (predicate: (diagnostic: string) => boolean) =>
      diagnostics.length > 0 && diagnostics.every(predicate);
    const repairableReferences = exclusivelyMatches(nonCanonicalReference);
    if (allowNonCanonicalReferences && repairableReferences) return;
    if (allowInputIdentityDiagnostics && exclusivelyMatches(inputIdentity)) return;
    if (allowHandoffIdentityDiagnostics && exclusivelyMatches(handoffIdentity)) return;
    const details = diagnostics.slice(0, 5).join('; ');
    throw new Error(
      `Memory preflight failed: ${error instanceof Error ? error.message : String(error)}${details ? `; ${details}` : ''}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
