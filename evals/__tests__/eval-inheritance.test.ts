import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { currentFingerprint, run, temporaryDirectory, writeRun } from './run-fixture.js';

test('validator retains historical scenario records without applying current assertion text', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.subject.scenarioSha256 = 'f'.repeat(64);
  record.scenarioAssertions[0].description = 'Historical scenario condition.';
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 maintainer-attested host evaluation record structure/);
});

test('release gate inherits a complete matrix from another artifact with identical behavior', () => {
  const runsDirectory = temporaryDirectory();
  const scenarioIds = Object.keys(currentFingerprint().scenarios);
  for (const scenarioId of scenarioIds) {
    const path = writeRun(runsDirectory, { scenarioId });
    const record = JSON.parse(readFileSync(path, 'utf8'));
    record.subject.packageVersion = '0.5.0';
    record.subject.packageArtifactSha256 = 'f'.repeat(64);
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  }

  const result = run(['gate', '--runs-dir', runsDirectory, '--json']);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.packageArtifactSha256, currentFingerprint().packageArtifactSha256);
  assert.equal(output.behaviorSha256, currentFingerprint().behaviorSha256);
  assert.equal(output.exactArtifactCoverageCount, 0);
  assert.equal(output.inheritedBehaviorCoverageCount, scenarioIds.length);
  assert.deepEqual(output.inheritedFrom, [
    { packageVersion: '0.5.0', packageArtifactSha256: 'f'.repeat(64) },
  ]);
});

test('release gate invalidates only the scenario whose behavior contract changed', () => {
  const runsDirectory = temporaryDirectory();
  const scenarioIds = Object.keys(currentFingerprint().scenarios);
  for (const scenarioId of scenarioIds) {
    const path = writeRun(runsDirectory, { scenarioId });
    const record = JSON.parse(readFileSync(path, 'utf8'));
    record.subject.packageVersion = '0.5.0';
    record.subject.packageArtifactSha256 = 'f'.repeat(64);
    if (scenarioId === 'progressive-disclosure') {
      record.subject.scenarioSha256 = 'e'.repeat(64);
    }
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  }

  const result = run(['gate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /codex\/progressive-disclosure/);
  assert.match(result.stderr, /subject-drift scenarioSha256 codex\/progressive-disclosure/);
  assert.doesNotMatch(result.stderr, /codex\/bootstrap-global-memory/);
});
