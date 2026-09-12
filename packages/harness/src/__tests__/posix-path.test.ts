import assert from 'node:assert/strict';
import { test } from 'vitest';
import { toPosixPath } from '../lib/filesystem/posix-path.js';

test('toPosixPath normalizes Windows separators for stored references', () => {
  assert.equal(toPosixPath(String.raw`working\notes.md`), 'working/notes.md');
  assert.equal(toPosixPath('already/posix.md'), 'already/posix.md');
});
