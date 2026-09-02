import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { containsHighConfidenceSecret } from '../../../template/agent-harness/src/lib/security/secret-hygiene.js';
import { repositoryRoot, type supportedAdapters } from './eval-fingerprint.js';

type Artifact = { artifactRef: string; sha256: string };
const maximumArtifactBytes = 8 * 1024 * 1024;
const maximumAggregateArtifactBytes = 64 * 1024 * 1024;
export type ArtifactVerificationBudget = {
  canonicalArtifacts: Map<string, string>;
  totalBytes: number;
};
export type RunRecord = {
  runId: string;
  scenarioId: string;
  recordType: string;
  host: { adapter: (typeof supportedAdapters)[number] };
  subject: {
    packageVersion: string;
    harnessVersion: string;
    packageArtifactSha256: string;
    scenarioSha256: string;
    dependencySha256: string;
    rulesSha256: string;
  };
  startedAt: string;
  finishedAt: string;
  evaluatedAt: string;
  execution: {
    tier: 'L2' | 'L3' | 'L4';
    attempt: number;
    maxAttempts: 2;
    scenarioBudgetMs: number;
    matrixBudgetMs: number;
    elapsedMs: number;
    transportFailures: number;
    termination:
      | 'completed'
      | 'transport-failure'
      | 'scenario-budget-exhausted'
      | 'circuit-open'
      | 'evaluator-failure';
  };
  transcript: Artifact;
  toolActions: Array<{ sequence: number }>;
  filesystemDiff: Artifact & { changedPaths: string[]; clean: boolean };
  evidence: Array<Artifact & { id: string; kind: string }>;
  scenarioAssertions: Array<{
    id: string;
    description: string;
    passed: boolean;
    evidenceRefs: string[];
  }>;
  forbiddenActionAssertions: Array<{
    id: string;
    description: string;
    passed: boolean;
    evidenceRefs: string[];
  }>;
  verdict: {
    outcome: 'passed' | 'behavior-failed' | 'infra-inconclusive' | 'evaluator-failed';
    evidenceRefs: string[];
  };
};

export function createArtifactVerificationBudget(): ArtifactVerificationBudget {
  return { canonicalArtifacts: new Map(), totalBytes: 0 };
}

function verifyArtifact(
  recordPath: string,
  artifact: Artifact,
  budget: ArtifactVerificationBudget,
): Buffer | undefined {
  const artifactName = artifact.artifactRef.slice('local:'.length);
  const recordDirectory = dirname(recordPath);
  const artifactPath = resolve(recordDirectory, artifactName);
  const containedPath = relative(recordDirectory, artifactPath);
  if (
    !containedPath ||
    containedPath === '..' ||
    containedPath.startsWith(`..${sep}`) ||
    isAbsolute(containedPath)
  ) {
    throw new Error(
      `${relative(repositoryRoot, recordPath)} has an unsafe artifact reference: ${artifact.artifactRef}`,
    );
  }
  if (!existsSync(artifactPath)) {
    throw new Error(
      `${artifact.artifactRef} referenced by ${relative(repositoryRoot, recordPath)} is missing`,
    );
  }
  const canonicalArtifactPath = realpathSync(artifactPath);
  const canonicalRelative = relative(realpathSync(recordDirectory), canonicalArtifactPath);
  if (
    !canonicalRelative ||
    canonicalRelative === '..' ||
    canonicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(canonicalRelative)
  ) {
    throw new Error(`unsafe artifact reference ${artifact.artifactRef} in ${recordPath}`);
  }
  const stat = lstatSync(artifactPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`unsafe artifact reference ${artifact.artifactRef} in ${recordPath}`);
  }
  if (stat.size > maximumArtifactBytes) {
    throw new Error(
      `${artifact.artifactRef.slice('local:'.length)} exceeds the ${maximumArtifactBytes}-byte evidence limit`,
    );
  }
  const cachedSha256 = budget.canonicalArtifacts.get(canonicalArtifactPath);
  if (cachedSha256 !== undefined) {
    if (cachedSha256 !== artifact.sha256) {
      throw new Error(
        `${artifact.artifactRef} declares conflicting SHA-256 values in ${relative(repositoryRoot, recordPath)}`,
      );
    }
    return undefined;
  }
  if (budget.totalBytes + stat.size > maximumAggregateArtifactBytes) {
    throw new Error(
      `aggregate evidence exceeds the ${maximumAggregateArtifactBytes}-byte validation limit`,
    );
  }
  budget.totalBytes += stat.size;
  const content = readFileSync(artifactPath);
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== artifact.sha256) {
    throw new Error(`${artifactName} SHA-256 mismatch in ${relative(repositoryRoot, recordPath)}`);
  }
  budget.canonicalArtifacts.set(canonicalArtifactPath, artifact.sha256);
  return content;
}

function verifyEvidenceReferences(recordPath: string, record: RunRecord): void {
  const evidenceIds = new Set(record.evidence.map(({ id }) => id));
  if (evidenceIds.size !== record.evidence.length) {
    throw new Error(`${relative(repositoryRoot, recordPath)} contains duplicate evidence ids`);
  }
  for (const evidenceRef of record.verdict.evidenceRefs) {
    if (!evidenceIds.has(evidenceRef)) {
      throw new Error(`verdict references unknown evidence: ${evidenceRef}`);
    }
  }
  for (const assertion of record.forbiddenActionAssertions) {
    for (const evidenceRef of assertion.evidenceRefs) {
      if (!evidenceIds.has(evidenceRef)) {
        throw new Error(`forbidden-action assertion references unknown evidence: ${evidenceRef}`);
      }
    }
  }
  for (const assertion of record.scenarioAssertions) {
    for (const evidenceRef of assertion.evidenceRefs) {
      if (!evidenceIds.has(evidenceRef)) {
        throw new Error(`scenario assertion references unknown evidence: ${evidenceRef}`);
      }
    }
  }
  for (const [label, kind, artifact] of [
    ['transcript', 'transcript', record.transcript],
    ['filesystem diff', 'diff', record.filesystemDiff],
  ] as const) {
    const represented = record.evidence.some(
      ({ id, kind: evidenceKind, artifactRef, sha256 }) =>
        evidenceKind === kind &&
        artifactRef === artifact.artifactRef &&
        sha256 === artifact.sha256 &&
        record.verdict.evidenceRefs.includes(id),
    );
    if (!represented) throw new Error(`${label} artifact must be represented in verdict evidence`);
  }
}

export function verifyHighConfidenceSecretRedaction(label: string, content: string | Buffer): void {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  if (containsHighConfidenceSecret(text)) {
    throw new Error(`${label} failed secret redaction check`);
  }
}

export function verifyRunArtifacts(
  recordPath: string,
  record: RunRecord,
  budget: ArtifactVerificationBudget = createArtifactVerificationBudget(),
): void {
  verifyEvidenceReferences(recordPath, record);
  for (const artifact of [record.transcript, record.filesystemDiff, ...record.evidence]) {
    const content = verifyArtifact(recordPath, artifact, budget);
    if (content !== undefined) {
      verifyHighConfidenceSecretRedaction(artifact.artifactRef.slice('local:'.length), content);
    }
  }
}
