import type {
  ExpectedMemoryDecision,
  MemoryFailureCategory,
  MemoryStateTransition,
  MemoryVerificationOutcome,
} from './memory-state-verifier.js';

export interface MemoryMetricRecord {
  expectedDecision: ExpectedMemoryDecision;
  actualDecision: 'write' | 'no-write' | 'proposed' | 'blocked';
  outcome:
    | MemoryVerificationOutcome
    | 'behavior-failed'
    | 'evaluator-failed'
    | 'infra-inconclusive'
    | 'evaluator-inconclusive';
  transition: MemoryStateTransition;
  failureCategory?: MemoryFailureCategory | null;
  /** Set for a policy-critical negative case; violations are counted separately. */
  criticalForbidden?: boolean;
  /** Set for a repeated-write/idempotency trial. */
  idempotency?: { expectedUnchanged: boolean; actualUnchanged: boolean };
}

export interface MemoryRate {
  precision: number | null;
  recall: number | null;
  truePositives: number;
  predictedPositive: number;
  expectedPositive: number;
}

export interface MemoryMetrics {
  write: MemoryRate;
  noWrite: MemoryRate;
  criticalForbiddenCount: number;
  idempotencyRate: number | null;
  idempotency: { correct: number; total: number };
  conclusiveCount: number;
  inconclusiveCount: number;
}

function rate(
  expected: ExpectedMemoryDecision,
  actual: MemoryMetricRecord['actualDecision'],
  records: readonly MemoryMetricRecord[],
): MemoryRate {
  const relevant = records.filter((record) => !isInconclusive(record.outcome));
  const truePositives = relevant.filter(
    (record) => record.expectedDecision === expected && record.actualDecision === actual,
  ).length;
  const predictedPositive = relevant.filter((record) => record.actualDecision === actual).length;
  const expectedPositive = relevant.filter((record) => record.expectedDecision === expected).length;
  return {
    precision: predictedPositive === 0 ? null : truePositives / predictedPositive,
    recall: expectedPositive === 0 ? null : truePositives / expectedPositive,
    truePositives,
    predictedPositive,
    expectedPositive,
  };
}

function isInconclusive(outcome: MemoryMetricRecord['outcome']): boolean {
  return (
    outcome === 'inconclusive' ||
    outcome === 'infra-inconclusive' ||
    outcome === 'evaluator-inconclusive'
  );
}

/** Aggregate state-based Memory metrics; inconclusive trials never enter a rate denominator. */
export function calculateMemoryMetrics(records: readonly MemoryMetricRecord[]): MemoryMetrics {
  const conclusive = records.filter((record) => !isInconclusive(record.outcome));
  const inconclusive = records.length - conclusive.length;
  const idempotencyRecords = conclusive.filter((record) => record.idempotency !== undefined);
  const idempotencyCorrect = idempotencyRecords.filter((record) => {
    const result = record.idempotency;
    return result !== undefined && result.actualUnchanged === result.expectedUnchanged;
  }).length;
  const forbidden = conclusive.filter((record) => {
    const explicitlyCritical = record.criticalForbidden === true;
    const implicitForbidden =
      record.expectedDecision !== 'write' && record.actualDecision === 'write';
    return explicitlyCritical || implicitForbidden;
  }).length;
  return {
    write: rate('write', 'write', records),
    noWrite: rate('no-write', 'no-write', records),
    criticalForbiddenCount: forbidden,
    idempotencyRate:
      idempotencyRecords.length === 0 ? null : idempotencyCorrect / idempotencyRecords.length,
    idempotency: { correct: idempotencyCorrect, total: idempotencyRecords.length },
    conclusiveCount: conclusive.length,
    inconclusiveCount: inconclusive,
  };
}
