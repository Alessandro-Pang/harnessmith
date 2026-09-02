import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import { isPathInside } from '../lib/filesystem/safe-path.js';

test('path containment distinguishes siblings from in-root dot-prefixed names', () => {
  const root = resolve('containment-root');

  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, join(root, '..guide.md')), true);
  assert.equal(isPathInside(root, resolve(root, '..', 'containment-root-sibling')), false);
});
