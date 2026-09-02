import {
  evaluationFingerprint,
  releaseArtifactPath,
  requiredEvaluationAdapters,
} from '../records/eval-fingerprint.js';
import { EvaluationGateError, rejectionSummary } from '../records/eval-gate-failure.js';
import {
  type EvaluationRecordOptions,
  latestEvaluationRecords,
  type VerifiedRun,
  validateEvaluationRecords,
} from '../records/eval-records.js';

export { validateEvaluationRecords } from '../records/eval-records.js';

interface EvaluationGateOptions extends EvaluationRecordOptions {
  maxAgeDays?: number;
  packageArtifact?: string;
}

export interface InheritedEvaluationSource {
  packageVersion: string;
  packageArtifactSha256: string;
}

interface InheritedEvaluationCell extends InheritedEvaluationSource {
  cell: string;
}

export interface EvaluationEvidence {
  exact: string[];
  inherited: InheritedEvaluationCell[];
  infraBlocked: string[];
}

export interface EvaluationGateResult {
  valid: true;
  assurance: 'maintainer-attested-structure';
  packageArtifactSha256: string;
  behaviorSha256: string;
  coverageCount: number;
  exactArtifactCoverageCount: number;
  inheritedBehaviorCoverageCount: number;
  inheritedFrom: InheritedEvaluationSource[];
  evidence: EvaluationEvidence;
  hosts: string[];
  scenarios: string[];
  maxAgeDays: number;
}

type Fingerprint = ReturnType<typeof evaluationFingerprint>;
type CoverageSummary = Pick<
  EvaluationGateResult,
  'exactArtifactCoverageCount' | 'inheritedBehaviorCoverageCount' | 'inheritedFrom'
> & {
  covered: Set<string>;
  rejected: string[];
  exact: Set<string>;
  inheritedCells: Map<string, InheritedEvaluationCell>;
};

function behaviorCompatibleRecords(
  records: VerifiedRun[],
  current: Fingerprint,
): { compatible: VerifiedRun[]; rejected: string[] } {
  const compatible: VerifiedRun[] = [];
  const rejected: string[] = [];
  for (const run of records) {
    const { record } = run;
    const coverageKey = `${record.host.adapter}/${record.scenarioId}`;
    const drift = [
      record.subject.harnessVersion === current.harnessVersion ? null : 'harnessVersion',
      record.subject.scenarioSha256 === current.scenarios[record.scenarioId]
        ? null
        : 'scenarioSha256',
      record.subject.dependencySha256 === current.scenarioDependencies[record.scenarioId]
        ? null
        : 'dependencySha256',
    ].filter((field): field is string => Boolean(field));
    if (drift.length === 0) compatible.push(run);
    else rejected.push(`subject-drift ${drift.join(',')} ${coverageKey}`);
  }
  return { compatible, rejected };
}

function isFresh(record: VerifiedRun['record'], cutoff: number): boolean {
  const startedAt = Date.parse(record.startedAt);
  const finishedAt = Date.parse(record.finishedAt);
  const evaluatedAt = Date.parse(record.evaluatedAt);
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(finishedAt) &&
    Number.isFinite(evaluatedAt) &&
    startedAt <= finishedAt &&
    finishedAt <= evaluatedAt &&
    finishedAt >= cutoff &&
    evaluatedAt <= Date.now()
  );
}

