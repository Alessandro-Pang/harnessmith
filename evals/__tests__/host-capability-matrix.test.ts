import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { test } from 'vitest';
import {
  buildHostCapabilityMatrixReport,
  readHostCapabilityMatrix,
} from '../../scripts/eval-host-capability-matrix.js';
import {
  candidateArtifact,
  currentFingerprint,
  digest,
  root,
  temporaryDirectory,
  writeRun,
} from './run-fixture.js';
import { writeCandidateTarball } from './tarball-fixture.js';

test('host capability matrix is complete, unique, and backed by repository evidence', () => {
  const matrix = JSON.parse(
    readFileSync(join(root, 'evals', 'host-capability-matrix.v1.json'), 'utf8'),
  );
  const schema = JSON.parse(
    readFileSync(join(root, 'evals', 'host-capability-matrix.schema.json'), 'utf8'),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  assert.equal(validate(matrix), true, JSON.stringify(validate.errors));
  assert.deepEqual(
    matrix.hosts.map(({ id }: { id: string }) => id),
    ['codex', 'cursor', 'claude', 'opencode', 'kimi'],
  );
  assert.deepEqual(
    matrix.capabilities.map(({ id }: { id: string }) => id),
    [
      'first-startup',
      'high-value-read-only-analysis',
      'no-typed-writer',
      'uninitialized-project',
      'compact-boundary',
      'second-task',
      'sidecar-failure',
      'dirty-worktree',
      'local-write-forbidden',
      'host-signal-replay',
    ],
  );
  for (const capability of matrix.capabilities) {
    for (const host of matrix.hosts) {
      const support = capability.supportOverrides?.[host.id] ?? host;
      assert.ok(support);
      for (const path of support.evidence) assert.equal(existsSync(join(root, path)), true, path);
    }
  }
});

test('matrix report binds every cell to one candidate and preserves real outcome classes', () => {
  const runsDirectory = temporaryDirectory();
  const passedPath = writeRun(runsDirectory, {
    scenarioId: 'progressive-disclosure',
    outcome: 'passed',
  });
  const verifier = 'independent verifier observation\n';
  writeFileSync(join(passedPath, '..', 'verifier.txt'), verifier);
  const passedRecord = JSON.parse(readFileSync(passedPath, 'utf8'));
  passedRecord.evidence.push({
    id: 'independent-verifier',
    kind: 'observation',
    artifactRef: 'local:verifier.txt',
    sha256: digest(verifier),
    description: 'Independent verifier result.',
  });
  passedRecord.verdict.evidenceRefs.push('independent-verifier');
  for (const assertion of [
    ...passedRecord.scenarioAssertions,
    ...passedRecord.forbiddenActionAssertions,
  ]) {
    assertion.evidenceRefs.push('independent-verifier');
  }
  writeFileSync(passedPath, `${JSON.stringify(passedRecord, null, 2)}\n`);
  writeRun(runsDirectory, {
    scenarioId: 'destructive-boundary',
    outcome: 'infra-inconclusive',
    termination: 'transport-failure',
  });

  const report = buildHostCapabilityMatrixReport({ candidateArtifact, runsDirectory });
  const fingerprint = currentFingerprint();
  assert.equal(report.subject.packageArtifactSha256, fingerprint.packageArtifactSha256);
  assert.equal(report.subject.rulesSha256, fingerprint.rulesSha256);
  assert.equal(report.cells.length, 50);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary['infra-inconclusive'], 2);
  assert.equal(report.summary.inconclusive, 43);
  assert.equal(report.summary['not-executed'], 4);
  assert.equal(report.summary.unsupported, 0);
  const passed = report.cells.find(
    ({ host, capabilityId }) =>
      host === 'codex' && capabilityId === 'high-value-read-only-analysis',
  );
  assert.equal(passed?.status, 'passed');
  assert.deepEqual(passed?.recordIds, ['codex-progressive-disclosure']);
  assert.equal(
    passed?.scenarioFingerprints['progressive-disclosure'],
    fingerprint.scenarios['progressive-disclosure'],
  );
  assert.equal(
    passed?.dependencyFingerprints['progressive-disclosure'],
    fingerprint.scenarioDependencies['progressive-disclosure'],
  );
  assert.deepEqual(passed?.evidence, {
    toolActions: 1,
    filesystemDiffs: 1,
    scenarioAssertions: 1,
    forbiddenActionAssertions: 2,
    verifierEvidenceRefs: 3,
    independentVerifierArtifacts: 1,
  });
  assert.equal(
    report.cells.find(
      ({ host, capabilityId }) => host === 'codex' && capabilityId === 'dirty-worktree',
    )?.status,
    'infra-inconclusive',
  );
  assert.equal(
    report.cells.find(
      ({ host, capabilityId }) => host === 'codex' && capabilityId === 'first-startup',
    )?.status,
    'not-executed',
  );
  assert.equal(
    report.cells.find(
      ({ host, capabilityId }) =>
        host === 'cursor' && capabilityId === 'high-value-read-only-analysis',
    )?.status,
    'inconclusive',
  );
  assert.equal(report.hostProof, false);
  assert.equal(report.assurance, 'candidate-bound-maintainer-attested-structure');
});

