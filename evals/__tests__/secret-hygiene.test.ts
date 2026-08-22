import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { run, temporaryDirectory, writeRun } from './run-fixture.js';

test('evaluation validation shares private-key envelope detection with the Harness runtime', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.notes = '-----BEGIN ENCRYPTED PRIVATE KEY-----';
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /run\.json failed secret redaction check/);
});
