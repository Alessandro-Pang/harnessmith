import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { applyMemoryRepair, diagnoseMemoryRepair } from '../commands/memory-repair.js';
import { canonicalPath } from '../lib/safe-path.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('repair rejects an active memory lock and reclaims only the exact stale lock through typed acquisition', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'harness-memory-repair-lock-'));
  onTestFinished(() => rmSync(fixture, { recursive: true, force: true }));
  const project = join(fixture, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(fixture);
  initProject(runtime, project, capturedIo());
  const memoryRoot = canonicalPath(join(project, '.agent-docs'));
  rmSync(join(memoryRoot, 'README.md'));
  const proposal = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'initialize-missing-memory',
  );
  assert.ok(proposal);

  const release = lockfile.lockSync(memoryRoot, { realpath: false, retries: 0 });
  try {
    assert.throws(
      () => applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo()),
      /being updated by another process/i,
    );
  } finally {
    release();
  }

  const staleLock = `${memoryRoot}.lock`;
  mkdirSync(staleLock);
  const old = new Date(Date.now() - 20 * 60_000);
  utimesSync(staleLock, old, old);
  const result = applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo());

  assert.equal(result.verification.status, 'passed');
  assert.equal(existsSync(staleLock), false);
});

test('repair bounds journal discovery and leaves oversized unknown state untouched', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'harness-memory-repair-journal-budget-'));
  onTestFinished(() => rmSync(fixture, { recursive: true, force: true }));
  const project = join(fixture, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(fixture);
  initProject(runtime, project, capturedIo());
  const journalRoot = join(runtime.installedHarness, 'state', 'repair');
  mkdirSync(journalRoot, { recursive: true });
  for (let index = 0; index < 257; index += 1) {
    writeFileSync(join(journalRoot, `${index.toString(16).padStart(64, '0')}.backup`), 'unknown\n');
  }

  const report = diagnoseMemoryRepair(runtime, project, capturedIo());

  assert.ok(
    report.unresolved.some(
      ({ reasonCode }) => reasonCode === 'REPAIR_JOURNAL_ENTRY_BUDGET_EXCEEDED',
    ),
  );
  assert.equal(existsSync(join(journalRoot, `${'0'.repeat(64)}.backup`)), true);
});
