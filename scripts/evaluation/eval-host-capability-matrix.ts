import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord } from './records/eval-artifacts.js';
import {
  evaluationFingerprint,
  releaseArtifactPath,
  repositoryRoot,
} from './records/eval-fingerprint.js';
import { readHostCapabilityMatrix } from './contracts/eval-host-capability-matrix-contract.js';
import {
  latestEvaluationRecords,
  type VerifiedRun,
  validateEvaluationRecords,
} from './records/eval-records.js';

export { readHostCapabilityMatrix } from './contracts/eval-host-capability-matrix-contract.js';

type CellStatus =
  | 'passed'
  | 'behavior-failed'
  | 'infra-inconclusive'
  | 'evaluator-failed'
  | 'not-executed'
  | 'inconclusive'
  | 'unsupported';

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function recordMatchesCandidate(
  record: RunRecord,
  fingerprint: ReturnType<typeof evaluationFingerprint>,
): boolean {
  return Boolean(
    record.subject.packageVersion === fingerprint.packageVersion &&
      record.subject.harnessVersion === fingerprint.harnessVersion &&
      record.subject.packageArtifactSha256 === fingerprint.packageArtifactSha256 &&
      record.subject.rulesSha256 === fingerprint.rulesSha256 &&
      record.subject.scenarioSha256 === fingerprint.scenarios[record.scenarioId] &&
      record.subject.dependencySha256 === fingerprint.scenarioDependencies[record.scenarioId],
  );
}

function hasIndependentEvidence(record: RunRecord): boolean {
  return (
    record.toolActions.length > 0 &&
    record.evidence.some(({ kind }) => ['test', 'file', 'log', 'observation'].includes(kind))
  );
}

function outcome(records: VerifiedRun[], scenarioIds: string[]): CellStatus {
  if (records.length === 0) return 'not-executed';
  const outcomes = records.map(({ record }) => record.verdict.outcome);
  if (
    outcomes.includes('behavior-failed') ||
    records.some(({ record }) =>
      [...record.scenarioAssertions, ...record.forbiddenActionAssertions].some(
        ({ passed }) => !passed,
      ),
    )
  ) {
    return 'behavior-failed';
  }
  if (outcomes.includes('evaluator-failed')) return 'evaluator-failed';
  if (outcomes.includes('infra-inconclusive')) return 'infra-inconclusive';
  if (new Set(records.map(({ record }) => record.scenarioId)).size < scenarioIds.length) {
    return 'not-executed';
  }
  if (records.some(({ record }) => !hasIndependentEvidence(record))) return 'evaluator-failed';
  return outcomes.every((value) => value === 'passed') ? 'passed' : 'not-executed';
}

function evidenceSummary(records: VerifiedRun[]) {
  const evidenceRefs = new Set<string>();
  for (const { record } of records) {
    for (const reference of record.verdict.evidenceRefs)
      evidenceRefs.add(`${record.runId}/${reference}`);
    for (const assertion of [...record.scenarioAssertions, ...record.forbiddenActionAssertions]) {
      for (const reference of assertion.evidenceRefs)
        evidenceRefs.add(`${record.runId}/${reference}`);
    }
  }
  return {
    toolActions: records.reduce((total, { record }) => total + record.toolActions.length, 0),
    filesystemDiffs: records.length,
    scenarioAssertions: records.reduce(
      (total, { record }) => total + record.scenarioAssertions.length,
      0,
    ),
    forbiddenActionAssertions: records.reduce(
      (total, { record }) => total + record.forbiddenActionAssertions.length,
      0,
    ),
    verifierEvidenceRefs: evidenceRefs.size,
    independentVerifierArtifacts: records.reduce(
      (total, { record }) =>
        total +
        record.evidence.filter(({ kind }) => ['test', 'file', 'log', 'observation'].includes(kind))
          .length,
      0,
    ),
  };
}

export function buildHostCapabilityMatrixReport(options: {
  candidateArtifact?: string;
  runsDirectory?: string;
}) {
  const packageArtifact = releaseArtifactPath(options.candidateArtifact);
  const fingerprint = evaluationFingerprint(packageArtifact);
  const matrix = readHostCapabilityMatrix();
  const verified = options.runsDirectory
    ? latestEvaluationRecords(validateEvaluationRecords({ runsDirectory: options.runsDirectory }))
    : [];
  const exactRecords = verified.filter(({ record }) => recordMatchesCandidate(record, fingerprint));
  const cells = matrix.hosts.flatMap((host) =>
    matrix.capabilities.map((capability) => {
      const support = capability.supportOverrides?.[host.id] ?? host;
      const records = exactRecords.filter(
        ({ record }) =>
          record.host.adapter === host.id && capability.scenarioIds.includes(record.scenarioId),
      );
      const status: CellStatus =
        support.state === 'executable' ? outcome(records, capability.scenarioIds) : support.state;
      return {
        host: host.id,
        capabilityId: capability.id,
        scenarioIds: capability.scenarioIds,
        scenarioFingerprints: Object.fromEntries(
          capability.scenarioIds.map((scenarioId) => [
            scenarioId,
            fingerprint.scenarios[scenarioId],
          ]),
        ),
        dependencyFingerprints: Object.fromEntries(
          capability.scenarioIds.map((scenarioId) => [
            scenarioId,
            fingerprint.scenarioDependencies[scenarioId],
          ]),
        ),
        support: support.state,
        status,
        reason:
          support.state === 'executable'
            ? records.length === 0
              ? 'No exact-candidate real Host record was supplied.'
              : 'Status is derived from schema-valid exact-candidate real Host records.'
            : support.reason,
        supportEvidence: support.evidence,
        recordIds: records.map(({ record }) => record.runId).sort(),
        evidence: evidenceSummary(records),
      };
    }),
  );
  const statuses: CellStatus[] = [
    'passed',
    'behavior-failed',
    'infra-inconclusive',
    'evaluator-failed',
    'not-executed',
    'inconclusive',
    'unsupported',
  ];
  return {
    schemaVersion: 1,
    assurance: 'candidate-bound-maintainer-attested-structure' as const,
    hostProof: false as const,
    subject: {
      packageVersion: fingerprint.packageVersion,
      harnessVersion: fingerprint.harnessVersion,
      packageArtifactSha256: fingerprint.packageArtifactSha256,
      behaviorSha256: fingerprint.behaviorSha256,
      rulesSha256: fingerprint.rulesSha256,
      scenarioCatalogSha256: sha256(readFileSync(join(repositoryRoot, 'evals', 'scenarios.json'))),
      hostCapabilityMatrixSha256: fingerprint.hostCapabilityMatrixSha256,
    },
    provenance: {
      candidateArtifact: packageArtifact,
      matrixContract: 'evals/host-capability-matrix.v1.json',
      runRecords: options.runsDirectory ?? 'not-provided',
      note: 'A report or repository-local record is not trusted proof that a third-party Host executed it.',
    },
    summary: Object.fromEntries(
      statuses.map((status) => [status, cells.filter((cell) => cell.status === status).length]),
    ) as Record<CellStatus, number>,
    rejectedNonCandidateRecords: verified.length - exactRecords.length,
    cells,
  };
}
