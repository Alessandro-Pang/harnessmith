import type { RunRecord } from './eval-artifacts.js';
import type { VerifiedRun } from './eval-records.js';
import { validateEvaluationRecords } from './eval-records.js';
import { readNpmPackageTarball } from './npm-tarball.js';

type HostIdentity = {
  adapter: string;
  product: string;
  version: string;
  model: string;
  modelVersion: string;
};

type ComparisonRecord = RunRecord & {
  host: HostIdentity;
  toolActions: Array<{ sequence: number }>;
};

export type HostEvalCellClassification =
  | 'improved'
  | 'unchanged-passed'
  | 'regressed'
  | 'unchanged-failed'
  | 'inconclusive';

export interface HostEvalComparisonOptions {
  baselineArtifact: string;
  baselineRunsDirectory: string;
  candidateArtifact: string;
  candidateRunsDirectory: string;
}

function cellKey(record: ComparisonRecord): string {
  return `${record.host.adapter}/${record.scenarioId}`;
}

function indexRecords(
  runs: VerifiedRun[],
  side: 'baseline' | 'candidate',
  artifactSha256: string,
): Map<string, ComparisonRecord> {
  const indexed = new Map<string, ComparisonRecord>();
  for (const { record } of runs) {
    const comparisonRecord = record as ComparisonRecord;
    const key = cellKey(comparisonRecord);
    if (indexed.has(key)) throw new Error(`Duplicate ${side} cell: ${key}`);
    if (record.subject.packageArtifactSha256 !== artifactSha256) {
      throw new Error(
        `${side} artifact digest mismatch for ${key}: expected ${artifactSha256}, received ${record.subject.packageArtifactSha256}`,
      );
    }
    indexed.set(key, comparisonRecord);
  }
  return indexed;
}

function assertSameCells(
  baseline: Map<string, ComparisonRecord>,
  candidate: Map<string, ComparisonRecord>,
): string[] {
  const baselineKeys = [...baseline.keys()].sort();
  const candidateKeys = [...candidate.keys()].sort();
  if (JSON.stringify(baselineKeys) !== JSON.stringify(candidateKeys)) {
    throw new Error(
      `Comparison cell mismatch: baseline=${baselineKeys.join(',')}; candidate=${candidateKeys.join(',')}`,
    );
  }
  return baselineKeys;
}

function assertPairContract(
  key: string,
  baseline: ComparisonRecord,
  candidate: ComparisonRecord,
): void {
  const hostFields = ['adapter', 'product', 'version', 'model', 'modelVersion'] as const;
  if (hostFields.some((field) => baseline.host[field] !== candidate.host[field])) {
    throw new Error(`Host/model mismatch for ${key}`);
  }
  if (baseline.subject.scenarioSha256 !== candidate.subject.scenarioSha256) {
    throw new Error(`Scenario fingerprint mismatch for ${key}`);
  }
  for (const [label, baselineAssertions, candidateAssertions] of [
    ['scenario', baseline.scenarioAssertions, candidate.scenarioAssertions],
    ['forbidden-action', baseline.forbiddenActionAssertions, candidate.forbiddenActionAssertions],
  ] as const) {
    const contract = (assertions: typeof baselineAssertions) =>
      assertions
        .map(({ id, description }) => ({ id, description }))
        .sort((left, right) => left.id.localeCompare(right.id));
    if (
      JSON.stringify(contract(baselineAssertions)) !== JSON.stringify(contract(candidateAssertions))
    ) {
      throw new Error(`${label} assertion contract mismatch for ${key}`);
    }
  }
}

function behaviorPassed(record: ComparisonRecord): boolean {
  return (
    record.verdict.outcome === 'passed' &&
    record.scenarioAssertions.every(({ passed }) => passed) &&
    record.forbiddenActionAssertions.every(({ passed }) => passed)
  );
}

function nonBehaviorOutcome(record: ComparisonRecord): boolean {
  return ['infra-inconclusive', 'evaluator-failed'].includes(record.verdict.outcome);
}

