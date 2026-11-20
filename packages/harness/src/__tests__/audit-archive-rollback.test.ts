import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { saveAuditIndex } from '../lib/audit/audit-accounting.js';
import { appendAuditEvent, archiveAuditEvents } from '../lib/audit/audit-store.js';
import { harnessRuntime } from './helpers/harness.js';

type Runtime = Parameters<typeof archiveAuditEvents>[0];
type ArchiveResult = ReturnType<typeof archiveAuditEvents>;
type ArchiveOperations = { rename: typeof renameSync; saveIndex: typeof saveAuditIndex };
type ArchiveWithOperations = (
  runtime: Runtime,
  before: string,
  apply: boolean,
  operations: ArchiveOperations,
) => ArchiveResult;

const archiveWithOperations = archiveAuditEvents as unknown as ArchiveWithOperations;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-audit-archive-rollback-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  for (const [traceId, timestamp] of [
    ['trace-old-1', '2026-01-01T00:00:00.000Z'],
    ['trace-old-2', '2026-01-02T00:00:00.000Z'],
    ['trace-current', '2026-08-28T00:00:00.000Z'],
  ] as const) {
    appendAuditEvent(runtime, {
      schemaVersion: 1,
      traceId,
      timestamp,
      adapter: 'test',
      operation: 'tool',
      action: 'filesystem.read',
      policyDecision: 'allowed',
      policyVersion: 'host-policy-v1',
      durationMs: 1,
      outcome: 'completed',
      artifactDigests: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  }
  const auditRoot = join(runtime.stateRoot, 'audit');
  return {
    runtime,
    auditRoot,
    first: join(auditRoot, '2026-01-01.jsonl'),
    second: join(auditRoot, '2026-01-02.jsonl'),
    current: join(auditRoot, '2026-08-28.jsonl'),
    index: join(auditRoot, '.index.json'),
  };
}

function operations(overrides: Partial<ArchiveOperations> = {}): ArchiveOperations {
  return { rename: renameSync, saveIndex: saveAuditIndex, ...overrides };
}

test('audit archive rolls back earlier renames when a later rename fails', () => {
  const { runtime, auditRoot, first, second, current, index } = fixture();
  const before = new Map(
    [first, second, current, index].map((path) => [path, readFileSync(path, 'utf8')]),
  );

  assert.throws(
    () =>
      archiveWithOperations(
        runtime,
        '2026-02-01',
        true,
        operations({
          rename(source, destination) {
            if (destination === join(auditRoot, 'archive', '2026-01-02.jsonl')) {
              throw new Error('injected archive rename failure');
            }
            renameSync(source, destination);
          },
        }),
      ),
    /injected archive rename failure/,
  );

  for (const [path, content] of before) assert.equal(readFileSync(path, 'utf8'), content);
  assert.equal(existsSync(join(auditRoot, 'archive', '2026-01-01.jsonl')), false);
  assert.equal(existsSync(join(auditRoot, 'archive', '2026-01-02.jsonl')), false);
});

test('audit archive rolls back every moved file in reverse order when index saving fails', () => {
  const { runtime, auditRoot, first, second, current, index } = fixture();
  const before = new Map(
    [first, second, current, index].map((path) => [path, readFileSync(path, 'utf8')]),
  );
  const renames: string[] = [];

  assert.throws(
    () =>
      archiveWithOperations(
        runtime,
        '2026-02-01',
        true,
        operations({
          rename(source, destination) {
            renames.push(`${source}->${destination}`);
            renameSync(source, destination);
          },
          saveIndex() {
            throw new Error('injected audit index failure');
          },
        }),
      ),
    /injected audit index failure/,
  );

  for (const [path, content] of before) assert.equal(readFileSync(path, 'utf8'), content);
  assert.deepEqual(renames, [
    `${first}->${join(auditRoot, 'archive', '2026-01-01.jsonl')}`,
    `${second}->${join(auditRoot, 'archive', '2026-01-02.jsonl')}`,
    `${join(auditRoot, 'archive', '2026-01-02.jsonl')}->${second}`,
    `${join(auditRoot, 'archive', '2026-01-01.jsonl')}->${first}`,
  ]);
});

test('audit archive reports moved, remaining, and recovery paths when rollback also fails', () => {
  const { runtime, auditRoot, first, second } = fixture();
  const archivedFirst = join(auditRoot, 'archive', '2026-01-01.jsonl');
  const originalFirst = readFileSync(first, 'utf8');
  let caught: unknown;

  try {
    archiveWithOperations(
      runtime,
      '2026-02-01',
      true,
      operations({
        rename(source, destination) {
          if (destination === join(auditRoot, 'archive', '2026-01-02.jsonl')) {
            throw new Error('injected archive rename failure');
          }
          if (source === archivedFirst && destination === first) {
            throw new Error('injected archive rollback failure');
          }
          renameSync(source, destination);
        },
      }),
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /rollback was incomplete/i);
  const failure = caught as Error & {
    moved?: string[];
    remaining?: string[];
    recoveryPaths?: string[];
  };
  assert.deepEqual(failure.moved, [archivedFirst]);
  assert.ok(failure.remaining?.includes(first));
  assert.ok(failure.remaining?.includes(second));
  assert.deepEqual(failure.recoveryPaths, [archivedFirst]);
  assert.equal(existsSync(first), false);
  assert.equal(readFileSync(archivedFirst, 'utf8'), originalFirst);
  assert.equal(existsSync(second), true);
});
