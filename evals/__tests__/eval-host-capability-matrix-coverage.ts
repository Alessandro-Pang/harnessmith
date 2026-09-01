import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluationFingerprint } from '../../scripts/eval-fingerprint.js';
import { buildHostCapabilityMatrixReport } from '../../scripts/eval-host-capability-matrix.js';
import { readHostCapabilityMatrix } from '../../scripts/eval-host-capability-matrix-contract.js';
import { writeCandidateTarball } from './tarball-fixture.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'harnessmith-host-matrix-coverage-'));
const candidateArtifact = join(temporaryRoot, 'candidate.tgz');
const runsDirectory = join(temporaryRoot, 'runs');

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

try {
  writeCandidateTarball(candidateArtifact, root);
  const fingerprint = evaluationFingerprint(candidateArtifact);
  const scenario = JSON.parse(
    readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8'),
  ).scenarios.find(({ id }: { id: string }) => id === 'progressive-disclosure');
  assert.ok(scenario);
  const runDirectory = join(runsDirectory, 'codex-progressive-disclosure');
  mkdirSync(runDirectory, { recursive: true });
  const artifacts = {
    transcript: 'redacted transcript\n',
    diff: 'clean filesystem diff\n',
    observation: 'independent verifier observation\n',
  };
  for (const [name, content] of Object.entries(artifacts)) {
    writeFileSync(join(runDirectory, `${name}.txt`), content);
  }
  const evidence = [
    ['transcript', 'transcript'],
    ['diff', 'diff'],
    ['observation', 'observation'],
  ].map(([id, kind]) => ({
    id,
    kind,
    artifactRef: `local:${id}.txt`,
    sha256: digest(artifacts[id as keyof typeof artifacts]),
    description: `${id} evidence`,
  }));
  const assertionRefs = evidence.map(({ id }) => id);
  const finishedAt = new Date().toISOString();
  const record = {
    schemaVersion: 6,
    recordType: 'host-evaluation',
    runId: 'codex-progressive-disclosure',
    scenarioId: scenario.id,
    host: {
      adapter: 'codex',
      product: 'Codex coverage host',
      version: '1.0.0',
      model: 'coverage-model',
      modelVersion: '1',
    },
    subject: {
      packageVersion: fingerprint.packageVersion,
      harnessVersion: fingerprint.harnessVersion,
      packageArtifactSha256: fingerprint.packageArtifactSha256,
      scenarioSha256: fingerprint.scenarios[scenario.id],
      dependencySha256: fingerprint.scenarioDependencies[scenario.id],
      rulesSha256: fingerprint.rulesSha256,
    },
    startedAt: new Date(Date.parse(finishedAt) - 1_000).toISOString(),
    finishedAt,
    evaluatedAt: finishedAt,
    execution: {
      tier: 'L2',
      attempt: 1,
      maxAttempts: 2,
      scenarioBudgetMs: 900_000,
      matrixBudgetMs: 3_600_000,
      elapsedMs: 1_000,
      transportFailures: 0,
      termination: 'completed',
    },
    transcript: {
      artifactRef: 'local:transcript.txt',
      sha256: digest(artifacts.transcript),
      redacted: true,
    },
    toolActions: [
      {
        sequence: 1,
        tool: 'filesystem.read',
        kind: 'read',
        target: 'fixture',
        outcome: 'completed',
        approval: 'not-required',
      },
    ],
    filesystemDiff: {
      artifactRef: 'local:diff.txt',
      sha256: digest(artifacts.diff),
      changedPaths: [],
      clean: true,
    },
    scenarioAssertions: scenario.pass.map((description: string, index: number) => ({
      id: `pass-${index + 1}`,
      description,
      passed: true,
      evidenceRefs: assertionRefs,
    })),
    forbiddenActionAssertions: scenario.forbidden.map((description: string, index: number) => ({
      id: `forbidden-${index + 1}`,
      description,
      passed: true,
      evidenceRefs: assertionRefs,
    })),
    verdict: {
      outcome: 'passed',
      evaluator: 'independent coverage verifier',
      summary: 'All observable checks passed.',
      evidenceRefs: assertionRefs,
    },
    evidence,
  };
  writeFileSync(join(runDirectory, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);

  const report = buildHostCapabilityMatrixReport({ candidateArtifact, runsDirectory });
  assert.equal(report.summary.passed, 1);
  assert.equal(report.rejectedNonCandidateRecords, 0);

  const malformed = structuredClone(readHostCapabilityMatrix());
  malformed.hosts[0].evidence = ['scripts/missing-evidence.ts'];
  assert.throws(() => readHostCapabilityMatrix(malformed), /evidence is missing/);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
