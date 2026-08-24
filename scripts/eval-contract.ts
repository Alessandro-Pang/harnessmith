import {
  evaluationFingerprint,
  releaseArtifactPath,
  requiredEvaluationAdapters,
} from './eval-fingerprint.js';
import {
  type EvaluationRecordOptions,
  latestEvaluationRecords,
  validateEvaluationRecords,
} from './eval-records.js';

export { validateEvaluationRecords } from './eval-records.js';

interface EvaluationGateOptions extends EvaluationRecordOptions {
  maxAgeDays?: number;
  packageArtifact?: string;
}

export function gateEvaluationRecords(options: EvaluationGateOptions = {}) {
  const records = latestEvaluationRecords(validateEvaluationRecords(options));
  const maxAgeDays = options.maxAgeDays ?? 30;
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    throw new Error('--max-age-days must be a positive number');
  }
  const current = evaluationFingerprint(releaseArtifactPath(options.packageArtifact));
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const covered = new Set<string>();
  const rejected: string[] = [];
  for (const { record } of records) {
    const coverageKey = `${record.host.adapter}/${record.scenarioId}`;
    const subjectDrift = [
      record.subject.packageVersion === current.packageVersion ? null : 'packageVersion',
      record.subject.harnessVersion === current.harnessVersion ? null : 'harnessVersion',
      record.subject.packageArtifactSha256 === current.packageArtifactSha256
        ? null
        : 'packageArtifactSha256',
      record.subject.scenarioSha256 === current.scenarios[record.scenarioId]
        ? null
        : 'scenarioSha256',
      record.subject.rulesSha256 === current.rulesSha256 ? null : 'rulesSha256',
    ].filter((field): field is string => Boolean(field));
    const startedAt = Date.parse(record.startedAt);
    const finishedAt = Date.parse(record.finishedAt);
    const evaluatedAt = Date.parse(record.evaluatedAt);
    const fresh =
      Number.isFinite(startedAt) &&
      Number.isFinite(finishedAt) &&
      Number.isFinite(evaluatedAt) &&
      startedAt <= finishedAt &&
      finishedAt <= evaluatedAt &&
      finishedAt >= cutoff &&
      evaluatedAt <= Date.now();
    const failedAssertions = record.forbiddenActionAssertions.filter(({ passed }) => !passed);
    const failedScenarioAssertions = record.scenarioAssertions.filter(({ passed }) => !passed);
    if (
      subjectDrift.length === 0 &&
      fresh &&
      record.verdict.outcome === 'passed' &&
      failedAssertions.length === 0 &&
      failedScenarioAssertions.length === 0
    ) {
      covered.add(coverageKey);
    } else if (subjectDrift.length > 0) {
      rejected.push(`subject-drift ${subjectDrift.join(',')} ${coverageKey}`);
    } else if (!fresh) rejected.push(`stale ${coverageKey}`);
    else if (record.verdict.outcome !== 'passed')
      rejected.push(`${record.verdict.outcome} ${coverageKey}`);
    else if (failedScenarioAssertions.length > 0)
      rejected.push(
        `scenario-assertion-failure ${failedScenarioAssertions.map(({ id }) => id).join(',')} ${coverageKey}`,
      );
    else
      rejected.push(
        `forbidden-action-failure ${failedAssertions.map(({ id }) => id).join(',')} ${coverageKey}`,
      );
  }
  const scenarioIds = Object.keys(current.scenarios);
  const missing = requiredEvaluationAdapters.flatMap((adapter) =>
    scenarioIds.map((scenarioId) => `${adapter}/${scenarioId}`).filter((key) => !covered.has(key)),
  );
  if (missing.length > 0) {
    const rejectedRecords =
      rejected.length > 0 ? `\nRejected records:\n- ${rejected.join('\n- ')}` : '';
    throw new Error(
      `Missing fresh passing host evaluation coverage:\n- ${missing.join('\n- ')}${rejectedRecords}`,
    );
  }
  return {
    valid: true,
    assurance: 'maintainer-attested-structure',
    packageArtifactSha256: current.packageArtifactSha256,
    coverageCount: covered.size,
    hosts: requiredEvaluationAdapters,
    scenarios: scenarioIds,
    maxAgeDays,
  };
}
