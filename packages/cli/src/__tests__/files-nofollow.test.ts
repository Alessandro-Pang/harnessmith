import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    lstatSync: ((path: Parameters<typeof actual.lstatSync>[0], options?: unknown) => {
      const stat = actual.lstatSync(path, options as never);
      if (String(path).endsWith('trap.txt') && stat.isSymbolicLink()) {
        return Object.assign(stat, {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        });
      }
      return stat;
    }) as typeof actual.lstatSync,
  };
});

const { digestPath } = await import('../shared/files.js');

test('digest file open refuses a symlink that lstat reported as a regular file', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-digest-nofollow-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'secret.txt');
  const trap = join(root, 'trap.txt');
  writeFileSync(target, 'secret');
  symlinkSync(target, trap);

  assert.throws(() => digestPath(trap), /ELOOP|symbolic link|EINVAL|EPERM/i);
});
