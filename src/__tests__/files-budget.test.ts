import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { digestPath } from '../shared/files.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-digest-budget-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('outer lifecycle digest fails closed at aggregate entry and file-byte budgets', () => {
  const root = fixture();
  writeFileSync(join(root, 'first.txt'), 'first');
  writeFileSync(join(root, 'second.txt'), 'second');

  assert.throws(() => digestPath(root, { maxEntries: 2 }), /entry budget exceeded/);
  assert.throws(() => digestPath(root, { maxFileBytes: 4 }), /file byte budget exceeded/);
});

test('outer lifecycle digest bounds directory depth without changing stable hashes', () => {
  const root = fixture();
  const nested = join(root, 'a', 'b');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'value.txt'), 'stable');

  assert.throws(() => digestPath(root, { maxDepth: 1 }), /depth budget exceeded/);
  assert.equal(digestPath(root), digestPath(root));
});
