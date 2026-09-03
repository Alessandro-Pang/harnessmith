import assert from 'node:assert/strict';
import { test } from 'vitest';
import { modeMatches } from '../lib/filesystem/portable-mode.js';

test('Windows ignores POSIX permission bits that its filesystem API cannot preserve', () => {
  assert.equal(modeMatches(0o666, 0o600, 'win32'), true);
  assert.equal(modeMatches(0o777, 0o700, 'win32'), true);
});

test('POSIX platforms continue to require exact permission bits', () => {
  assert.equal(modeMatches(0o600, 0o600, 'linux'), true);
  assert.equal(modeMatches(0o666, 0o600, 'linux'), false);
  assert.equal(modeMatches(0o700, 0o700, 'darwin'), true);
  assert.equal(modeMatches(0o755, 0o700, 'darwin'), false);
});
