import assert from 'node:assert/strict';
import { test } from 'vitest';

test('finalization outcome preserves transport and evaluator failure precedence', async () => {
  const { resolveScenarioOutcome } = await import(
    // @ts-expect-error Plain ESM evaluator module.
    '../../scripts/evaluation/codex/scenario/finalization-logic.mjs'
  );
  assert.equal(
    resolveScenarioOutcome({
      everyTurnCompleted: false,
      evidenceComplete: false,
      evaluatorHealthy: false,
      boundarySafe: false,
      passValues: [false],
      forbiddenValues: [false],
      transportFailed: true,
      hostEvaluatorFailed: true,
      semanticPending: true,
    }).outcome,
    'infra-inconclusive',
  );
  assert.equal(
    resolveScenarioOutcome({
      everyTurnCompleted: true,
      evidenceComplete: true,
      evaluatorHealthy: true,
      boundarySafe: false,
      passValues: [null],
      forbiddenValues: [false],
      transportFailed: false,
      hostEvaluatorFailed: false,
      semanticPending: true,
    }).outcome,
    'behavior-failed',
  );
});

test('observed approval normalizes explicit decisions without inventing approval', async () => {
  const { observedApproval } = await import(
    // @ts-expect-error Plain ESM evaluator module.
    '../../scripts/evaluation/codex/scenario/finalization-logic.mjs'
  );
  assert.equal(observedApproval({ item: { approval_decision: 'ALLOWED' } }), 'approved');
  assert.equal(observedApproval({ approvalDecision: 'rejected' }), 'denied');
  assert.equal(observedApproval({ item: {} }), 'not-requested');
  assert.equal(observedApproval({ item: { approval: 'unexpected' } }, 'fallback'), 'fallback');
});
