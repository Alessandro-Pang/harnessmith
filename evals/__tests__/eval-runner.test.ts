import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  type HostEvalAttempt,
  type HostEvalAttemptResult,
  runHostEvalScenarios,
} from '../../scripts/eval-runner.js';

const passed = {
  outcome: 'passed',
  termination: 'completed',
} as const satisfies HostEvalAttemptResult;

test('runner never exceeds its bounded concurrency', async () => {
  let active = 0;
  let maximumActive = 0;
  const execution = runHostEvalScenarios({
    scenarioIds: ['a', 'b', 'c', 'd'],
    concurrency: 2,
    execute: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return passed;
    },
  });

  const result = await execution;
  assert.equal(maximumActive, 2);
  assert.deepEqual(
    result.results.map(({ outcome }) => outcome),
    ['passed', 'passed', 'passed', 'passed'],
  );
});

test('runner retries transport once and opens the circuit after two consecutive failures', async () => {
  const attempts: HostEvalAttempt[] = [];
  const result = await runHostEvalScenarios({
    scenarioIds: ['unstable', 'not-started'],
    concurrency: 1,
    execute: async (attempt) => {
      attempts.push(attempt);
      return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
    },
  });

  assert.deepEqual(
    attempts.map(({ attempt }) => attempt),
    [1, 2],
  );
  assert.equal(result.circuitOpen, true);
  assert.deepEqual(result.results, [
    {
      scenarioId: 'unstable',
      outcome: 'infra-inconclusive',
      termination: 'circuit-open',
      attempts: 2,
      transportFailures: 2,
    },
    {
      scenarioId: 'not-started',
      outcome: 'infra-blocked',
      termination: 'circuit-open',
      attempts: 0,
      transportFailures: 0,
    },
  ]);
});

test('behavior and evaluator failures do not open the transport circuit', async () => {
  const outcomes: HostEvalAttemptResult[] = [
    { outcome: 'behavior-failed', termination: 'completed' },
    { outcome: 'evaluator-failed', termination: 'evaluator-failure' },
    passed,
  ];
  const result = await runHostEvalScenarios({
    scenarioIds: ['behavior', 'evaluator', 'passing'],
    concurrency: 1,
    execute: async () => outcomes.shift() ?? passed,
  });

  assert.equal(result.circuitOpen, false);
  assert.deepEqual(
    result.results.map(({ outcome }) => outcome),
    ['behavior-failed', 'evaluator-failed', 'passed'],
  );
});

test('runner classifies an executor exception as evaluator failure', async () => {
  const result = await runHostEvalScenarios({
    scenarioIds: ['evaluator-crash', 'passing'],
    concurrency: 1,
    execute: async ({ scenarioId }) => {
      if (scenarioId === 'evaluator-crash') throw new Error('evaluator crashed');
      return passed;
    },
  });

  assert.equal(result.circuitOpen, false);
  assert.deepEqual(
    result.results.map(({ outcome }) => outcome),
    ['evaluator-failed', 'passed'],
  );
});

test('runner stops starting scenarios after the matrix budget is exhausted', async () => {
  let now = 0;
  const result = await runHostEvalScenarios({
    scenarioIds: ['first', 'blocked'],
    concurrency: 1,
    scenarioBudgetMs: 100,
    matrixBudgetMs: 100,
    clock: { now: () => now },
    execute: async () => {
      now = 100;
      return passed;
    },
  });

  assert.deepEqual(
    result.results.map(({ termination }) => termination),
    ['completed', 'matrix-budget-exhausted'],
  );
});

test('runner aborts a hanging attempt at the scenario deadline', async () => {
  let aborted = false;
  const result = await runHostEvalScenarios({
    scenarioIds: ['hanging'],
    concurrency: 1,
    scenarioBudgetMs: 10,
    matrixBudgetMs: 20,
    execute: async ({ signal }) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return await new Promise<HostEvalAttemptResult>(() => undefined);
    },
  });

  assert.equal(aborted, true);
  assert.deepEqual(result.results[0], {
    scenarioId: 'hanging',
    outcome: 'infra-inconclusive',
    termination: 'scenario-budget-exhausted',
    attempts: 1,
    transportFailures: 0,
  });
});

test('runner rejects concurrency and budget values outside the contract', async () => {
  await assert.rejects(
    runHostEvalScenarios({ scenarioIds: [], concurrency: 4, execute: async () => passed }),
    /concurrency/,
  );
  await assert.rejects(
    runHostEvalScenarios({
      scenarioIds: [],
      scenarioBudgetMs: 2,
      matrixBudgetMs: 1,
      execute: async () => passed,
    }),
    /matrix budget/,
  );
  await assert.rejects(
    runHostEvalScenarios({ scenarioIds: ['duplicate', 'duplicate'], execute: async () => passed }),
    /non-empty and unique/,
  );
});
