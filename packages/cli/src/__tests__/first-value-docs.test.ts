import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

test('setup, status, and journey apps/docs/site use the same First Value states and next step', () => {
  const sources = [
    'apps/docs/site/guide/first-value-loop.md',
    'apps/docs/site/guide/getting-started.md',
    'apps/docs/site/reference/cli.md',
    'llms.txt',
  ].map((path) => readFileSync(join(root, path), 'utf8'));

  for (const source of sources) {
    for (const state of ['installed', 'healthy', 'host-configured', 'host-verified']) {
      assert.match(source, new RegExp(state));
    }
    assert.match(source, /diagnostics --agent <agent> --json/);
  }
});

test('public journey rejects download, traffic, and local-test activity claims', () => {
  const journey = readFileSync(
    join(root, 'apps', 'docs', 'site', 'guide', 'first-value-loop.md'),
    'utf8',
  );
  assert.match(journey, /npm downloads/);
  assert.match(journey, /GitHub traffic/);
  assert.match(journey, /local-baseline-passed/);
  assert.match(journey, /firstValueAchieved.*false/);
});
