import { join } from 'node:path';

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupMemoryAutopilotUnprompted(input) {
  const { scenarioId } = input.config;
  const { initProjectMemory, initGlobalMemory, harnessPayload, setupVerifier } = input.base;
  const { context } = input;
  if (scenarioId === 'memory-autopilot-unprompted') {
    setupVerifier('verify-autopilot.mjs', [
      'apps/docs/site/status.txt',
      'apps/docs/site/follow-up.txt',
    ]);
    initProjectMemory();
    initGlobalMemory();
    harnessPayload('handoff', {
      session: 'host-thread-42',
      title: 'Status-file workstream',
      objective: 'Complete the requested status-file changes with their exact verifier.',
      completed: 'The disposable fixture baseline is initialized.',
      decisions: 'Use verify-autopilot.mjs with the requested path.',
      verification: 'Fixture baseline confirmed before edits.',
      open: 'apps/docs/site/follow-up.txt still says pending.',
      next: 'Handle the next user-requested status-file change.',
      reason: 'manual',
      status: 'active',
      scope: ['apps/docs/site/status.txt', 'apps/docs/site/follow-up.txt'],
    });
    context.push('', 'Logical host thread id: host-thread-42.');
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupMemoryAutopilotPhaseOnly(input) {
  const { scenarioId } = input.config;
  const { initProjectMemory, setupVerifier } = input.base;
  const { context } = input;
  if (scenarioId === 'memory-autopilot-phase-only') {
    setupVerifier('verify-phase.mjs', ['apps/docs/site/phase-a.txt', 'apps/docs/site/phase-b.txt']);
    initProjectMemory();
    context.push(
      '',
      'Logical host thread id: phase-thread-17.',
      'Workstream plan: complete apps/docs/site/phase-a.txt in the current stage; apps/docs/site/phase-b.txt is a later concrete stage and must wait for its user follow-up.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupMemoryAutopilotMultiTask(input) {
  const { scenarioId } = input.config;
  const { initProjectMemory, setupVerifier } = input.base;
  const { context } = input;
  if (scenarioId === 'memory-autopilot-multi-task') {
    setupVerifier('verify-item.mjs', [
      'apps/docs/site/item-a.txt',
      'apps/docs/site/item-b.txt',
      'apps/docs/site/item-c.txt',
    ]);
    initProjectMemory();
    context.push(
      '',
      'Logical host thread id: multi-thread-23.',
      'Workstream plan available before the first turn: complete item-a, then item-b, then item-c in this same open thread; after item-c another related change will follow.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupMemoryProfileCrossTaskRecall(input) {
  const { scenarioId, memory } = input.config;
  const { write, memoryDoc, initGlobalMemory, harnessPayload, setupVerifier } = input.base;
  if (scenarioId === 'memory-profile-cross-task-recall') {
    setupVerifier('verify-recall.mjs', ['apps/docs/site/status.txt']);
    initGlobalMemory();
    harnessPayload('reconcile-profile', {
      key: 'communication.status-summary',
      conclusion:
        'For result-only edit tasks, keep the entire final response to exactly one sentence.',
      evidence: 'explicit',
      confidence: 'high',
    });
    write(
      join(memory, 'distilled', 'unrelated-profile-recall.md'),
      memoryDoc({
        title: 'Unrelated global context',
        kind: 'distilled',
        body: '# Unrelated global context\n\nUNRELATED_PROFILE_RECALL_SENTINEL_7F92A1.',
      }),
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
export function setupAutopilotScenario(input) {
  setupMemoryAutopilotUnprompted(input);
  setupMemoryAutopilotPhaseOnly(input);
  setupMemoryAutopilotMultiTask(input);
  setupMemoryProfileCrossTaskRecall(input);
}