test('matrix contract rejects unknown scenarios and executable cells without scenarios', () => {
  const matrix = readHostCapabilityMatrix();
  const invalid = structuredClone(matrix);
  invalid.capabilities[0].scenarioIds = ['unknown-scenario'];
  assert.throws(() => readHostCapabilityMatrix(invalid), /unknown scenario/);

  const missing = structuredClone(matrix);
  missing.capabilities[0].scenarioIds = [];
  assert.throws(() => readHostCapabilityMatrix(missing), /executable.*scenario/i);
});

test('matrix contract fails closed for malformed order, duplicates, and missing evidence', () => {
  const malformed = structuredClone(readHostCapabilityMatrix()) as unknown as Record<
    string,
    unknown
  >;
  delete malformed.schemaVersion;
  assert.throws(() => readHostCapabilityMatrix(malformed as never), /violates schema/);

  const reordered = structuredClone(readHostCapabilityMatrix());
  [reordered.hosts[0], reordered.hosts[1]] = [reordered.hosts[1], reordered.hosts[0]];
  assert.throws(() => readHostCapabilityMatrix(reordered), /canonical ordered Host list/);

  const duplicated = structuredClone(readHostCapabilityMatrix());
  duplicated.capabilities[1].id = duplicated.capabilities[0].id;
  assert.throws(() => readHostCapabilityMatrix(duplicated), /ids must be unique/);

  const missingEvidence = structuredClone(readHostCapabilityMatrix());
  missingEvidence.hosts[0].evidence = ['scripts/does-not-exist.ts'];
  assert.throws(() => readHostCapabilityMatrix(missingEvidence), /evidence is missing/);
});

test('matrix report keeps behavior, evaluator, and rejected-candidate records distinct', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory, {
    scenarioId: 'memory-autopilot-unprompted',
    outcome: 'behavior-failed',
  });
  writeRun(runsDirectory, {
    scenarioId: 'memory-profile-cross-task-recall',
    outcome: 'evaluator-failed',
    termination: 'evaluator-failure',
  });
  writeRun(runsDirectory, { scenarioId: 'bootstrap-global-memory', outcome: 'passed' });
  const rejectedPath = writeRun(runsDirectory, {
    scenarioId: 'safe-path-boundary',
    runId: 'codex-safe-path-rejected-candidate',
  });
  const rejected = JSON.parse(readFileSync(rejectedPath, 'utf8'));
  rejected.subject.packageArtifactSha256 = 'f'.repeat(64);
  writeFileSync(rejectedPath, `${JSON.stringify(rejected, null, 2)}\n`);

  const report = buildHostCapabilityMatrixReport({ candidateArtifact, runsDirectory });
  assert.equal(report.summary['behavior-failed'], 2);
  assert.equal(report.summary['evaluator-failed'], 2);
  assert.equal(report.rejectedNonCandidateRecords, 1);
  assert.equal(
    report.cells.find(
      ({ host, capabilityId }) => host === 'codex' && capabilityId === 'second-task',
    )?.status,
    'evaluator-failed',
  );
  assert.equal(
    report.cells.find(
      ({ host, capabilityId }) => host === 'codex' && capabilityId === 'first-startup',
    )?.status,
    'evaluator-failed',
  );
});

test('matrix CLI reports missing execution without manufacturing Host proof', () => {
  const entry = join(root, 'scripts', 'eval-host-capability-matrix-cli.ts');
  const run = (extra: string[] = []) =>
    spawnSync(
      process.execPath,
      ['--import', 'tsx', entry, '--package-artifact', candidateArtifact, ...extra],
      { cwd: root, encoding: 'utf8' },
    );

  const reportResult = run();
  assert.equal(reportResult.status, 0, reportResult.stderr);
  const report = JSON.parse(reportResult.stdout);
  assert.equal(report.hostProof, false);
  assert.equal(report.summary['not-executed'], 7);
  assert.equal(report.summary.inconclusive, 43);

  const required = run(['--require-complete']);
  assert.equal(required.status, 1);
  assert.equal(JSON.parse(required.stdout).hostProof, false);
});

test('matrix report rejects a candidate whose matrix contract differs from the worktree', () => {
  const directory = temporaryDirectory();
  const artifact = join(directory, 'tampered-matrix.tgz');
  const hostMatrix = readHostCapabilityMatrix();
  hostMatrix.capabilities[0].description = 'tampered candidate matrix';
  writeCandidateTarball(artifact, root, { hostMatrix });

  assert.throws(
    () => buildHostCapabilityMatrixReport({ candidateArtifact: artifact }),
    /host-capability-matrix\.v1\.json does not match/,
  );
});
