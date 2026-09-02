import { assertNoHighConfidenceSecretInValue } from '../security/secret-hygiene.js';

const operations = ['model', 'tool', 'memory', 'task', 'policy', 'lifecycle', 'other'] as const;
const policyDecisions = ['allowed', 'denied', 'not-applicable'] as const;
const outcomes = ['completed', 'blocked', 'failed'] as const;
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const artifactDigest = /^sha256:[a-f0-9]{64}$/;
const storedEventKeys = new Set([
  'schemaVersion',
  'traceId',
  'timestamp',
  'adapter',
  'operation',
  'action',
  'policyDecision',
  'policyVersion',
  'durationMs',
  'outcome',
  'artifactDigests',
  'inputTokens',
  'outputTokens',
  'costUsd',
  'errorCode',
]);

export interface AuditEventInput {
  traceId: string;
  timestamp: string;
  operation: string;
  action: string;
  policyDecision: string;
  policyVersion: string;
  durationMs: number;
  outcome: string;
  artifactDigests: string[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  errorCode?: string;
}

export interface AuditEvent extends AuditEventInput {
  schemaVersion: 1;
  adapter: string;
}

function assertIdentifier(value: string, name: string): void {
  if (!safeIdentifier.test(value)) throw new Error(`Audit ${name} is invalid`);
}

export function validateAuditTraceId(value: string): string {
  assertIdentifier(value, 'traceId');
  return value;
}

function assertBoundedNumber(
  value: number | undefined,
  name: string,
  maximum: number,
  integer = false,
): void {
  if (value === undefined) return;
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`Audit ${name} is invalid`);
  }
}

export function validateAuditEvent(input: AuditEventInput, adapter: string): AuditEvent {
  assertNoHighConfidenceSecretInValue(input, 'Audit event');
  assertIdentifier(adapter, 'adapter');
  assertIdentifier(input.traceId, 'traceId');
  assertIdentifier(input.action, 'action');
  assertIdentifier(input.policyVersion, 'policyVersion');
  if (input.errorCode !== undefined) assertIdentifier(input.errorCode, 'errorCode');
  if (!operations.includes(input.operation as (typeof operations)[number]))
    throw new Error('Audit operation is invalid');
  if (!policyDecisions.includes(input.policyDecision as (typeof policyDecisions)[number]))
    throw new Error('Audit policyDecision is invalid');
  if (!outcomes.includes(input.outcome as (typeof outcomes)[number]))
    throw new Error('Audit outcome is invalid');
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== input.timestamp)
    throw new Error('Audit timestamp must be canonical ISO-8601 UTC');
  assertBoundedNumber(input.durationMs, 'durationMs', 7 * 24 * 60 * 60 * 1000);
  assertBoundedNumber(input.inputTokens, 'inputTokens', 1_000_000_000, true);
  assertBoundedNumber(input.outputTokens, 'outputTokens', 1_000_000_000, true);
  assertBoundedNumber(input.costUsd, 'costUsd', 1_000_000);
  if (
    !Array.isArray(input.artifactDigests) ||
    input.artifactDigests.length > 16 ||
    new Set(input.artifactDigests).size !== input.artifactDigests.length ||
    input.artifactDigests.some((digest) => !artifactDigest.test(digest))
  ) {
    throw new Error('Audit artifactDigests are invalid');
  }
  return {
    schemaVersion: 1,
    traceId: input.traceId,
    timestamp: input.timestamp,
    adapter,
    operation: input.operation,
    action: input.action,
    policyDecision: input.policyDecision,
    policyVersion: input.policyVersion,
    durationMs: input.durationMs,
    outcome: input.outcome,
    artifactDigests: input.artifactDigests,
    ...(input.inputTokens === undefined ? {} : { inputTokens: input.inputTokens }),
    ...(input.outputTokens === undefined ? {} : { outputTokens: input.outputTokens }),
    ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd }),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
  };
}

export function validateStoredAuditEvent(value: unknown): AuditEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stored audit event must be a plain object');
  }
  const candidate = value as Record<string, unknown>;
  if (Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new Error('stored audit event must be a plain object');
  }
  const unknown = Object.keys(candidate).find((key) => !storedEventKeys.has(key));
  if (unknown) throw new Error(`stored audit event has unknown key: ${unknown}`);
  if (candidate.schemaVersion !== 1) throw new Error('unsupported schemaVersion');
  return validateAuditEvent(candidate as unknown as AuditEventInput, candidate.adapter as string);
}

function countBy(events: AuditEvent[], field: 'operation' | 'outcome' | 'policyDecision') {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event[field]] = (counts[event[field]] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function summarizeAuditEvents(events: AuditEvent[]) {
  const durations = events.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
  const totalDuration = durations.reduce((sum, value) => sum + value, 0);
  const p95 = durations.length === 0 ? 0 : durations[Math.ceil(durations.length * 0.95) - 1];
  return {
    version: 1,
    eventCount: events.length,
    traceCount: new Set(events.map(({ traceId }) => traceId)).size,
    firstTimestamp: events[0]?.timestamp ?? null,
    lastTimestamp: events.at(-1)?.timestamp ?? null,
    outcomes: countBy(events, 'outcome'),
    policyDecisions: countBy(events, 'policyDecision'),
    operations: countBy(events, 'operation'),
    durationMs: {
      total: totalDuration,
      average: events.length === 0 ? 0 : Number((totalDuration / events.length).toFixed(3)),
      maximum: durations.at(-1) ?? 0,
      p95,
    },
    tokens: {
      input: events.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
      output: events.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
    },
    costUsd: Number(events.reduce((sum, event) => sum + (event.costUsd ?? 0), 0).toFixed(6)),
  };
}
