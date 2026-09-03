import { atomicWrite } from '../filesystem/files.js';
import { readMemoryDocument } from './memory-path.js';
import { validateMemoryDocument, validateMemoryRoot } from './memory-validation.js';
import {
  type ExactFileState,
  exactFileStateMatches,
  restoreExactFileState,
} from './memory-write.js';

type RootKind = 'global' | 'project';

function collectValidationError(message: unknown, errors: string[]): void {
  const diagnostic = String(message);
  if (!diagnostic.startsWith('WARNING ')) errors.push(diagnostic);
}

function postWriteIssues(
  root: string,
  rootKind: RootKind,
  source: string,
  baselineErrors: string[],
): string[] {
  const rootErrors: string[] = [];
  const documentErrors: string[] = [];
  const executionIssues: string[] = [];
  try {
    validateMemoryRoot(
      root,
      {
        log: (message) => collectValidationError(message, rootErrors),
        error: (message) => collectValidationError(message, rootErrors),
      },
      { quietSuccess: true, rootKind },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expected = rootErrors.length > 0 && /^Memory check failed: \d+ issue\(s\)$/.test(message);
    if (!expected) executionIssues.push(message);
  }
  try {
    validateMemoryDocument(
      root,
      source,
      readMemoryDocument(source),
      {
        log: (message) => collectValidationError(message, documentErrors),
        error: (message) => collectValidationError(message, documentErrors),
      },
      { rootKind },
    );
  } catch (error) {
    executionIssues.push(error instanceof Error ? error.message : String(error));
  }
  const baseline = new Set(baselineErrors);
  return [
    ...executionIssues,
    ...documentErrors,
    ...rootErrors.filter((issue) => !baseline.has(issue)),
  ];
}

function rollbackMigration(
  root: string,
  source: string,
  original: ExactFileState,
  attempted: ExactFileState,
): never {
  const rollbackError = restoreExactFileState(root, source, original, attempted);
  if (rollbackError) {
    throw new Error(
      `Memory migration failed post-write validation and rollback was incomplete; unresolved paths: ${rollbackError}`,
    );
  }
  throw new Error('Memory migration failed post-write validation and was rolled back');
}

export function applyMigration(
  root: string,
  rootKind: RootKind,
  source: string,
  content: string,
  originalState: ExactFileState,
  baselineErrors: string[],
): void {
  if (!exactFileStateMatches(source, originalState)) {
    throw new Error(
      `Memory migration source changed after proposal validation; concurrent content retained at recovery path ${source}`,
    );
  }
  const attemptedState = { exists: true, content, mode: originalState.mode } as const;
  atomicWrite(source, content, originalState.mode);
  if (postWriteIssues(root, rootKind, source, baselineErrors).length > 0) {
    rollbackMigration(root, source, originalState, attemptedState);
  }
}