function classification(
  baseline: ComparisonRecord,
  candidate: ComparisonRecord,
): HostEvalCellClassification {
  if (nonBehaviorOutcome(baseline) || nonBehaviorOutcome(candidate)) return 'inconclusive';
  const baselinePassed = behaviorPassed(baseline);
  const candidatePassed = behaviorPassed(candidate);
  if (candidatePassed) return baselinePassed ? 'unchanged-passed' : 'improved';
  return baselinePassed ? 'regressed' : 'unchanged-failed';
}

function metric(baseline: number, candidate: number) {
  return { baseline, candidate, delta: candidate - baseline };
}

function passedAssertions(assertions: Array<{ passed: boolean }>): number {
  return assertions.filter(({ passed }) => passed).length;
}

export function compareHostEvaluationEvidence(options: HostEvalComparisonOptions) {
  const baselineArtifactSha256 = readNpmPackageTarball(options.baselineArtifact).sha256;
  const candidateArtifactSha256 = readNpmPackageTarball(options.candidateArtifact).sha256;
  const baseline = indexRecords(
    validateEvaluationRecords({ runsDirectory: options.baselineRunsDirectory }),
    'baseline',
    baselineArtifactSha256,
  );
  const candidate = indexRecords(
    validateEvaluationRecords({ runsDirectory: options.candidateRunsDirectory }),
    'candidate',
    candidateArtifactSha256,
  );
  const keys = assertSameCells(baseline, candidate);
  const cells = keys.map((key) => {
    const baselineRecord = baseline.get(key) as ComparisonRecord;
    const candidateRecord = candidate.get(key) as ComparisonRecord;
    assertPairContract(key, baselineRecord, candidateRecord);
    return {
      cell: key,
      host: baselineRecord.host,
      scenarioId: baselineRecord.scenarioId,
      classification: classification(baselineRecord, candidateRecord),
      outcomes: {
        baseline: baselineRecord.verdict.outcome,
        candidate: candidateRecord.verdict.outcome,
      },
      subject: {
        baseline: {
          packageArtifactSha256: baselineRecord.subject.packageArtifactSha256,
          rulesSha256: baselineRecord.subject.rulesSha256,
          dependencySha256: baselineRecord.subject.dependencySha256,
        },
        candidate: {
          packageArtifactSha256: candidateRecord.subject.packageArtifactSha256,
          rulesSha256: candidateRecord.subject.rulesSha256,
          dependencySha256: candidateRecord.subject.dependencySha256,
        },
        scenarioSha256: baselineRecord.subject.scenarioSha256,
      },
      metrics: {
        scenarioAssertionsPassed: metric(
          passedAssertions(baselineRecord.scenarioAssertions),
          passedAssertions(candidateRecord.scenarioAssertions),
        ),
        forbiddenActionAssertionsPassed: metric(
          passedAssertions(baselineRecord.forbiddenActionAssertions),
          passedAssertions(candidateRecord.forbiddenActionAssertions),
        ),
        toolActions: metric(baselineRecord.toolActions.length, candidateRecord.toolActions.length),
        elapsedMs: metric(baselineRecord.execution.elapsedMs, candidateRecord.execution.elapsedMs),
        tokenUsage: 'not-measured' as const,
      },
    };
  });
  const counts = Object.fromEntries(
    ['improved', 'unchanged-passed', 'regressed', 'unchanged-failed', 'inconclusive'].map(
      (value) => [value, cells.filter(({ classification }) => classification === value).length],
    ),
  ) as Record<HostEvalCellClassification, number>;
  const status =
    counts.regressed > 0 || counts['unchanged-failed'] > 0
      ? 'failed'
      : counts.inconclusive > 0
        ? 'inconclusive'
        : 'passed';
  return {
    schemaVersion: 1 as const,
    status,
    baselineArtifactSha256,
    candidateArtifactSha256,
    counts,
    cells,
  };
}
