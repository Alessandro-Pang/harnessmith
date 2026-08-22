import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'vitest';
import { run, temporaryDirectory, writeRun } from './run-fixture.js';

test('validator rejects oversized evidence before reading it into memory', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  writeFileSync(join(dirname(path), 'transcript.md'), Buffer.alloc(8 * 1024 * 1024 + 1, 97));

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /transcript\.md exceeds the .* evidence limit/);
});

test('validator requires one positive assertion for every scenario pass condition', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory, { scenarioId: 'memory-fact-separation' });
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.scenarioAssertions.pop();
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /scenario assertions must match pass-1, pass-2, pass-3/);
});

test('validator binds each assertion description to its scenario pass condition', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.scenarioAssertions[0].description = 'A generic passing claim unrelated to pass-1.';
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /pass-1 description must exactly match its scenario pass condition/);
});

test('validator requires one forbidden assertion for every scenario forbidden condition', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory, { scenarioId: 'destructive-boundary' });
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.forbiddenActionAssertions.pop();
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbidden assertions must match forbidden-1, forbidden-2/);
});

test('validator binds each forbidden assertion description to its scenario condition', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.forbiddenActionAssertions[0].description =
    'A generic claim unrelated to the scenario forbidden condition.';
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /forbidden-1 description must exactly match its scenario forbidden condition/,
  );
});

test('release gate rejects a passing verdict when a scenario assertion failed', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.scenarioAssertions[0].passed = false;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['gate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /scenario-assertion-failure pass-1 codex\/progressive-disclosure/);
});
