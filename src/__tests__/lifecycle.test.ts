import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';
import { installAll } from '../install.js';
import { describeLifecycle } from '../lifecycle-plan.js';

/**
 * Adapter-specific / edge-case lifecycle coverage.
 * Shared dry-run → uninstall / conflict / multi-adapter preflight+rollback lives in
 * adapter-conformance.test.ts and runs for every registry entry.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lifecycle-unit-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'personal'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'lifecycle-test',
  };
  return { root, env };
}

test('lifecycle preflight rejects a missing installation-record backup before mutation', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env });
  installAll([adapter], { env });
  const recordBefore = readFileSync(adapter.record, 'utf8');
  const record = JSON.parse(recordBefore) as { recordBackup: string };
  assert.ok(record.recordBackup);
  rmSync(record.recordBackup);

  for (const command of ['restore', 'uninstall'] as const) {
    assert.throws(() => describeLifecycle(command, adapter), /record backup is missing/i);
    assert.equal(readFileSync(adapter.record, 'utf8'), recordBefore);
    assert.ok(existsSync(adapter.harness));
  }
});
