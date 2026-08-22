import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'vitest';
import { digest, run, temporaryDirectory, writeRun } from './run-fixture.js';

test('validator caps aggregate unique evidence bytes for the full validation call', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));

  for (let index = 0; index < 8; index += 1) {
    const content = Buffer.alloc(8 * 1024 * 1024, index + 1);
    const name = `large-evidence-${index + 1}.txt`;
    writeFileSync(join(dirname(path), name), content);
    record.evidence.push({
      id: `large-evidence-${index + 1}`,
      kind: 'file',
      artifactRef: `local:${name}`,
      sha256: digest(content),
      description: 'Aggregate evidence budget fixture.',
    });
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /aggregate evidence exceeds the 67108864-byte validation limit/);
});
