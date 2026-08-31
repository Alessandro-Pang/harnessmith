import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { temporaryDirectory } from './run-fixture.js';

async function support() {
  return import(
    // @ts-expect-error The tracked evaluator support module is intentionally plain ESM.
    '../../scripts/eval-codex-matrix-support.mjs'
  );
}

test('structured Codex capacity failures remain retryable transport failures', async () => {
  const { evaluateCodexTurnCompletion } = await support();
  const completion = evaluateCodexTurnCompletion({
    status: 1,
    signal: null,
    error: 'evaluator-failure:host-exit',
    stderr: '',
    stdout:
      '{"type":"turn.failed","error":{"message":"Selected model is at capacity. Please try a different model."}}\n',
  });

  assert.equal(completion.completed, false);
  assert.equal(completion.transportFailure, true);
});

test('scenario aggregation preserves completion-classified transport failures', async () => {
  const { classifyCodexScenarioHostFailures } = await support();
  const classification = classifyCodexScenarioHostFailures([
    {
      result: {
        captureKind: 'evaluator-failure',
        error: 'evaluator-failure:host-exit',
      },
      completion: { transportFailure: true },
    },
  ]);

  assert.deepEqual(classification, {
    transportFailed: true,
    hostEvaluatorFailed: false,
  });
});

test('scenario aggregation preserves genuine evaluator failures', async () => {
  const { classifyCodexScenarioHostFailures } = await support();
  const classification = classifyCodexScenarioHostFailures([
    {
      result: {
        captureKind: 'evaluator-failure',
        error: 'evaluator-failure:host-exit',
      },
      completion: { transportFailure: false },
    },
  ]);

  assert.deepEqual(classification, {
    transportFailed: false,
    hostEvaluatorFailed: true,
  });
});

test('explicit profile controls accept equivalent Markdown audit tables', async () => {
  const { isRoutineMemoryAnnouncement } = await support();
  const message = [
    '| action | path | validation |',
    '|---|---|---|',
    '| forgotten | `global-memory/memory/profile.md` | Harness returned `updated` |',
  ].join('\n');

  assert.equal(
    isRoutineMemoryAnnouncement({
      turnLabel: 'forget-profile',
      turnKind: 'user',
      message,
      beforeMemoryMutation: false,
      hasRoutineMemoryMutation: true,
    }),
    false,
  );
});

test('code-review profile keys accept stable review dimensions only', async () => {
  const { isCodeReviewProfileKey } = await support();

  assert.equal(isCodeReviewProfileKey('review.ordering', 'communication.status-summary'), true);
  assert.equal(
    isCodeReviewProfileKey('engineering.code-review-order', 'communication.status-summary'),
    true,
  );
  assert.equal(
    isCodeReviewProfileKey('identity.current-role', 'communication.status-summary'),
    false,
  );
  assert.equal(isCodeReviewProfileKey('Review.Ordering', 'communication.status-summary'), false);
  assert.equal(
    isCodeReviewProfileKey('communication.status-summary', 'communication.status-summary'),
    false,
  );
});

test('resumed Codex turns retain their additional writable roots through config', async () => {
  const { buildCodexTurn } = await support();
  const args = buildCodexTurn({
    threadId: '01900000-0000-7000-8000-000000000001',
    model: 'gpt-5.6-sol',
    repo: '/tmp/repo',
    writable: true,
    additionalDirs: ['/tmp/global-memory', '/tmp/personal-data'],
  });

  assert.deepEqual(args.slice(0, 3), ['exec', 'resume', '--json']);
  assert.ok(args.includes('sandbox_mode="workspace-write"'));
  assert.ok(
    args.includes(
      'sandbox_workspace_write.writable_roots=["/tmp/global-memory","/tmp/personal-data"]',
    ),
  );
});

test('verified API Worker boundary accepts equivalent assertions but rejects stale claims', async () => {
  const { containsApiWorkerBoundary } = await support();

  assert.equal(
    containsApiWorkerBoundary(
      '当前架构边界已核实为 `API -> Worker`；`LegacyWorker` 已不再使用。依据是当前事实源。',
    ),
    true,
  );
  assert.equal(
    containsApiWorkerBoundary('当前架构边界为 **API → Worker**，`LegacyWorker` 已不再使用。'),
    true,
  );
  assert.equal(containsApiWorkerBoundary('当前架构边界已核实为 API -> LegacyWorker。'), false);
  assert.equal(containsApiWorkerBoundary('历史结论：当前架构边界已核实为 API -> Worker。'), false);
  assert.equal(containsApiWorkerBoundary('API -> Worker 已不再是当前边界。'), false);
});

test.skipIf(process.platform === 'win32')(
  'checkpoint output identity accepts canonical aliases of the same persisted file',
  async () => {
    const { checkpointIdempotencyIsProven } = await support();
    const directory = temporaryDirectory();
    const target = join(directory, 'target');
    const alias = join(directory, 'alias');
    mkdirSync(target);
    writeFileSync(join(target, 'memory.md'), 'persisted\n');
    symlinkSync(target, alias, 'dir');
    const output = {
      version: 1,
      action: 'updated',
      kind: 'episode',
      path: join(alias, 'memory.md'),
      reference: 'memory:sessions/x',
    };

    assert.equal(
      checkpointIdempotencyIsProven({
        followCommandExact: true,
        repeatedCommandExact: true,
        samePayloadPath: true,
        samePayloadSha: true,
        followOutput: output,
        followOutputObserved: true,
        repeatedOutput: { ...output, action: 'unchanged' },
        repeatedOutputObserved: true,
        expectedPath: join(target, 'memory.md'),
        expectedReference: 'memory:sessions/x',
        preToFollowChanged: true,
        followToRepeatUnchanged: true,
        projectDigestUnchanged: true,
      }),
      true,
    );
  },
);

test('checkpoint idempotency accepts only state-proven unobserved replay', async () => {
  const { checkpointIdempotencyIsProven } = await support();
  const baseline = {
    followCommandExact: true,
    repeatedCommandExact: true,
    samePayloadPath: true,
    samePayloadSha: true,
    followOutput: {
      version: 1,
      action: 'updated',
      kind: 'episode',
      path: '/memory.md',
      reference: 'memory:sessions/x',
    },
    followOutputObserved: true,
    repeatedOutput: null,
    repeatedOutputObserved: false,
    expectedPath: '/memory.md',
    expectedReference: 'memory:sessions/x',
    preToFollowChanged: true,
    followToRepeatUnchanged: true,
    projectDigestUnchanged: true,
  };

  assert.equal(checkpointIdempotencyIsProven(baseline), true);
  assert.equal(checkpointIdempotencyIsProven({ ...baseline, repeatedOutputObserved: true }), false);
  assert.equal(
    checkpointIdempotencyIsProven({ ...baseline, followToRepeatUnchanged: false }),
    false,
  );
});
