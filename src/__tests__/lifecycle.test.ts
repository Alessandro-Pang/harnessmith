import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';
import { installAll } from '../install.js';
import { restoreAll, statusAll, uninstallAll } from '../lifecycle.js';
import { describeLifecycle } from '../lifecycle-plan.js';

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

test('direct lifecycle API restores one layer and fully uninstalls the previous layer', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env });
  installAll([adapter], { env });
  assert.equal(
    statusAll([adapter])[0].outputs.every(({ status }) => status === 'managed'),
    true,
  );

  const restored = restoreAll([adapter]);
  assert.equal(restored[0].adapter, 'codex');
  assert.ok(existsSync(adapter.record));
  const uninstalled = uninstallAll([adapter]);
  assert.equal(uninstalled[0].layers, 1);
  assert.equal(existsSync(adapter.record), false);
  assert.equal(existsSync(adapter.harness), false);
});

test('direct multi-Adapter lifecycle preflight leaves every installation untouched', () => {
  const { env } = fixture();
  const codex = createAdapter('codex', { env });
  const claude = createAdapter('claude', { env });
  installAll([codex, claude], { env });
  const claudeRules = claude.instructions.at(-1)?.path;
  assert.ok(claudeRules);
  writeFileSync(claudeRules, `${readFileSync(claudeRules, 'utf8')}\nuser edit\n`);

  assert.throws(() => uninstallAll([codex, claude]), /modified/);
  assert.ok(existsSync(codex.record));
  assert.ok(existsSync(claude.record));
  assert.ok(existsSync(codex.harness));
  assert.ok(existsSync(claude.harness));
});

test('multi-Adapter lifecycle transaction rolls back an earlier Adapter after a later runtime failure', () => {
  const { root, env } = fixture();
  const codex = createAdapter('codex', { env });
  const cursor = createAdapter('cursor', { env, project: root });
  installAll([codex, cursor], { env });
  const codexRecordBefore = readFileSync(codex.record, 'utf8');
  const codexRules = codex.instructions[0].path;
  const codexRulesBefore = readFileSync(codexRules, 'utf8');
  const cursorIgnore = cursor.localIgnoreFiles?.at(-1)?.path;
  assert.ok(cursorIgnore);
  rmSync(cursorIgnore);
  mkdirSync(cursorIgnore);

  assert.throws(() => uninstallAll([codex, cursor]));

  assert.equal(readFileSync(codex.record, 'utf8'), codexRecordBefore);
  assert.equal(readFileSync(codexRules, 'utf8'), codexRulesBefore);
  assert.ok(existsSync(cursor.record));
  assert.ok(existsSync(cursor.harness));
  assert.deepEqual(
    readdirSync(cursor.home).filter((name) => name.startsWith('.harnessmith-restore-')),
    [],
  );
});

test('status of an uninstalled Adapter is read-only', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });

  const status = statusAll([adapter]);

  assert.equal(status[0].installed, false);
  assert.equal(existsSync(adapter.home), false);
});

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
