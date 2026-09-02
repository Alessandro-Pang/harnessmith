import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, onTestFinished, test, vi } from 'vitest';

const lockControl = vi.hoisted(() => ({
  outside: '',
  root: '',
  throwOnAcquire: false,
  throwOnRelease: false,
}));

vi.mock('proper-lockfile', () => ({
  default: {
    lockSync() {
      if (lockControl.throwOnAcquire) throw new Error('injected acquisition failure');
      if (lockControl.root) {
        rmSync(lockControl.root, { recursive: true });
        symlinkSync(lockControl.outside, lockControl.root, 'dir');
      }
      return () => {
        if (lockControl.throwOnRelease) throw new Error('injected release failure');
      };
    },
  },
}));

import { withExclusiveDirectoryLock } from '../lib/filesystem/exclusive-lock.js';

beforeEach(() => {
  lockControl.outside = '';
  lockControl.root = '';
  lockControl.throwOnAcquire = false;
  lockControl.throwOnRelease = false;
});

test('exclusive lock rejects a root replaced by a symlink before callback entry', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-exclusive-lock-swap-'));
  onTestFinished(() => rmSync(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'memory');
  const outside = join(sandbox, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  lockControl.root = root;
  lockControl.outside = outside;
  let entered = false;

  assert.throws(
    () =>
      withExclusiveDirectoryLock(root, 'Memory', () => {
        entered = true;
      }),
    /root changed while acquiring its lock/i,
  );
  assert.equal(entered, false);
  assert.deepEqual(readdirSync(outside), []);
});

test('exclusive lock rejects an already symlinked directory root', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-exclusive-lock-symlink-'));
  onTestFinished(() => rmSync(sandbox, { recursive: true, force: true }));
  const outside = join(sandbox, 'outside');
  const root = join(sandbox, 'memory');
  mkdirSync(outside);
  symlinkSync(outside, root, 'dir');

  assert.throws(
    () => withExclusiveDirectoryLock(root, 'Memory', () => {}),
    /regular non-symlink directory/i,
  );
});

test('exclusive lock removes only the empty root it created when acquisition fails', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-exclusive-lock-acquire-'));
  onTestFinished(() => rmSync(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'memory');
  lockControl.throwOnAcquire = true;

  assert.throws(
    () => withExclusiveDirectoryLock(root, 'Memory', () => {}),
    /being updated by another process/i,
  );
  assert.equal(existsSync(root), false);
});

test('exclusive lock surfaces a release failure after a successful operation', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-exclusive-lock-release-'));
  onTestFinished(() => rmSync(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'memory');
  mkdirSync(root);
  lockControl.throwOnRelease = true;

  assert.throws(
    () => withExclusiveDirectoryLock(root, 'Memory', () => 'completed'),
    /injected release failure/i,
  );
});

test('exclusive lock reports an operation failure together with incomplete root cleanup', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-exclusive-lock-cleanup-'));
  onTestFinished(() => rmSync(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'memory');

  assert.throws(
    () =>
      withExclusiveDirectoryLock(
        root,
        'Memory',
        () => {
          writeFileSync(join(root, 'retained.txt'), 'retained\n');
          throw new Error('injected operation failure');
        },
        { cleanupEmptyRootOnFailure: true },
      ),
    /operation failed and cleanup was incomplete.*root cleanup/i,
  );
  assert.equal(existsSync(join(root, 'retained.txt')), true);
});
