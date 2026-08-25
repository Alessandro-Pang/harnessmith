import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initializeGlobalMemory, withGlobalMemoryTransaction } from '../lib/global-memory.js';
import { harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return { root, runtime: harnessRuntime(root) };
}

test('global memory rejects a non-directory root before taking its lock', () => {
  const { runtime } = fixture('harness-global-root-file-');
  writeFileSync(runtime.memoryHome, 'not a directory\n');

  assert.throws(() => initializeGlobalMemory(runtime), /root must be a directory/i);
});

test('global memory rejects a managed entry that is not a regular file', () => {
  const { runtime } = fixture('harness-global-entry-directory-');
  initializeGlobalMemory(runtime);
  const core = join(runtime.memoryHome, 'core.md');
  renameSync(core, `${core}.backup`);
  mkdirSync(core);

  assert.throws(() => initializeGlobalMemory(runtime), /regular non-symlink file/i);
});

test('global rollback restores the original directory mode', () => {
  const { runtime } = fixture('harness-global-mode-restore-');
  initializeGlobalMemory(runtime);
  chmodSync(runtime.memoryHome, 0o755);

  assert.throws(
    () =>
      withGlobalMemoryTransaction(runtime, () => {
        throw new Error('operation failed');
      }),
    /operation failed/i,
  );
  assert.equal(statSync(runtime.memoryHome).mode & 0o777, 0o755);
});

test('global rollback retains a concurrently changed directory mode', () => {
  const { runtime } = fixture('harness-global-mode-conflict-');
  initializeGlobalMemory(runtime);
  chmodSync(runtime.memoryHome, 0o755);

  assert.throws(
    () =>
      withGlobalMemoryTransaction(runtime, () => {
        chmodSync(runtime.memoryHome, 0o750);
        throw new Error('operation failed');
      }),
    /rollback was incomplete.*unknown mode retained/i,
  );
  assert.equal(statSync(runtime.memoryHome).mode & 0o777, 0o750);
});

test('global rollback removes a newly created empty memory root', () => {
  const { runtime } = fixture('harness-global-new-root-cleanup-');

  assert.throws(
    () =>
      withGlobalMemoryTransaction(runtime, () => {
        throw new Error('operation failed');
      }),
    /operation failed/i,
  );
  assert.equal(existsSync(runtime.memoryHome), false);
});

test('global rollback reports an unknown file that prevents new-root cleanup', () => {
  const { runtime } = fixture('harness-global-new-root-residue-');
  const residue = join(runtime.memoryHome, 'foreign.txt');

  assert.throws(
    () =>
      withGlobalMemoryTransaction(runtime, () => {
        writeFileSync(residue, 'concurrent content\n');
        throw new Error('operation failed');
      }),
    /rollback was incomplete.*memory root directory cleanup failed/i,
  );
  assert.equal(existsSync(residue), true);
});

test('global rollback retains a replacement that changes the root kind', () => {
  const { root, runtime } = fixture('harness-global-root-replacement-');
  initializeGlobalMemory(runtime);
  const displaced = join(root, 'displaced-memory');

  assert.throws(
    () =>
      withGlobalMemoryTransaction(runtime, () => {
        renameSync(runtime.memoryHome, displaced);
        writeFileSync(runtime.memoryHome, 'replacement\n');
        throw new Error('operation failed');
      }),
    /rollback was incomplete.*memory root was replaced/i,
  );
  assert.equal(existsSync(runtime.memoryHome), true);
});

test('global rollback does not chmod a same-mode replacement directory', () => {
  const { root, runtime } = fixture('harness-global-root-identity-mode-');
  initializeGlobalMemory(runtime);
  chmodSync(runtime.memoryHome, 0o755);
  const displaced = join(root, 'displaced-memory');

  assert.throws(
    () =>
      withGlobalMemoryTransaction(runtime, () => {
        renameSync(runtime.memoryHome, displaced);
        mkdirSync(runtime.memoryHome, { mode: 0o700 });
        for (const name of ['README.md', 'core.md', 'profile.md']) {
          copyFileSync(join(displaced, name), join(runtime.memoryHome, name));
          chmodSync(join(runtime.memoryHome, name), 0o600);
        }
        throw new Error('operation failed');
      }),
    /rollback was incomplete.*root.*replaced/i,
  );
  assert.equal(statSync(runtime.memoryHome).mode & 0o777, 0o700);
});

test('global rollback does not delete a same-mode replacement for a new root', () => {
  const { root, runtime } = fixture('harness-global-new-root-identity-');
  const displaced = join(root, 'displaced-memory');

  assert.throws(
    () =>
      withGlobalMemoryTransaction(runtime, () => {
        renameSync(runtime.memoryHome, displaced);
        mkdirSync(runtime.memoryHome, { mode: 0o700 });
        throw new Error('operation failed');
      }),
    /rollback was incomplete.*root.*replaced/i,
  );
  assert.equal(existsSync(runtime.memoryHome), true);
  assert.equal(statSync(runtime.memoryHome).mode & 0o777, 0o700);
});
