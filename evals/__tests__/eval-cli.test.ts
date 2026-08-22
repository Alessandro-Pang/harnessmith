import assert from 'node:assert/strict';
import { test } from 'vitest';
import { run, temporaryDirectory, writeRun } from './run-fixture.js';

test('evaluation commands accept standard equals-style CLI options', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory);

  const result = run(['validate', `--runs-dir=${runsDirectory}`]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 maintainer-attested host evaluation record structure/);
});

test('evaluation commands reject unknown CLI options', () => {
  const result = run(['validate', '--unknown-option']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option/i);
});
