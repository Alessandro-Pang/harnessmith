import assert from 'node:assert/strict';
import { test } from 'vitest';

async function support() {
  return import(
    // @ts-expect-error The tracked evaluator support module is intentionally plain ESM.
    '../../scripts/eval-codex-matrix-support.mjs'
  );
}

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
  assert.equal(containsApiWorkerBoundary('当前架构边界已核实为 API -> LegacyWorker。'), false);
  assert.equal(containsApiWorkerBoundary('历史结论：当前架构边界已核实为 API -> Worker。'), false);
  assert.equal(containsApiWorkerBoundary('API -> Worker 已不再是当前边界。'), false);
});

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
