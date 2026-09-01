import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { compareHostEvaluationEvidence } from '../../scripts/eval-comparison.js';
import { readNpmPackageTarball } from '../../scripts/npm-tarball.js';
import { candidateArtifact, root, temporaryDirectory, writeRun } from './run-fixture.js';
import { writeCandidateTarball } from './tarball-fixture.js';

interface MutableFixtureRecord {
  host: { modelVersion: string };
  subject: {
    packageArtifactSha256: string;
    rulesSha256: string;
    dependencySha256: string;
  };
}

type RecordPatch = (record: MutableFixtureRecord) => void;

function patchRecord(path: string, patch: RecordPatch): void {
  const record = JSON.parse(readFileSync(path, 'utf8')) as MutableFixtureRecord;
  patch(record);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

function fixture({
  baselineOutcome = 'passed',
  candidateOutcome = 'passed',
  baselineTermination = 'completed',
  candidateTermination = 'completed',
  patchBaseline = () => undefined,
  patchCandidate = () => undefined,
}: {
  baselineOutcome?: 'passed' | 'behavior-failed' | 'infra-inconclusive' | 'evaluator-failed';
  candidateOutcome?: 'passed' | 'behavior-failed' | 'infra-inconclusive' | 'evaluator-failed';
  baselineTermination?:
    | 'completed'
    | 'transport-failure'
    | 'scenario-budget-exhausted'
    | 'circuit-open'
    | 'evaluator-failure';
  candidateTermination?:
    | 'completed'
    | 'transport-failure'
    | 'scenario-budget-exhausted'
    | 'circuit-open'
    | 'evaluator-failure';
  patchBaseline?: RecordPatch;
  patchCandidate?: RecordPatch;
} = {}) {
  const directory = temporaryDirectory();
  const baselineRunsDirectory = join(directory, 'baseline-runs');
  const candidateRunsDirectory = join(directory, 'candidate-runs');
  const baselineArtifact = join(directory, 'baseline.tgz');
  writeCandidateTarball(baselineArtifact, root, { rule: '<!-- baseline rule -->\n' });
  const baselinePath = writeRun(baselineRunsDirectory, {
    outcome: baselineOutcome,
    termination: baselineTermination,
    runId: 'baseline-progressive-disclosure',
  });
  const candidatePath = writeRun(candidateRunsDirectory, {
    outcome: candidateOutcome,
    termination: candidateTermination,
    runId: 'candidate-progressive-disclosure',
  });
  patchRecord(baselinePath, (record) => {
    record.subject.packageArtifactSha256 = readNpmPackageTarball(baselineArtifact).sha256;
    record.subject.rulesSha256 = 'a'.repeat(64);
    record.subject.dependencySha256 = 'b'.repeat(64);
    patchBaseline(record);
  });
  patchRecord(candidatePath, patchCandidate);
  return {
    baselineArtifact,
    baselineRunsDirectory,
    candidateArtifact,
    candidateRunsDirectory,
  };
}

test('Host evidence comparison reports a matched passing control without inventing token data', () => {
  const result = compareHostEvaluationEvidence(fixture());

  assert.equal(result.status, 'passed');
  assert.equal(result.cells[0]?.classification, 'unchanged-passed');
  assert.equal(result.cells[0]?.metrics.tokenUsage, 'not-measured');
  assert.equal(result.cells[0]?.subject.baseline.dependencySha256, 'b'.repeat(64));
  assert.notEqual(
    result.cells[0]?.subject.baseline.packageArtifactSha256,
    result.cells[0]?.subject.candidate.packageArtifactSha256,
  );
});

test('Host evidence comparison CLI emits the versioned deterministic JSON contract', () => {
  const options = fixture();
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(root, 'scripts', 'eval-gate.ts'),
      'compare',
      '--baseline-runs-dir',
      options.baselineRunsDirectory,
      '--baseline-artifact',
      options.baselineArtifact,
      '--candidate-runs-dir',
      options.candidateRunsDirectory,
      '--candidate-artifact',
      options.candidateArtifact,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { schemaVersion: number; status: string };
  assert.deepEqual(report, {
    ...compareHostEvaluationEvidence(options),
    schemaVersion: 1,
    status: 'passed',
  });
});

test('Host evidence comparison distinguishes improvement, regression, and infrastructure uncertainty', () => {
  const improved = compareHostEvaluationEvidence(fixture({ baselineOutcome: 'behavior-failed' }));
  assert.equal(improved.status, 'passed');
  assert.equal(improved.cells[0]?.classification, 'improved');

  const regressed = compareHostEvaluationEvidence(fixture({ candidateOutcome: 'behavior-failed' }));
  assert.equal(regressed.status, 'failed');
  assert.equal(regressed.cells[0]?.classification, 'regressed');

  const inconclusive = compareHostEvaluationEvidence(
    fixture({
      candidateOutcome: 'infra-inconclusive',
      candidateTermination: 'transport-failure',
    }),
  );
  assert.equal(inconclusive.status, 'inconclusive');
  assert.equal(inconclusive.cells[0]?.classification, 'inconclusive');
});

test('Host evidence comparison fails closed on mismatched Host/model identity', () => {
  assert.throws(
    () =>
      compareHostEvaluationEvidence(
        fixture({ patchCandidate: (record) => (record.host.modelVersion = 'different-model') }),
      ),
    /Host\/model mismatch.*codex\/progressive-disclosure/i,
  );
});

test('Host evidence comparison fails closed on duplicate, missing, and artifact-mismatched cells', () => {
  const duplicate = fixture();
  writeRun(duplicate.candidateRunsDirectory, {
    runId: 'candidate-progressive-disclosure-duplicate',
  });
  assert.throws(() => compareHostEvaluationEvidence(duplicate), /duplicate candidate cell/i);

  const missing = fixture();
  const otherCandidateRuns = join(temporaryDirectory(), 'candidate-runs');
  writeRun(otherCandidateRuns, {
    scenarioId: 'safe-path-boundary',
    runId: 'candidate-safe-path',
  });
  assert.throws(
    () =>
      compareHostEvaluationEvidence({
        ...missing,
        candidateRunsDirectory: otherCandidateRuns,
      }),
    /comparison cell mismatch/i,
  );

  const artifactMismatch = fixture({
    patchCandidate: (record) => (record.subject.packageArtifactSha256 = 'f'.repeat(64)),
  });
  assert.throws(
    () => compareHostEvaluationEvidence(artifactMismatch),
    /candidate artifact digest mismatch/i,
  );
});
