import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { elementAt } from '../../../../packages/harness/src/__tests__/helpers/harness.js';
import { createAdapter } from '../adapters/adapters.js';
import { installAll } from '../installation/install.js';
import { restoreAll, uninstallAll } from '../installation/lifecycle.js';
import { describeLifecycle } from '../installation/lifecycle-plan.js';
import { readInstallRecord } from '../installation/records.js';

/**
 * Single-current-layer lifecycle coverage. Shared dry-run → uninstall / conflict /
 * multi-adapter conformance lives in adapter-conformance.test.ts.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lifecycle-unit-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'personal'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'lifecycle-test',
  };
  return { root, env };
}

function rulesPath(adapter: ReturnType<typeof createAdapter>): string {
  return elementAt(adapter.instructions, 0).path;
}

for (const command of ['restore', 'uninstall'] as const) {
  test(`${command} preview is a flat single-layer plan without hub or layers`, () => {
    const { env } = fixture();
    const adapter = createAdapter('codex', { env });
    installAll([adapter], { env, noInitGlobal: true });

    const plan = describeLifecycle(command, adapter, false);

    assert.deepEqual(Object.keys(plan).sort(), ['adapter', 'changes', 'command', 'force', 'home']);
    assert.equal(plan.command, command);
    assert.equal(plan.adapter, 'codex');
    assert.equal(plan.force, false);
    assert.equal(plan.home, adapter.home);
    assert.ok(plan.changes.some(({ path }) => path === rulesPath(adapter)));
    assert.ok(plan.changes.some(({ path }) => path === adapter.record));
    assert.ok(
      plan.changes.every(({ action }) =>
        ['remove', 'restore-backup', 'remove-managed-block'].includes(action),
      ),
    );
  });
}

test('restore preflight rejects a missing recordBackup before mutation', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env, noInitGlobal: true });
  installAll([adapter], { env, noInitGlobal: true });
  const recordBefore = readFileSync(adapter.record, 'utf8');
  const record = JSON.parse(recordBefore) as { recordBackup: string };
  assert.ok(record.recordBackup);
  rmSync(record.recordBackup);

  assert.throws(() => describeLifecycle('restore', adapter, false), /backup files are missing/i);
  assert.throws(() => restoreAll([adapter]), /backup files are missing/i);
  assert.equal(readFileSync(adapter.record, 'utf8'), recordBefore);
  assert.ok(existsSync(rulesPath(adapter)));
});

test('uninstall preflight rejects a missing output backup before mutation', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  mkdirSync(adapter.home, { recursive: true });
  writeFileSync(rulesPath(adapter), 'original rules\n');
  installAll([adapter], { env, force: true, noInitGlobal: true });
  const record = readInstallRecord(adapter);
  const backup = elementAt(record?.outputs ?? [], 0).backup;
  assert.ok(backup);
  rmSync(backup);
  const recordBefore = readFileSync(adapter.record, 'utf8');

  assert.throws(() => describeLifecycle('uninstall', adapter, false), /backup files are missing/i);
  assert.throws(() => uninstallAll([adapter]), /backup files are missing/i);
  assert.equal(readFileSync(adapter.record, 'utf8'), recordBefore);
  assert.ok(existsSync(rulesPath(adapter)));
});

test('restore unwinds exactly one layer per call and never chains', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  mkdirSync(adapter.home, { recursive: true });
  writeFileSync(rulesPath(adapter), 'original rules\n');
  installAll([adapter], { env, force: true, noInitGlobal: true });
  writeFileSync(rulesPath(adapter), 'user edited rules\n');
  installAll([adapter], { env, force: true, noInitGlobal: true });

  restoreAll([adapter]);
  const restored = readInstallRecord(adapter);
  assert.ok(restored, 'the previous record becomes the active record');
  assert.equal(restored?.recordBackup, null);
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), 'user edited rules\n');

  // The re-activated older record describes its own rendered content, so the restored
  // user edit reads as modified: unwinding the next layer stays fail-closed without force.
  assert.throws(() => restoreAll([adapter]), /Managed files were modified/i);
  restoreAll([adapter], { force: true });
  assert.equal(readInstallRecord(adapter), null);
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), 'original rules\n');
});

test('uninstall removes only the current installation without reading older records', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  mkdirSync(adapter.home, { recursive: true });
  writeFileSync(rulesPath(adapter), 'original rules\n');
  installAll([adapter], { env, force: true, noInitGlobal: true });
  writeFileSync(rulesPath(adapter), 'user edited rules\n');
  installAll([adapter], { env, force: true, noInitGlobal: true });
  const record = readInstallRecord(adapter);
  assert.ok(record?.recordBackup);

  const results = uninstallAll([adapter]);

  assert.equal(elementAt(results, 0).adapter, 'codex');
  assert.equal(readInstallRecord(adapter), null);
  assert.equal(
    existsSync(record?.recordBackup ?? ''),
    false,
    'the recordBackup file is removed, not restored',
  );
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), 'user edited rules\n');
});

test('modified managed files fail closed without force and are replaced with force', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  mkdirSync(adapter.home, { recursive: true });
  writeFileSync(rulesPath(adapter), 'original rules\n');
  installAll([adapter], { env, force: true, noInitGlobal: true });
  writeFileSync(rulesPath(adapter), 'user-modified rules\n');

  assert.throws(() => restoreAll([adapter]), /Managed files were modified/i);
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), 'user-modified rules\n');

  restoreAll([adapter], { force: true });
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), 'original rules\n');
  assert.equal(readInstallRecord(adapter), null);
});

test('multi-adapter preflight rejects before any adapter is mutated', () => {
  const { env } = fixture();
  const codex = createAdapter('codex', { env });
  const claude = createAdapter('claude', { env });
  installAll([codex, claude], { env, noInitGlobal: true });
  const codexRecordBefore = readFileSync(codex.record, 'utf8');
  const codexRulesBefore = readFileSync(rulesPath(codex), 'utf8');
  writeFileSync(rulesPath(claude), 'user-modified rules\n');

  assert.throws(() => restoreAll([codex, claude]), /Managed files were modified/i);
  assert.equal(readFileSync(codex.record, 'utf8'), codexRecordBefore);
  assert.equal(readFileSync(rulesPath(codex), 'utf8'), codexRulesBefore);
  assert.ok(readInstallRecord(claude), 'the rejected adapter keeps its record too');
});

test('install → install → restore keeps identical managed outputs and reactivates the direct record', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env, noInitGlobal: true });
  const firstRecord = readFileSync(adapter.record, 'utf8');
  const rulesBefore = readFileSync(rulesPath(adapter), 'utf8');
  installAll([adapter], { env, noInitGlobal: true });
  const second = readInstallRecord(adapter);
  assert.ok(second?.recordBackup, 'the repeated install keeps the direct previous record');
  assert.equal(
    elementAt(second?.outputs ?? [], 0).backup,
    null,
    'identical managed content is not rewritten and keeps no output backup',
  );

  const plan = describeLifecycle('restore', adapter, false);
  assert.ok(
    plan.changes.some(({ path, action }) => path === rulesPath(adapter) && action === 'keep'),
    'the preview promises to keep the still-matching managed output',
  );

  restoreAll([adapter]);

  assert.ok(existsSync(rulesPath(adapter)), 'the instruction file survives restore');
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), rulesBefore);
  assert.equal(
    readFileSync(adapter.record, 'utf8'),
    firstRecord,
    'the direct record is active again',
  );
  const restored = readInstallRecord(adapter);
  assert.ok(restored, 'the reactivated record stays valid schema 3');
  assert.equal(restored?.recordBackup, null);

  // Single-layer semantics: the next restore unwinds only the reactivated record.
  restoreAll([adapter]);
  assert.equal(readInstallRecord(adapter), null);
  assert.equal(existsSync(rulesPath(adapter)), false);
});

test('restore with force removes modified managed content instead of keeping it', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env, noInitGlobal: true });
  installAll([adapter], { env, noInitGlobal: true });
  writeFileSync(rulesPath(adapter), 'user-modified rules\n');

  assert.throws(() => restoreAll([adapter]), /Managed files were modified/i);
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), 'user-modified rules\n');

  restoreAll([adapter], { force: true });
  assert.equal(
    existsSync(rulesPath(adapter)),
    false,
    'modified content without a backup is removed, not inherited by the previous record',
  );
  const restored = readInstallRecord(adapter);
  assert.ok(restored, 'the direct previous record is still reactivated');
  assert.equal(restored?.recordBackup, null);
});

test('restore rejects a damaged recordBackup before changing any output or record', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env, noInitGlobal: true });
  installAll([adapter], { env, noInitGlobal: true });
  const recordBefore = readFileSync(adapter.record, 'utf8');
  const rulesBefore = readFileSync(rulesPath(adapter), 'utf8');
  const { recordBackup } = JSON.parse(recordBefore) as { recordBackup: string };
  assert.ok(recordBackup);
  writeFileSync(recordBackup, '{ damaged json');

  assert.throws(() => describeLifecycle('restore', adapter, false), /Invalid installation record/i);
  assert.throws(() => restoreAll([adapter]), /Invalid installation record/i);
  assert.equal(readFileSync(adapter.record, 'utf8'), recordBefore);
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), rulesBefore);
  assert.equal(readFileSync(recordBackup, 'utf8'), '{ damaged json');
});

test('restore rejects old-schema or foreign recordBackups without unwinding anything', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env, noInitGlobal: true });
  const firstRecord = readFileSync(adapter.record, 'utf8');
  installAll([adapter], { env, noInitGlobal: true });
  const recordBefore = readFileSync(adapter.record, 'utf8');
  const rulesBefore = readFileSync(rulesPath(adapter), 'utf8');
  const { recordBackup } = JSON.parse(recordBefore) as { recordBackup: string };
  assert.ok(recordBackup);
  const previous = JSON.parse(firstRecord) as Record<string, unknown>;

  writeFileSync(recordBackup, JSON.stringify({ ...previous, schemaVersion: 2 }));
  assert.throws(() => restoreAll([adapter]), /unsupported schema/i);
  assert.equal(readFileSync(adapter.record, 'utf8'), recordBefore);
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), rulesBefore);

  writeFileSync(recordBackup, JSON.stringify({ ...previous, adapter: 'claude' }));
  assert.throws(() => restoreAll([adapter]), /another adapter/i);
  assert.equal(readFileSync(adapter.record, 'utf8'), recordBefore);
  assert.equal(readFileSync(rulesPath(adapter), 'utf8'), rulesBefore);
  assert.ok(existsSync(recordBackup), 'the rejected backup file itself is left in place');
});

test('a non-file backup aborts the transaction snapshot before any mutation', () => {
  const { env } = fixture();
  const codex = createAdapter('codex', { env });
  const claude = createAdapter('claude', { env });
  mkdirSync(claude.home, { recursive: true });
  writeFileSync(rulesPath(claude), 'original claude rules\n');
  installAll([codex, claude], { env, force: true, noInitGlobal: true });
  const claudeRecord = readInstallRecord(claude);
  const backup = elementAt(claudeRecord?.outputs ?? [], 0).backup;
  assert.ok(backup);
  rmSync(backup);
  mkdirSync(backup);
  const codexRecordBefore = readFileSync(codex.record, 'utf8');
  const codexRulesBefore = readFileSync(rulesPath(codex), 'utf8');

  assert.throws(() => restoreAll([codex, claude]), /Unsupported lifecycle snapshot entry/i);
  assert.equal(readFileSync(codex.record, 'utf8'), codexRecordBefore);
  assert.equal(readFileSync(rulesPath(codex), 'utf8'), codexRulesBefore);
  assert.ok(readInstallRecord(claude));
});
