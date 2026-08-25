import { parseFrontmatter, updateFrontmatter } from '../lib/frontmatter.js';
import { snapshotMemoryFile } from '../lib/memory-lifecycle-transaction.js';
import { withMemoryLock } from '../lib/memory-lock.js';
import { applyMigration } from '../lib/memory-migration-apply.js';
import { memoryDocumentPath, memoryReference, resolveMemoryRoot } from '../lib/memory-path.js';
import { validateMemoryDocument, validateMemoryRoot } from '../lib/memory-validation.js';
import {
  assertNoHighConfidenceSecret,
  assertNoHighConfidenceSecretInValue,
} from '../lib/secret-hygiene.js';
import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export interface MemoryMigrationReport {
  version: 1;
  mode: 'proposal-only' | 'applied';
  memory: string;
  proposedUpdates: Record<string, unknown>;
  ready: boolean;
  issues: string[];
}

function collectValidationDiagnostic(message: unknown, errors: string[], warnings: string[]): void {
  const diagnostic = String(message);
  (diagnostic.startsWith('WARNING ') ? warnings : errors).push(diagnostic);
}

function migrationUpdates(
  runtime: Runtime,
  current: Map<string, unknown>,
  metadataJson: string,
): Record<string, unknown> {
  assertNoHighConfidenceSecret([metadataJson], 'Memory migration metadata');
  let supplied: unknown;
  try {
    supplied = JSON.parse(metadataJson || '{}');
  } catch {
    throw new Error('Invalid migration metadata JSON');
  }
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new Error('Migration metadata must be a JSON object');
  }
  assertNoHighConfidenceSecretInValue(supplied, 'Memory migration metadata');
  const updates: Record<string, unknown> = {
    'source-of-truth': false,
    'schema-version': 1,
    updated: calendarDate(runtime),
    ...(supplied as Record<string, unknown>),
  };
  if (updates['source-of-truth'] !== false || updates['schema-version'] !== 1) {
    throw new Error('Migration cannot weaken source-of-truth or schema-version boundaries');
  }
  for (const field of ['status', 'schema-version'] as const) {
    const previous = current.get(field);
    if (
      previous !== undefined &&
      updates[field] !== undefined &&
      previous !== updates[field] &&
      !current.has(`legacy-${field}`)
    ) {
      updates[`legacy-${field}`] = previous;
    }
  }
  assertNoHighConfidenceSecretInValue(updates, 'Memory migration metadata');
  return updates;
}

function migrationReport(
  runtime: Runtime,
  root: string,
  source: string,
  metadataJson: string,
  applied: boolean,
): {
  report: MemoryMigrationReport;
  content: string;
  originalState: ReturnType<typeof snapshotMemoryFile>;
  baselineErrors: string[];
} {
  const rootKind = root === runtime.memoryHome ? 'global' : 'project';
  const originalState = snapshotMemoryFile(source);
  const original = originalState.content;
  assertNoHighConfidenceSecret([original], 'Memory migration source');
  let current: Map<string, unknown>;
  try {
    current = parseFrontmatter(original);
  } catch {
    throw new Error('Invalid memory migration source frontmatter');
  }
  const proposedUpdates = migrationUpdates(runtime, current, metadataJson);
  const content = updateFrontmatter(original, proposedUpdates);
  const rootDiagnostics = (contentOverrides = new Map<string, string>()) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const executionIssues: string[] = [];
    try {
      validateMemoryRoot(
        root,
        {
          log: (message) => collectValidationDiagnostic(message, errors, warnings),
          error: (message) => collectValidationDiagnostic(message, errors, warnings),
        },
        { quietSuccess: true, contentOverrides, rootKind },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const expectedValidationFailure =
        errors.length > 0 && /^Memory check failed: \d+ issue\(s\)$/.test(message);
      if (!expectedValidationFailure) {
        executionIssues.push(`Memory validation could not complete: ${message}`);
      }
    }
    return { errors, warnings, executionIssues };
  };
  const baseline = rootDiagnostics();
  const candidate = rootDiagnostics(new Map([[source, content]]));
  const documentErrors: string[] = [];
  const documentWarnings: string[] = [];
  validateMemoryDocument(
    root,
    source,
    content,
    {
      log: (message) => collectValidationDiagnostic(message, documentErrors, documentWarnings),
      error: (message) => collectValidationDiagnostic(message, documentErrors, documentWarnings),
    },
    { rootKind },
  );
  const baselineSet = new Set(baseline.errors);
  const newRootErrors = candidate.errors.filter((issue) => !baselineSet.has(issue));
  const issues = [
    ...new Set([
      ...baseline.executionIssues,
      ...candidate.executionIssues,
      ...documentErrors,
      ...newRootErrors,
      ...candidate.warnings,
      ...documentWarnings,
    ]),
  ];
  return {
    content,
    originalState,
    baselineErrors: baseline.errors,
    report: {
      version: 1,
      mode: applied ? 'applied' : 'proposal-only',
      memory: memoryReference(root, source),
      proposedUpdates,
      ready:
        baseline.executionIssues.length === 0 &&
        candidate.executionIssues.length === 0 &&
        documentErrors.length === 0 &&
        newRootErrors.length === 0,
      issues,
    },
  };
}

export function memoryMigrate(
  runtime: Runtime,
  input: string,
  name: string,
  metadataJson = '{}',
  { apply = false, json = false }: { apply?: boolean; json?: boolean } = {},
  io: Io = console,
): MemoryMigrationReport {
  assertNoHighConfidenceSecret([input, name], 'Memory migration request');
  assertNoHighConfidenceSecret([metadataJson], 'Memory migration metadata');
  if (apply) assertRuntimeCanMutate(runtime);
  const root = resolveMemoryRoot(runtime, input);
  const rootKind = root === runtime.memoryHome ? 'global' : 'project';
  const operation = (): MemoryMigrationReport => {
    const source = memoryDocumentPath(root, name);
    const { report, content, originalState, baselineErrors } = migrationReport(
      runtime,
      root,
      source,
      metadataJson,
      apply,
    );
    if (apply) {
      if (!report.ready) {
        throw new Error(`Memory migration is not ready:\n${report.issues.join('\n')}`);
      }
      applyMigration(root, rootKind, source, content, originalState, baselineErrors);
    }
    if (json) io.log(JSON.stringify(report, null, 2));
    else {
      io.log(`${apply ? 'Applied' : 'Proposed'} memory migration: ${source}`);
      for (const issue of report.issues) io.log(`  ${issue}`);
    }
    return report;
  };
  return apply ? withMemoryLock(root, operation, [], { requireExisting: true }) : operation();
}
