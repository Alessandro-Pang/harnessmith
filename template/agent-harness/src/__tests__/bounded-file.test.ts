import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readBoundedRegularFile } from '../lib/bounded-file.js';

test('bounded reads reject an invalid byte budget before touching the path', () => {
  assert.throws(
    () => readBoundedRegularFile('/path/need-not-exist', { maxBytes: 0, subject: 'Fixture' }),
    /invalid fixture byte limit: 0/i,
  );
});
