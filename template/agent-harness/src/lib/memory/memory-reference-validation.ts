import type { Io } from '../../types.js';
import { reportMemoryDiagnostic } from './memory-diagnostic.js';
import { type ManagedMemoryEntry, MemoryPathError, memoryDocumentPath } from './memory-path.js';

export function validateMemoryReferences(
  root: string,
  references: Set<string>,
  entries: readonly ManagedMemoryEntry[],
  io: Io,
): number {
  let failures = 0;
  for (const name of references) {
    try {
      memoryDocumentPath(root, name, entries);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const display = message.includes('does not exist')
        ? `Broken memory reference: memory:${name}`
        : message.includes('escapes root')
          ? `Memory reference escapes root: memory:${name}`
          : `Invalid memory reference memory:${name}: ${message}`;
      if (error instanceof MemoryPathError && error.code === 'non-canonical-reference') {
        reportMemoryDiagnostic(io, 'non-canonical-reference', display);
      } else io.error(display);
      failures += 1;
    }
  }
  return failures;
}
