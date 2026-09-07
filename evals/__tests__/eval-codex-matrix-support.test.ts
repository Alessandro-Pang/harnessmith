import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { temporaryDirectory } from './run-fixture.js';

async function support() {
  return import(
    // @ts-expect-error The tracked evaluator support module is intentionally plain ESM.
    '../../scripts/evaluation/codex/eval-codex-support.mjs'
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

test('multi-task checkpoint proof starts after the second verified task', async () => {
  const { multiTaskCheckpointReplacementIsProven } = await support();
  const afterSecond = {
    path: '.agent-docs/sessions/2026/08/31/multi-thread-23.md',
    digest: 'second',
    reason: 'multi-task',
  };
  const afterThird = {
    path: afterSecond.path,
    digest: 'third',
    reason: 'multi-task',
  };

  assert.equal(
    multiTaskCheckpointReplacementIsProven({
      afterSecond,
      afterThird,
      allVerifiersPassed: true,
    }),
    true,
  );
  assert.equal(
    multiTaskCheckpointReplacementIsProven({
      afterSecond,
      afterThird: { ...afterThird, digest: afterSecond.digest },
      allVerifiersPassed: true,
    }),
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

test('ungraded semantics stay inconclusive after mechanical evidence passes', async () => {
  const { evaluateScenarioAssertions } = await support();
  const result = evaluateScenarioAssertions({
    scenario: {
      pass: ['Persists a profile with the correct meaning'],
      forbidden: ['Does not change unrelated files'],
      semanticReviewAssertions: ['pass-1'],
    },
    passes: [true],
    forbiddens: [true],
  });
  assert.deepEqual(result.passValues, [null]);
  assert.deepEqual(result.forbiddenValues, [true]);
  assert.equal(result.semanticReviewRequests[0].assertionId, 'pass-1');
  assert.equal(
    result.semanticReviewRequests[0].criterion,
    'Persists a profile with the correct meaning',
  );
  assert.equal(result.mechanicalFailure, false);
});

test('missing mechanical evidence remains a failure while semantics await review', async () => {
  const { evaluateScenarioAssertions } = await support();
  const result = evaluateScenarioAssertions({
    scenario: {
      pass: ['Persists a profile with the correct meaning'],
      forbidden: ['Does not announce internal memory work'],
      semanticReviewAssertions: ['pass-1', 'forbidden-1'],
    },
    passes: [false],
    forbiddens: [null],
  });
  assert.deepEqual(result.passValues, [false]);
  assert.deepEqual(result.forbiddenValues, [null]);
  assert.equal(result.mechanicalFailure, true);
  assert.equal(result.semanticReviewRequests.length, 2);
});

test('unregistered semantic requirements cannot be silently dropped', async () => {
  const { evaluateScenarioAssertions } = await support();
  assert.throws(
    () =>
      evaluateScenarioAssertions({
        scenario: { pass: ['A requirement'], forbidden: ['A boundary'] },
        passes: [null],
        forbiddens: [true],
      }),
    /unregistered semantic requirement/,
  );
  assert.throws(
    () =>
      evaluateScenarioAssertions({
        scenario: {
          pass: ['A requirement'],
          forbidden: ['A boundary'],
          semanticReviewAssertions: ['pass-2'],
        },
        passes: [true],
        forbiddens: [true],
      }),
    /unknown semantic assertion/,
  );
});

test('natural-language phrase graders are no longer exported', async () => {
  const module = await support();
  for (const name of [
    'pureSignalResponseComplies',
    'ordinaryPreferenceResponseIsOpaque',
    'responseSeparatesAssessmentFromAction',
    'isRoutineMemoryAnnouncement',
    'isRoutineMemoryMaintenanceDisclosure',
  ])
    assert.equal(module[name], undefined, name);
});
