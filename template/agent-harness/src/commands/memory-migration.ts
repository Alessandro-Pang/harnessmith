import { readFileSync } from 'node:fs';
import { atomicWrite } from '../lib/files.js';
import { parseFrontmatter, updateFrontmatter } from '../lib/frontmatter.js';
import { withMemoryLock } from '../lib/memory-lock.js';
import { memoryDocumentPath, memoryReference, resolveMemoryRoot } from '../lib/memory-path.js';
import { validateMemoryDocument, validateMemoryRoot } from '../lib/memory-validation.js';
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

function migrationUpdates(
  runtime: Runtime,
  current: Map<string, unknown>,
  metadataJson: string,
): Record<string, unknown> {
  let supplied: unknown;
  try {
    supplied = JSON.parse(metadataJson || '{}');
  } catch (error) {
    throw new Error(`Invalid migration metadata JSON: ${String(error)}`);
  }
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new Error('Migration metadata must be a JSON object');
  }
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
  original: string;
  baselineErrors: string[];
} {
  const original = readFileSync(source, 'utf8');
  const current = parseFrontmatter(original);
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
          log: (message) => {
            if (String(message).startsWith('WARNING ')) warnings.push(String(message));
          },
          error: (message) => errors.push(String(message)),
        },
        { quietSuccess: true, contentOverrides },
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
  validateMemoryDocument(root, source, content, {
    log: (message) => {
      if (String(message).startsWith('WARNING ')) candidate.warnings.push(String(message));
    },
    error: (message) => documentErrors.push(String(message)),
  });
  const baselineSet = new Set(baseline.errors);
  const newRootErrors = candidate.errors.filter((issue) => !baselineSet.has(issue));
  const issues = [
    ...new Set([
      ...baseline.executionIssues,
      ...candidate.executionIssues,
      ...documentErrors,
      ...newRootErrors,
      ...candidate.warnings,
    ]),
  ];
  return {
    content,
    original,
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
  if (apply) assertRuntimeCanMutate(runtime);
  const root = resolveMemoryRoot(runtime, input);
  const operation = (): MemoryMigrationReport => {
    const source = memoryDocumentPath(root, name);
    const { report, content, original, baselineErrors } = migrationReport(
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
      atomicWrite(source, content);
      const postErrors: string[] = [];
      const postDocumentErrors: string[] = [];
      const postExecutionIssues: string[] = [];
      try {
        validateMemoryRoot(
          root,
          { log: () => {}, error: (message) => postErrors.push(String(message)) },
          { quietSuccess: true },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const expectedValidationFailure =
          postErrors.length > 0 && /^Memory check failed: \d+ issue\(s\)$/.test(message);
        if (!expectedValidationFailure) postExecutionIssues.push(message);
      }
      validateMemoryDocument(root, source, readFileSync(source, 'utf8'), {
        log: () => {},
        error: (message) => postDocumentErrors.push(String(message)),
      });
      const baselineSet = new Set(baselineErrors);
      const newPostErrors = postErrors.filter((issue) => !baselineSet.has(issue));
      if (
        postExecutionIssues.length > 0 ||
        postDocumentErrors.length > 0 ||
        newPostErrors.length > 0
      ) {
        atomicWrite(source, original);
        throw new Error('Memory migration failed post-write validation and was rolled back');
      }
    }
    if (json) io.log(JSON.stringify(report, null, 2));
    else {
      io.log(`${apply ? 'Applied' : 'Proposed'} memory migration: ${source}`);
      for (const issue of report.issues) io.log(`  ${issue}`);
    }
    return report;
  };
  return apply ? withMemoryLock(root, operation) : operation();
}
