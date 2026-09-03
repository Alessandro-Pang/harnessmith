import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const root = process.cwd();

test('public repair guidance preserves proposal, identity, rollback, and verifier boundaries', () => {
  const runtimeCli = readFileSync(join(root, 'apps/docs/site/reference/runtime-cli.md'), 'utf8');
  const architecture = readFileSync(
    join(root, 'template/agent-harness/docs/core/harness-cli-architecture.md'),
    'utf8',
  );
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const combined = [runtimeCli, architecture, llms].join('\n');

  assert.match(
    combined,
    /diagnose-only.*content-bound proposal.*explicit apply.*independent verifier/is,
  );
  assert.match(combined, /authority.*精确.*路径.*backup.*risk.*verifier/is);
  assert.match(combined, /--proposal.*--yes/is);
  assert.match(combined, /unknown files.*ownerless.*inconclusive/is);
  assert.match(combined, /active locks?.*stale locks?.*typed lock/is);
  assert.match(
    combined,
    /partial initialization.*core.*derived.*orphan marker.*transaction restore/is,
  );
  assert.doesNotMatch(combined, /generic clean command is permitted/i);
});
