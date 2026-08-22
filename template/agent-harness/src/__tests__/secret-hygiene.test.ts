import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { containsHighConfidenceSecret, secretTextFiles } from '../lib/secret-hygiene.js';

test.each([
  '-----BEGIN ENCRYPTED PRIVATE KEY-----',
  '-----BEGIN DSA PRIVATE KEY-----',
  '-----BEGIN PGP PRIVATE KEY BLOCK-----',
])('secret hygiene recognizes private-key envelope %s', (value) => {
  assert.equal(containsHighConfidenceSecret(value), true);
});

test('secret file scanning fails closed before reading an oversized file', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-secret-budget-'));
  onTestFinished(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(join(root, 'large.txt'), 'x'.repeat(33));

  assert.throws(
    () => secretTextFiles(root, new Set(), { maxFileBytes: 32 }),
    /secret scan file byte budget exceeded/i,
  );
});
