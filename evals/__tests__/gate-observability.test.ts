import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { run, temporaryDirectory, writeRun } from './run-fixture.js';

function driftedRun(): string {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.subject.rulesSha256 = 'f'.repeat(64);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return runsDirectory;
}

test('release gate emits structured failure attribution for automation', () => {
  const result = run(['gate', '--runs-dir', driftedRun(), '--max-age-days', '30', '--json']);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.version, 1);
  assert.equal(failure.valid, false);
  assert.equal(failure.error.code, 'EVAL_COVERAGE_INCOMPLETE');
  assert.ok(failure.missing.includes('codex/progressive-disclosure'));
  assert.equal(failure.rejected.count, 1);
  assert.deepEqual(failure.rejected.byReason, [{ reason: 'subject-drift:rulesSha256', count: 1 }]);
  assert.deepEqual(failure.rejected.records, [
    'subject-drift rulesSha256 codex/progressive-disclosure',
  ]);
});

test('release gate text output summarizes rejection causes before audit details', () => {
  const result = run(['gate', '--runs-dir', driftedRun()]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Rejected record summary:\n- subject-drift:rulesSha256: 1/);
  assert.match(result.stderr, /Rejected record details:\n- subject-drift rulesSha256/);
});
