import assert from 'node:assert/strict';
import { readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { currentFingerprint, root, run, temporaryDirectory, writeRun } from './run-fixture.js';

function writePassingMatrix(runsDirectory: string, evaluatedAt: string): void {
  const scenarioIds = Object.keys(currentFingerprint().scenarios);
  for (const adapter of ['codex', 'cursor', 'claude'] as const) {
    for (const scenarioId of scenarioIds) {
      writeRun(runsDirectory, {
        adapter,
        evaluatedAt,
        finishedAt: new Date(Date.parse(evaluatedAt) - 1_000).toISOString(),
        scenarioId,
      });
    }
  }
}

test('release gate uses the latest evaluated record for each host and scenario cell', () => {
  const runsDirectory = temporaryDirectory();
  const earlier = new Date(Date.now() - 120_000).toISOString();
  const latest = new Date(Date.now() - 60_000).toISOString();
  writePassingMatrix(runsDirectory, earlier);
  writeRun(runsDirectory, {
    adapter: 'codex',
    evaluatedAt: latest,
    finishedAt: new Date(Date.parse(latest) - 1_000).toISOString(),
    outcome: 'failed',
    runId: 'codex-progressive-disclosure-latest',
    scenarioId: 'progressive-disclosure',
  });

  const result = run(['gate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed codex\/progressive-disclosure/);
});

test('release gate rejects a tied latest evaluatedAt for the same matrix cell', () => {
  const runsDirectory = temporaryDirectory();
  const evaluatedAt = new Date(Date.now() - 60_000).toISOString();
  writePassingMatrix(runsDirectory, evaluatedAt);
  writeRun(runsDirectory, {
    adapter: 'codex',
    evaluatedAt,
    finishedAt: new Date(Date.parse(evaluatedAt) - 1_000).toISOString(),
    runId: 'codex-progressive-disclosure-tied',
    scenarioId: 'progressive-disclosure',
  });

  const result = run(['gate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ambiguous latest evaluatedAt.*codex\/progressive-disclosure/i);
});

test.each([
  {
    name: 'future evaluation',
    finishedAt: new Date().toISOString(),
    evaluatedAt: new Date(Date.now() + 60_000).toISOString(),
  },
  {
    name: 'evaluation before completion',
    finishedAt: new Date().toISOString(),
    evaluatedAt: new Date(Date.now() - 60_000).toISOString(),
  },
])('release gate rejects a $name timestamp ordering', ({ finishedAt, evaluatedAt }) => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory, { evaluatedAt, finishedAt });

  const result = run(['gate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale codex\/progressive-disclosure/);
});

test('validator rejects high-confidence credentials in the run record itself', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.notes = 'Authorization: Bearer secret-value-that-was-not-redacted';
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /run\.json failed secret redaction check/);
});

test('validator rejects a non-Bearer high-confidence token in the run record', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.notes = ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /run\.json failed secret redaction check/);
});

test('validator rejects an oversized run record before unbounded parsing', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = readFileSync(path);
  writeFileSync(path, Buffer.concat([record, Buffer.alloc(8 * 1024 * 1024, 32)]));

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /run\.json exceeds the .* record limit/);
});

test('validator reports a run.json symlink as an unsafe record', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const target = join(runsDirectory, 'record-target.json');
  renameSync(path, target);
  symlinkSync(target, path);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe run record.*run\.json/i);
});

test('validator describes accepted inputs as maintainer-attested record structures', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 maintainer-attested host evaluation record structure/);
  assert.doesNotMatch(result.stdout, /real host/i);
});

test('architecture describes structural attestation instead of real-host evidence verification', () => {
  const architecture = readFileSync(join(root, 'docs', 'architecture.md'), 'utf8');

  assert.match(architecture, /maintainer-attested record structure/i);
  assert.doesNotMatch(architecture, /真实宿主证据校验/);
});
