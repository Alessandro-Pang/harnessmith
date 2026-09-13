import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { searchText } from '../lib/search/search.js';
import { discoverSearchableFiles } from '../lib/search/search-budget.js';

test('search scan does not follow directory or file symlinks outside the source root', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-search-symlink-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const docs = join(root, 'docs');
  const outside = join(root, 'outside');
  mkdirSync(docs);
  mkdirSync(outside);
  writeFileSync(join(docs, 'inside.md'), 'NEEDLE inside\n');
  writeFileSync(join(outside, 'secret.md'), 'NEEDLE secret\n');
  symlinkSync(outside, join(docs, 'alias-dir'));
  symlinkSync(join(outside, 'secret.md'), join(docs, 'alias-file.md'));

  const sources = [{ root: docs, label: 'docs', trust: 'untrusted' as const }];
  const discovery = discoverSearchableFiles(sources);
  assert.equal(
    discovery.candidates.every((candidate) => candidate.path.startsWith(docs)),
    true,
  );
  assert.ok(discovery.stats.skippedByReason.symlink >= 2);
  const report = searchText('NEEDLE', sources);
  assert.equal(
    report.matches.some((match) => match.text.includes('secret')),
    false,
  );
  assert.ok(report.matches.some((match) => match.text.includes('inside')));
});
