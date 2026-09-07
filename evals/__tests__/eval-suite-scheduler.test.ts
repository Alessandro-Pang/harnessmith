import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  runEvaluationSuite,
  summarizeSuiteResults,
} from '../../scripts/evaluation/codex/eval-suite-scheduler.js';

const ids = ['behavior:a', 'memory:b:0', 'reasoning:c'];

test('one scheduler shares circuit and deadline across all evaluator families', async () => {
  const calls: string[] = [];
  const result = await runEvaluationSuite({
    requiredIds: ids,
    scenarioIds: ids,
    concurrency: 1,
    scenarioBudgetMs: 1000,
    matrixBudgetMs: 2000,
    execute: async (attempt) => {
      calls.push(attempt.scenarioId);
      return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
    },
  });
  assert.deepEqual(calls, ['behavior:a', 'behavior:a']);
  assert.equal(result.circuitOpen, true);
  assert.deepEqual(
    result.results.map((r) => r.outcome),
    ['infra-inconclusive', 'infra-blocked', 'infra-blocked'],
  );
});

test('behavior or semantic failure is never retried', async () => {
  const calls: string[] = [];
  const result = await runEvaluationSuite({
    requiredIds: ids,
    scenarioIds: ids,
    concurrency: 1,
    scenarioBudgetMs: 1000,
    matrixBudgetMs: 2000,
    execute: async (attempt) => {
      calls.push(attempt.scenarioId);
      return { outcome: 'behavior-failed', termination: 'completed' };
    },
  });
  assert.deepEqual(calls, ids);
  assert.equal(summarizeSuiteResults(ids, result.results), 'failed');
});

test('missing, duplicate, unknown or empty results cannot pass the complete suite', async () => {
  assert.equal(summarizeSuiteResults(ids, []), 'inconclusive');
  const record = {
    scenarioId: ids[0],
    outcome: 'passed' as const,
    termination: 'completed' as const,
    attempts: 1,
    transportFailures: 0,
  };
  assert.equal(summarizeSuiteResults(ids, [record]), 'inconclusive');
  assert.equal(summarizeSuiteResults(ids, [record, record, record]), 'failed');
  assert.equal(summarizeSuiteResults(ids, [{ ...record, scenarioId: 'unknown' }]), 'failed');
  await assert.rejects(
    runEvaluationSuite({
      requiredIds: ids,
      scenarioIds: [ids[0]],
      execute: async () => ({ outcome: 'passed', termination: 'completed' }),
    }),
    /complete/,
  );
});

test('pending semantic review is not a behavior failure or pass', async () => {
  const result = await runEvaluationSuite({
    requiredIds: ids,
    scenarioIds: ids,
    execute: async () => ({
      outcome: 'evaluator-inconclusive',
      termination: 'semantic-review-required',
    }),
  });
  assert.equal(summarizeSuiteResults(ids, result.results), 'inconclusive');
  assert.ok(result.results.every((r) => r.attempts === 1));
});
