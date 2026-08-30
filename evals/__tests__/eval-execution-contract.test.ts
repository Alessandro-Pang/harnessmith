import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { run, temporaryDirectory, writeRun } from './run-fixture.js';

test('validator rejects more than one automatic retry', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.execution.attempt = 3;
  record.execution.maxAttempts = 3;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /run schema.*maxAttempts|run schema.*attempt/i);
});

test('validator requires transport failures to remain infra-inconclusive', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory, {
    outcome: 'behavior-failed',
    termination: 'transport-failure',
  });

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /transport-failure.*infra-inconclusive/i);
});

test('validator rejects elapsed time beyond the scenario budget', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.execution.scenarioBudgetMs = 60_000;
  record.execution.elapsedMs = record.execution.scenarioBudgetMs + 1;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /elapsedMs.*scenarioBudgetMs/i);
});
