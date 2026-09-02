import assert from 'node:assert/strict';
import {
  type HostEvalAttemptResult,
  runHostEvalScenarios,
} from '../../scripts/evaluation/eval-runner.js';

const passed = { outcome: 'passed', termination: 'completed' } as const;

const parallel = await runHostEvalScenarios({
  scenarioIds: ['a', 'b', 'c'],
  execute: async () => passed,
});
assert.deepEqual(
  parallel.results.map(({ outcome }) => outcome),
  ['passed', 'passed', 'passed'],
);

const transportAttempts: number[] = [];
const circuit = await runHostEvalScenarios({
  scenarioIds: ['unstable', 'blocked'],
  concurrency: 1,
  execute: async ({ attempt }) => {
    transportAttempts.push(attempt);
    return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
  },
});
assert.deepEqual(transportAttempts, [1, 2]);
assert.equal(circuit.circuitOpen, true);

let now = 0;
const matrix = await runHostEvalScenarios({
  scenarioIds: ['first', 'blocked'],
  concurrency: 1,
  scenarioBudgetMs: 5,
  matrixBudgetMs: 5,
  clock: { now: () => now },
  execute: async () => {
    now = 5;
    return passed;
  },
});
assert.equal(matrix.results[1]?.termination, 'matrix-budget-exhausted');

let aborted = false;
const timeout = await runHostEvalScenarios({
  scenarioIds: ['hanging'],
  concurrency: 1,
  scenarioBudgetMs: 1,
  matrixBudgetMs: 2,
  execute: async ({ signal }) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
    return await new Promise<HostEvalAttemptResult>(() => undefined);
  },
});
assert.equal(aborted, true);
assert.equal(timeout.results[0]?.termination, 'scenario-budget-exhausted');

const evaluator = await runHostEvalScenarios({
  scenarioIds: ['crash'],
  execute: async () => {
    throw new Error('fixture evaluator failure');
  },
});
assert.equal(evaluator.results[0]?.outcome, 'evaluator-failed');

await assert.rejects(
  runHostEvalScenarios({ scenarioIds: [], concurrency: 0, execute: async () => passed }),
  /concurrency/,
);
await assert.rejects(
  runHostEvalScenarios({ scenarioIds: [], scenarioBudgetMs: 0, execute: async () => passed }),
  /scenario budget/,
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
  runHostEvalScenarios({ scenarioIds: ['', ''], execute: async () => passed }),
  /non-empty and unique/,
);
