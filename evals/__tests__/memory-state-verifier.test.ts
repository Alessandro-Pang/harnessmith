import { describe, expect, it } from 'vitest';
import {
  calculateMemoryMetrics,
  type MemoryMetricRecord,
} from '../../scripts/evaluation/memory/memory-metrics.js';
import {
  type MemoryFileState,
  type MemoryVerificationInput,
  verifyMemoryState,
} from '../../scripts/evaluation/memory/memory-state-verifier.js';

const state = (files: Record<string, string>): MemoryFileState => ({ files });
const input = (overrides: Partial<MemoryVerificationInput>): MemoryVerificationInput => ({
  before: state({}),
  after: state({}),
  expectedDecision: 'no-write',
  actual: { action: 'no-change' },
  ...overrides,
});

describe('verifyMemoryState', () => {
  it('accepts a real created write without inspecting natural language', () => {
    const result = verifyMemoryState(
      input({
        expectedDecision: 'write',
        actual: { action: 'created', reasonCode: 'typed-create-ready' },
        after: state({ 'profile.md': 'digest-1' }),
      }),
    );
    expect(result).toMatchObject({
      transition: 'created',
      outcome: 'passed',
      failureCategory: null,
    });
  });

  it('enforces the catalog expected action independently of the final response', () => {
    const result = verifyMemoryState(
      input({
        expectedDecision: 'write',
        expectedAction: 'created',
        actual: { action: 'updated' },
        after: state({ 'profile.md': 'digest-1' }),
      }),
    );
    expect(result).toMatchObject({ outcome: 'failed', failureCategory: 'policy-mismatch' });
  });

  it('accepts no-write only when the file state is unchanged', () => {
    const result = verifyMemoryState(
      input({
        before: state({ 'profile.md': 'digest-1' }),
        after: state({ 'profile.md': 'digest-1' }),
      }),
    );
    expect(result).toMatchObject({ transition: 'no-change', outcome: 'passed' });
  });

  it('detects policy mismatch when a forbidden write occurs', () => {
    const result = verifyMemoryState(
      input({
        expectedDecision: 'no-write',
        actual: { action: 'updated', reasonCode: 'typed-update' },
        before: state({ 'profile.md': 'digest-1' }),
        after: state({ 'profile.md': 'digest-2' }),
      }),
    );
    expect(result.outcome).toBe('failed');
    expect(result.failureCategory).toBe('policy-mismatch');
  });

  it('reports blocked writer and preserves a distinct blocked transition', () => {
    const result = verifyMemoryState(
      input({
        expectedDecision: 'blocked',
        actual: { action: 'blocked', reasonCode: 'sensitive-input' },
      }),
    );
    expect(result).toMatchObject({
      transition: 'blocked',
      outcome: 'passed',
      failureCategory: null,
    });
  });

  it('marks incomplete snapshots inconclusive instead of failing behavior', () => {
    const result = verifyMemoryState(input({ evidence: { complete: false } }));
    expect(result).toMatchObject({ outcome: 'inconclusive', failureCategory: 'evidence-missing' });
  });

  it('does not accept an action claim that contradicts the observed transition', () => {
    const result = verifyMemoryState(
      input({
        expectedDecision: 'write',
        actual: { action: 'created' },
        before: state({ 'profile.md': 'digest-1' }),
        after: state({ 'profile.md': 'digest-1' }),
      }),
    );
    expect(result).toMatchObject({ outcome: 'failed', failureCategory: 'state-mismatch' });
  });

  it('classifies qualitative, infrastructure, and verifier evidence without blaming behavior', () => {
    expect(verifyMemoryState(input({ qualitativeOnly: true }))).toMatchObject({
      outcome: 'inconclusive',
      failureCategory: 'qualitative-only',
    });
    expect(verifyMemoryState(input({ infrastructureInconclusive: true }))).toMatchObject({
      outcome: 'inconclusive',
      failureCategory: 'infra-inconclusive',
    });
    expect(
      verifyMemoryState(input({ verifier: { status: 'inconclusive', message: 'timeout' } })),
    ).toMatchObject({ outcome: 'inconclusive', failureCategory: 'infra-inconclusive' });
    expect(
      verifyMemoryState(input({ verifier: { status: 'failed', message: 'boom' } })),
    ).toMatchObject({ outcome: 'failed', failureCategory: 'verifier-failed' });
  });

  it('defers to the independent semantic state oracle', () => {
    expect(
      verifyMemoryState(input({ semantic: { status: 'inconclusive', message: 'unclear' } })),
    ).toMatchObject({ outcome: 'inconclusive', failureCategory: 'evaluator-inconclusive' });
    expect(
      verifyMemoryState(input({ semantic: { status: 'failed', message: 'wrong' } })),
    ).toMatchObject({ outcome: 'failed', failureCategory: 'state-mismatch' });
  });

  it('accepts proposed decisions and explicit unchanged replays', () => {
    expect(
      verifyMemoryState(input({ expectedDecision: 'proposed', actual: { action: 'proposed' } })),
    ).toMatchObject({ outcome: 'passed', failureCategory: null });
    expect(
      verifyMemoryState(
        input({
          actual: { action: 'unchanged' },
          before: state({ 'profile.md': 'a' }),
          after: state({ 'profile.md': 'a' }),
        }),
      ),
    ).toMatchObject({ transition: 'unchanged', outcome: 'passed' });
  });
});

describe('calculateMemoryMetrics', () => {
  const record = (overrides: Partial<MemoryMetricRecord>): MemoryMetricRecord => ({
    expectedDecision: 'write',
    actualDecision: 'write',
    outcome: 'passed',
    transition: 'created',
    ...overrides,
  });

  it('calculates write/no-write precision and recall from conclusive trials', () => {
    const metrics = calculateMemoryMetrics([
      record({}),
      record({
        expectedDecision: 'write',
        actualDecision: 'no-write',
        outcome: 'failed',
        transition: 'no-change',
      }),
      record({ expectedDecision: 'no-write', actualDecision: 'no-write', transition: 'no-change' }),
      record({
        expectedDecision: 'no-write',
        actualDecision: 'write',
        outcome: 'failed',
        transition: 'updated',
        criticalForbidden: true,
      }),
      record({
        expectedDecision: 'write',
        actualDecision: 'write',
        outcome: 'inconclusive',
        transition: 'blocked',
      }),
    ]);
    expect(metrics.write).toMatchObject({ precision: 0.5, recall: 0.5 });
    expect(metrics.noWrite).toMatchObject({ precision: 0.5, recall: 0.5 });
    expect(metrics.criticalForbiddenCount).toBe(1);
    expect(metrics.inconclusiveCount).toBe(1);
  });

  it('reports idempotency only over explicitly marked repeated writes', () => {
    const metrics = calculateMemoryMetrics([
      record({
        idempotency: { expectedUnchanged: true, actualUnchanged: true },
        transition: 'unchanged',
      }),
      record({
        idempotency: { expectedUnchanged: true, actualUnchanged: false },
        transition: 'updated',
        outcome: 'failed',
      }),
      record({ expectedDecision: 'proposed', actualDecision: 'proposed', transition: 'no-change' }),
    ]);
    expect(metrics.idempotencyRate).toBe(0.5);
  });

  it('returns null rates when no conclusive examples exist', () => {
    const metrics = calculateMemoryMetrics([record({ outcome: 'inconclusive' })]);
    expect(metrics.write).toMatchObject({ precision: null, recall: null });
    expect(metrics.noWrite).toMatchObject({ precision: null, recall: null });
    expect(metrics.idempotencyRate).toBeNull();
  });
});
