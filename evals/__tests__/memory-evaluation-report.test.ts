import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  recoveryActionForFailure,
  summarizeMemoryEvaluation,
} from '../../scripts/evaluation/memory/memory-report.js';

test('memory report separates behavior, verifier, and infrastructure failures', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'passed',
      transition: 'created',
    },
    {
      expectedDecision: 'no-write',
      actualDecision: 'write',
      outcome: 'failed',
      transition: 'updated',
      failureCategory: 'policy-mismatch',
      criticalForbidden: true,
    },
    {
      expectedDecision: 'write',
      actualDecision: 'no-write',
      outcome: 'inconclusive',
      transition: 'no-change',
      failureCategory: 'evidence-missing',
    },
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'failed',
      transition: 'created',
      failureCategory: 'verifier-failed',
    },
  ]);
  assert.equal(report.metrics.criticalForbiddenCount, 1);
  assert.deepEqual(report.failuresByCategory, {
    'policy-mismatch': 1,
    'evidence-missing': 1,
    'verifier-failed': 1,
  });
  assert.equal(report.gate, 'blocked');
  assert.equal(report.rerunPolicy.automaticPromptRetuning, false);
  assert.equal(report.rerunPolicy.automaticRegexRetuning, false);
  assert.equal(report.rerunPolicy.behaviorRerunRequiresNewHypothesis, true);
});

test('recovery action prevents prompt and regex changes for evaluator failures', () => {
  assert.equal(recoveryActionForFailure('policy-mismatch'), 'inspect-scenario-and-model-behavior');
  assert.equal(recoveryActionForFailure('state-mismatch'), 'inspect-writer-and-state-verifier');
  assert.equal(
    recoveryActionForFailure('verifier-failed'),
    'repair-or-reproduce-independent-verifier',
  );
  assert.equal(recoveryActionForFailure('infra-inconclusive'), 'rerun-infrastructure-only');
  assert.equal(recoveryActionForFailure('qualitative-only'), 'report-only-no-release-gate');
});

test('forbidden state changes remain critical even when the writer omitted typed output', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'no-write',
      actualDecision: 'no-write',
      outcome: 'failed',
      transition: 'updated',
      criticalForbidden: true,
      failureCategory: 'state-mismatch',
    },
  ]);
  assert.equal(report.metrics.criticalForbiddenCount, 1);
  assert.equal(report.gate, 'blocked');
});

test('infrastructure inconclusive trials never satisfy the release gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'no-write',
      outcome: 'infra-inconclusive',
      transition: 'no-change',
      failureCategory: 'infra-inconclusive',
    },
  ]);
  assert.equal(report.metrics.conclusiveCount, 0);
  assert.equal(report.metrics.inconclusiveCount, 1);
  assert.equal(report.gate, 'inconclusive');
});

test('evaluator-inconclusive scenarios stay out of behavior metrics and block a complete gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'passed',
      transition: 'created',
    },
    {
      expectedDecision: 'blocked',
      actualDecision: 'no-write',
      outcome: 'evaluator-inconclusive',
      transition: 'no-change',
      failureCategory: 'evaluator-inconclusive',
    },
  ]);
  assert.equal(report.metrics.conclusiveCount, 1);
  assert.equal(report.metrics.inconclusiveCount, 1);
  assert.equal(report.gate, 'inconclusive');
  assert.deepEqual(report.failuresByCategory, { 'evaluator-inconclusive': 1 });
  assert.deepEqual(report.nextActions, ['repair-evaluation-fixture-before-rerun']);
});

test('failed records without a failure category cannot pass the release gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'no-write',
      outcome: 'evaluator-failed',
      transition: 'no-change',
    },
  ]);
  assert.equal(report.gate, 'blocked');
  assert.equal(report.uncategorizedFailureCount, 1);
  assert.deepEqual(report.nextActions, ['repair-evaluation-fixture-before-rerun']);
});

test('generic failed outcome without category cannot disappear from the gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'failed',
      transition: 'created',
    },
  ]);
  assert.equal(report.gate, 'blocked');
});

test('unknown runtime outcomes cannot enter a passing report', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'unknown' as 'passed',
      transition: 'created',
    },
  ]);
  assert.notEqual(report.gate, 'passed');
});

test('passed records carrying failure evidence cannot pass the gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'passed',
      transition: 'created',
      failureCategory: 'evidence-missing',
    },
  ]);
  assert.notEqual(report.gate, 'passed');
});
