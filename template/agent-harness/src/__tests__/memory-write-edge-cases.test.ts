import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal } from '../commands/init.js';
import {
  cleanupTrackedDirectories,
  snapshotDirectoryIdentity,
  writeValidated,
} from '../lib/memory-write.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('directory snapshots reject a regular file', () => {
  const root = temporaryRoot('harness-memory-directory-snapshot-');
  const file = join(root, 'file.txt');
  writeFileSync(file, 'not a directory\n');

  assert.throws(() => snapshotDirectoryIdentity(file), /regular non-symlink directory/i);
});

test('tracked directory cleanup reports an uninspectable recovery path', () => {
  const root = temporaryRoot('harness-memory-directory-inspection-');
  const file = join(root, 'file.txt');
  writeFileSync(file, 'parent is a file\n');

  const errors = cleanupTrackedDirectories(
    [{ path: join(file, 'child'), dev: 1, ino: 1, birthtimeMs: 0 }],
    'created memory',
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0], /directory identity check failed.*recovery path/i);
});

test('duplicate validated write targets roll back once to their shared snapshot', () => {
  const root = temporaryRoot('harness-memory-duplicate-write-');
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const original = readFileSync(profile, 'utf8');

  assert.throws(
    () =>
      writeValidated(
        runtime.memoryHome,
        [
          { path: profile, content: `${original}\nfirst candidate\n` },
          { path: profile, content: `${original}\nsecond candidate\n` },
        ],
        capturedIo(),
        { rootKind: 'global' },
      ),
    /target changed after snapshot/i,
  );
  assert.equal(readFileSync(profile, 'utf8'), original);
});
