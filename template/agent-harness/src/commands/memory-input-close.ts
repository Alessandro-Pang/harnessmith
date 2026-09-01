import { join } from 'node:path';
import { parseFrontmatterDocument, updateFrontmatter } from '../lib/frontmatter.js';
import { removeCoreReference } from '../lib/memory-core.js';
import { singleLine } from '../lib/memory-input-policy.js';
import { memoryDocumentPath, memoryReference, readMemoryDocument } from '../lib/memory-path.js';
import {
  type MemoryWriteCandidate,
  type MemoryWriteResult,
  output,
  validateUnchanged,
  writeValidated,
} from '../lib/memory-write.js';
import { withProjectMemoryTransaction } from '../lib/project-memory.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export interface CloseInputOptions {
  reason: 'consumed' | 'workstream-complete' | 'promoted' | 'invalid';
  evidenceRef?: string;
  json?: boolean;
}

const closeReasons = new Set<CloseInputOptions['reason']>([
  'consumed',
  'workstream-complete',
  'promoted',
  'invalid',
]);

function removeActiveReference(
  memoryRoot: string,
  reference: string,
  date: string,
): { path: string; current: string; updated: string } {
  const path = join(memoryRoot, 'core.md');
  const current = readMemoryDocument(path);
  return {
    path,
    current,
    updated: removeCoreReference(current, 'Important Inputs', reference, date),
  };
}

export function closeInput(
  runtime: Runtime,
  project: string,
  input: string,
  options: CloseInputOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  if (!closeReasons.has(options.reason)) {
    throw new Error(
      'Input close reason must be consumed, workstream-complete, promoted, or invalid',
    );
  }
  const evidenceRef = singleLine(options.evidenceRef, 'Input evidence reference');
  assertNoHighConfidenceSecret([project, input, options.reason, evidenceRef], 'Memory input close');
  const result = withProjectMemoryTransaction<MemoryWriteCandidate>(
    runtime,
    project,
    ({ memoryRoot }) => {
      const path = memoryDocumentPath(memoryRoot, input);
      const current = readMemoryDocument(path);
      const parsed = parseFrontmatterDocument(current);
      if (parsed.metadata.get('memory-kind') !== 'input') {
        throw new Error(`Memory is not an input: ${path}`);
      }
      const status = String(parsed.metadata.get('status') || 'unknown');
      const reference = `memory:${memoryReference(memoryRoot, path)}`;
      const date = calendarDate(runtime);
      const core = removeActiveReference(memoryRoot, reference, date);
      if (status === 'complete') {
        if (core.updated !== core.current) {
          writeValidated(memoryRoot, [{ path: core.path, content: core.updated }], io, {
            rootKind: 'project',
          });
          return { version: 1, action: 'updated', kind: 'input', path, reference };
        }
        validateUnchanged(memoryRoot, io, { rootKind: 'project' });
        return { version: 1, action: 'unchanged', kind: 'input', path, reference };
      }
      if (!['active', 'blocked'].includes(status)) {
        throw new Error(`Input with status ${status} cannot be closed: ${path}`);
      }
      const content = updateFrontmatter(current, {
        status: 'complete',
        updated: date,
        closed: date,
        'close-reason': options.reason,
        ...(evidenceRef ? { 'consumed-by': evidenceRef } : {}),
      });
      writeValidated(
        memoryRoot,
        [
          { path, content },
          { path: core.path, content: core.updated },
        ],
        io,
        { rootKind: 'project' },
      );
      return { version: 1, action: 'updated', kind: 'input', path, reference };
    },
    { allowNonCanonicalReferences: true, allowInputIdentityDiagnostics: true },
  );
  return output(result, Boolean(options.json), io);
}
