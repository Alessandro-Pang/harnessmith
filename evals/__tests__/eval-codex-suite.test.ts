import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const root = process.cwd();

test('Codex evaluation exposes one public suite entrypoint', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  assert.equal(
    scripts['eval:codex'],
    'node --import tsx scripts/evaluation/codex/eval-codex-suite.ts',
  );
  assert.equal(scripts['eval:codex-memory'], undefined);
  assert.equal(scripts['eval:memory:report'], undefined);
  assert.equal(scripts['eval:memory:gate'], undefined);
});

test('obsolete independent matrix entrypoints are removed', () => {
  for (const path of ['eval-codex-matrix.ts', 'eval-codex-memory.ts']) {
    assert.equal(existsSync(join(root, 'scripts/evaluation/codex', path)), false);
  }
});
