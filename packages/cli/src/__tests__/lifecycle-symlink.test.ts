import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters/adapters.js';
import { installAll } from '../installation/install.js';
import { restoreAll, uninstallAll } from '../installation/lifecycle.js';

/**
 * Rendered instruction files are regular-file outputs: a symlink at such a destination
 * is never followed, replaced, or snapshotted away. Lifecycle commands fail closed on
 * it (even with --force) and leave every byte untouched. Transaction-level symlink and
 * directory refusal is covered by lifecycle-transaction.test.ts.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lifecycle-symlink-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'personal'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'lifecycle-symlink-test',
  };
  return { env };
}

test('install refuses a dangling symlink at a rendered file destination even with force', () => {
  const { env } = fixture();
  const adapter = createAdapter('codex', { env });
  const rules = join(adapter.home, 'AGENTS.md');
  mkdirSync(adapter.home, { recursive: true });
  symlinkSync('missing-entry', rules);

  assert.throws(
    () => installAll([adapter], { env, force: true, noInitGlobal: true }),
    /symbolic link/i,
  );

  assert.equal(lstatSync(rules).isSymbolicLink(), true);
  assert.equal(readlinkSync(rules), 'missing-entry');
  assert.equal(existsSync(adapter.record), false);
});

for (const command of ['restore', 'uninstall'] as const) {
  test(`${command} refuses to follow a symlink that replaced a managed file`, () => {
    const { env } = fixture();
    const adapter = createAdapter('codex', { env });
    const rules = join(adapter.home, 'AGENTS.md');
    installAll([adapter], { env, noInitGlobal: true });
    const recordBefore = readFileSync(adapter.record, 'utf8');
    rmSync(rules);
    symlinkSync('missing-entry', rules);

    assert.throws(
      () =>
        command === 'restore'
          ? restoreAll([adapter], { force: true })
          : uninstallAll([adapter], { force: true }),
      /symbolic link/i,
    );

    assert.equal(lstatSync(rules).isSymbolicLink(), true);
    assert.equal(readlinkSync(rules), 'missing-entry');
    assert.equal(readFileSync(adapter.record, 'utf8'), recordBefore);
  });
}
