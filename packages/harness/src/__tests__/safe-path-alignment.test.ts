import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { canonicalPath as cliCanonicalPath } from '../../../cli/src/shared/safe-path.js';
import { assertSafePath, canonicalPath, isPathInside } from '../lib/filesystem/safe-path.js';

test('canonicalPath walks past a dangling symlink the same way as the CLI copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-safe-path-dangling-'));
  const missing = join(root, 'missing-target');
  const dangling = join(root, 'dangling');
  symlinkSync(missing, dangling);

  assert.equal(canonicalPath(dangling), cliCanonicalPath(dangling));
  assert.equal(canonicalPath(join(dangling, 'child')), cliCanonicalPath(join(dangling, 'child')));
});

test('assertSafePath rejects a symlink leaf and still contains ordinary children', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-safe-path-leaf-'));
  const child = join(root, 'child');
  mkdirSync(child);
  const link = join(root, 'link');
  symlinkSync(child, link);

  assert.equal(isPathInside(root, child), true);
  assert.doesNotThrow(() => assertSafePath(root, child));
  assert.throws(() => assertSafePath(root, link), /symbolic link/i);
});
