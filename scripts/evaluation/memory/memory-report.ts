import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  calculateMemoryMetrics,
  type MemoryMetricRecord,
  type MemoryMetrics,
} from './memory-metrics.js';
import type { MemoryFailureCategory } from './memory-state-verifier.js';

export type MemoryReportGate = 'passed' | 'blocked' | 'inconclusive' | 'not-evaluated';

export interface MemoryEvaluationReport {
  version: 1;
  metrics: MemoryMetrics;
  failuresByCategory: Partial<Record<MemoryFailureCategory, number>>;
  /** Failed records that omitted the required failure category. */
  uncategorizedFailureCount: number;
  invalidRecordCount: number;
  gate: MemoryReportGate;
  nextActions: string[];
  rerunPolicy: {
    automaticPromptRetuning: false;
    automaticRegexRetuning: false;
    behaviorRerunRequiresNewHypothesis: true;
  };
}

const recoveryActions: Record<MemoryFailureCategory, string> = {
  'policy-mismatch': 'inspect-scenario-and-model-behavior',
  'state-mismatch': 'inspect-writer-and-state-verifier',
  'evidence-missing': 'repair-state-capture-before-rerun',
  'verifier-failed': 'repair-or-reproduce-independent-verifier',
  'infra-inconclusive': 'rerun-infrastructure-only',
  'qualitative-only': 'report-only-no-release-gate',
  'evaluator-inconclusive': 'repair-evaluation-fixture-before-rerun',
};

export function recoveryActionForFailure(category: MemoryFailureCategory): string {
  return recoveryActions[category];
}

function failureCounts(
  records: readonly MemoryMetricRecord[],
): Partial<Record<MemoryFailureCategory, number>> {
  const counts: Partial<Record<MemoryFailureCategory, number>> = {};
  for (const record of records) {
    if (!record.failureCategory) continue;
    counts[record.failureCategory] = (counts[record.failureCategory] ?? 0) + 1;
  }
  return counts;
}

function gateFor(
  metrics: MemoryMetrics,
  failures: Partial<Record<MemoryFailureCategory, number>>,
  uncategorizedFailures: number,
  invalidRecords: number,
): MemoryReportGate {
  if (metrics.conclusiveCount === 0 && metrics.inconclusiveCount === 0) return 'not-evaluated';
  // A failure without a category is an invalid evaluator record. Never allow
  // it to disappear into a passing gate while its cause is unknown.
  if (uncategorizedFailures > 0 || invalidRecords > 0) return 'blocked';
  if (metrics.criticalForbiddenCount > 0) return 'blocked';
  if (
    (failures['policy-mismatch'] ?? 0) > 0 ||
    (failures['state-mismatch'] ?? 0) > 0 ||
    (failures['verifier-failed'] ?? 0) > 0
  )
    return 'blocked';
  if ((failures['evaluator-inconclusive'] ?? 0) > 0) return 'inconclusive';
  if (metrics.inconclusiveCount > 0) return 'inconclusive';
  return 'passed';
}

/** Aggregate state-based records without reading transcripts or changing prompts. */
export function summarizeMemoryEvaluation(
  records: readonly MemoryMetricRecord[],
): MemoryEvaluationReport {
  const metrics = calculateMemoryMetrics(records);
  const invalidRecordCount = records.filter(
    (record) =>
      ![
        'passed',
        'failed',
        'inconclusive',
        'behavior-failed',
        'evaluator-failed',
        'infra-inconclusive',
        'evaluator-inconclusive',
      ].includes(String(record.outcome)),
  ).length;
  const taintedRecordCount = records.filter(
    (record) => record.outcome === 'passed' && Boolean(record.failureCategory),
  ).length;
  const failuresByCategory = failureCounts(records);
  const uncategorizedFailures = records.filter(
    (record) =>
      (record.outcome === 'failed' ||
        record.outcome === 'behavior-failed' ||
        record.outcome === 'evaluator-failed') &&
      !record.failureCategory,
  ).length;
  const categories = Object.keys(failuresByCategory) as MemoryFailureCategory[];
  if (uncategorizedFailures > 0) categories.push('evaluator-inconclusive');
  return {
    version: 1,
    metrics,
    failuresByCategory,
    uncategorizedFailureCount: uncategorizedFailures,
    invalidRecordCount: invalidRecordCount + taintedRecordCount,
    gate: gateFor(
      metrics,
      failuresByCategory,
      uncategorizedFailures,
      invalidRecordCount + taintedRecordCount,
    ),
    nextActions: categories
      .map(recoveryActionForFailure)
      .filter((action, index, all) => all.indexOf(action) === index)
      .sort(),
    rerunPolicy: {
      automaticPromptRetuning: false,
      automaticRegexRetuning: false,
      behaviorRerunRequiresNewHypothesis: true,
    },
  };
}

function jsonFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...jsonFiles(path));
    else if (entry.isFile() && entry.name === 'run.json') files.push(path);
  }
  return files;
}

function validateRecord(
  path: string,
  record: unknown,
): asserts record is {
  expectedDecision: MemoryMetricRecord['expectedDecision'];
  actualDecision: { decision: MemoryMetricRecord['actualDecision'] };
  outcome: MemoryMetricRecord['outcome'];
  transition: MemoryMetricRecord['transition'];
  failureCategory?: MemoryFailureCategory | null;
  criticalForbidden?: boolean;
  idempotency?: MemoryMetricRecord['idempotency'];
} {
  const schema = JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'evals', 'memory', 'run.schema.json'),
      'utf8',
    ),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(record))
    throw new Error(
      `Invalid memory evaluation record ${path}: ${validate.errors?.map((error) => error.message).join('; ')}`,
    );
}

export function readMemoryEvaluationRecords(directory: string): MemoryMetricRecord[] {
  if (!statSync(directory).isDirectory())
    throw new Error(`Memory evaluation directory is not a directory: ${directory}`);
  return jsonFiles(directory).map((path) => {
    const record = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    validateRecord(path, record);
    return {
      expectedDecision: record.expectedDecision,
      actualDecision: record.actualDecision.decision,
      outcome: record.outcome,
      transition: record.transition,
      failureCategory: record.failureCategory,
      criticalForbidden: record.criticalForbidden,
      idempotency: record.idempotency,
    };
  });
}