function coverageSummary(
  records: VerifiedRun[],
  current: Fingerprint,
  cutoff: number,
  rejected: string[],
): CoverageSummary {
  const covered = new Set<string>();
  const exactCells = new Set<string>();
  const inheritedCells = new Map<string, InheritedEvaluationCell>();
  let exactArtifactCoverageCount = 0;
  let inheritedBehaviorCoverageCount = 0;
  const inherited = new Map<string, InheritedEvaluationSource>();
  for (const { record } of records) {
    const key = `${record.host.adapter}/${record.scenarioId}`;
    const failedForbidden = record.forbiddenActionAssertions.filter(({ passed }) => !passed);
    const failedScenario = record.scenarioAssertions.filter(({ passed }) => !passed);
    if (
      isFresh(record, cutoff) &&
      record.verdict.outcome === 'passed' &&
      failedForbidden.length === 0 &&
      failedScenario.length === 0
    ) {
      covered.add(key);
      const exact =
        record.subject.packageVersion === current.packageVersion &&
        record.subject.packageArtifactSha256 === current.packageArtifactSha256;
      if (exact) {
        exactArtifactCoverageCount += 1;
        exactCells.add(key);
      } else {
        inheritedBehaviorCoverageCount += 1;
        const source = {
          packageVersion: record.subject.packageVersion,
          packageArtifactSha256: record.subject.packageArtifactSha256,
        };
        inherited.set(`${source.packageVersion}\0${source.packageArtifactSha256}`, source);
        inheritedCells.set(key, { cell: key, ...source });
      }
    } else if (!isFresh(record, cutoff)) rejected.push(`stale ${key}`);
    else if (record.verdict.outcome !== 'passed') rejected.push(`${record.verdict.outcome} ${key}`);
    else if (failedScenario.length > 0)
      rejected.push(
        `scenario-assertion-failure ${failedScenario.map(({ id }) => id).join(',')} ${key}`,
      );
    else
      rejected.push(
        `forbidden-action-failure ${failedForbidden.map(({ id }) => id).join(',')} ${key}`,
      );
  }
  return {
    covered,
    rejected,
    exactArtifactCoverageCount,
    inheritedBehaviorCoverageCount,
    inheritedFrom: [...inherited.values()].sort(
      (left, right) =>
        left.packageVersion.localeCompare(right.packageVersion) ||
        left.packageArtifactSha256.localeCompare(right.packageArtifactSha256),
    ),
    exact: exactCells,
    inheritedCells,
  };
}

export function gateEvaluationRecords(options: EvaluationGateOptions = {}): EvaluationGateResult {
  const maxAgeDays = options.maxAgeDays ?? 30;
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    throw new Error('--max-age-days must be a positive number');
  }
  const current = evaluationFingerprint(releaseArtifactPath(options.packageArtifact));
  const { compatible, rejected } = behaviorCompatibleRecords(
    validateEvaluationRecords(options),
    current,
  );
  const records = latestEvaluationRecords(compatible);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const coverage = coverageSummary(records, current, cutoff, rejected);
  const scenarioIds = Object.keys(current.scenarios);
  const missing = requiredEvaluationAdapters.flatMap((adapter) =>
    scenarioIds
      .map((scenarioId) => `${adapter}/${scenarioId}`)
      .filter((key) => !coverage.covered.has(key)),
  );
  const matrix = requiredEvaluationAdapters.flatMap((adapter) =>
    scenarioIds.map((scenarioId) => `${adapter}/${scenarioId}`),
  );
  if (missing.length > 0) {
    throw new EvaluationGateError({
      version: 1,
      valid: false,
      assurance: 'maintainer-attested-structure',
      packageArtifactSha256: current.packageArtifactSha256,
      behaviorSha256: current.behaviorSha256,
      maxAgeDays,
      error: {
        code: 'EVAL_COVERAGE_INCOMPLETE',
        message: 'Missing fresh passing host evaluation coverage',
      },
      missing,
      rejected: {
        count: coverage.rejected.length,
        byReason: rejectionSummary(coverage.rejected),
        records: coverage.rejected,
      },
    });
  }
  return {
    valid: true,
    assurance: 'maintainer-attested-structure',
    packageArtifactSha256: current.packageArtifactSha256,
    behaviorSha256: current.behaviorSha256,
    coverageCount: coverage.covered.size,
    exactArtifactCoverageCount: coverage.exactArtifactCoverageCount,
    inheritedBehaviorCoverageCount: coverage.inheritedBehaviorCoverageCount,
    inheritedFrom: coverage.inheritedFrom,
    evidence: {
      exact: matrix.filter((cell) => coverage.exact.has(cell)),
      inherited: matrix.flatMap((cell) => {
        const inherited = coverage.inheritedCells.get(cell);
        return inherited ? [inherited] : [];
      }),
      infraBlocked: [],
    },
    hosts: [...requiredEvaluationAdapters],
    scenarios: scenarioIds,
    maxAgeDays,
  };
}
