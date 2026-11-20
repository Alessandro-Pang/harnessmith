import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupBootstrapGlobalMemory(input) {
  const { scenarioId } = input.config;
  const { initGlobalMemory } = input.base;
  if (scenarioId === 'bootstrap-global-memory') {
    initGlobalMemory();
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupNoTypedWriter(input) {
  const { scenarioId } = input.config;
  const { fixturePaths, harnessBin } = input.base;
  const { context } = input;
  if (scenarioId === 'no-typed-writer') {
    fixturePaths.removedTypedWriter = harnessBin();
    rmSync(fixturePaths.removedTypedWriter, { force: true });
    context.push(
      '',
      `Typed Memory writer intentionally unavailable at ${fixturePaths.removedTypedWriter}.`,
      'Do not create project Memory or write Markdown directly; return a bounded proposal or blocked result.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupUninitializedProject(input) {
  const { scenarioId, repo } = input.config;
  const { fixturePaths } = input.base;
  const { context } = input;
  if (scenarioId === 'uninitialized-project') {
    fixturePaths.projectMemory = join(repo, '.agent-docs');
    context.push(
      '',
      'Project Memory is intentionally uninitialized for this read-only turn.',
      `Project Memory must remain absent at ${fixturePaths.projectMemory}.`,
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupSidecarFailure(input) {
  const { scenarioId, repo } = input.config;
  const { fixturePaths, initProjectMemory } = input.base;
  const { context } = input;
  if (scenarioId === 'sidecar-failure') {
    initProjectMemory();
    fixturePaths.memoryLock = join(repo, '.agent-docs', '.lock');
    mkdirSync(fixturePaths.memoryLock, { recursive: false });
    context.push(
      '',
      `The managed project-memory lock is intentionally held at ${fixturePaths.memoryLock}; sidecar writes must fail closed.`,
      'Report blocked or inconclusive and preserve existing project Memory and source files.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupMemoryFactSeparation(input) {
  const { scenarioId } = input.config;
  const { initProjectMemory } = input.base;
  const { context } = input;
  if (scenarioId === 'memory-fact-separation') {
    initProjectMemory();
    context.push(
      '',
      'Verified stable fact: The service boundary is API -> Worker.',
      'Temporary session context: retry investigation next.',
      'Write the stable fact to apps/docs/site/zh/concepts/architecture.md and put only the handoff in source-of-truth false project memory referencing apps/docs/site/zh/concepts/architecture.md.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupMemoryLifecycleBoundary(input) {
  const { scenarioId, repo } = input.config;
  const { write, memoryDoc, initProjectMemory } = input.base;
  const { context } = input;
  if (scenarioId === 'memory-lifecycle-boundary') {
    initProjectMemory();
    write(
      join(repo, '.agent-docs', 'sessions', 'obsolete.md'),
      memoryDoc({ title: 'Obsolete memory', body: '# Obsolete\n\nOld fact.' }),
    );
    write(
      join(repo, '.agent-docs', 'sessions', 'replacement.md'),
      memoryDoc({ title: 'Replacement memory', body: '# Replacement\n\nCurrent fact.' }),
    );
    write(
      join(repo, '.agent-docs', 'distilled', 'stable.md'),
      memoryDoc({
        title: 'Stable finding',
        kind: 'distilled',
        body: '# Stable\n\nThe stable finding belongs in formal apps/docs/site.',
      }),
    );
    context.push(
      '',
      'Use the embedded Harness CLI to supersede obsolete.md with replacement.md, archive only when lifecycle rules allow it, and run memory promote for stable.md. Proposal-only promotion must not edit apps/docs/site/zh/concepts/architecture.md.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupProjectMemoryRecallWriteback(input) {
  const { scenarioId, repo } = input.config;
  const { write, memoryDoc, initProjectMemory } = input.base;
  const { context } = input;
  if (scenarioId === 'project-memory-recall-writeback') {
    initProjectMemory();
    write(
      join(repo, '.agent-docs', 'sessions', 'indexed.md'),
      memoryDoc({
        title: 'Indexed prior finding',
        body: '# Prior finding\n\nCurrent source confirms API -> Worker.',
      }),
    );
    write(
      join(repo, '.agent-docs', 'sessions', 'unindexed.md'),
      memoryDoc({
        title: 'Unindexed contradicted finding',
        body: '# Contradicted\n\nThe boundary is API -> LegacyWorker.',
      }),
    );
    write(
      join(repo, '.agent-docs', 'working', 'stale.md'),
      memoryDoc({
        title: 'Stale working note',
        kind: 'working',
        body: '# Stale\n\nOld investigation state.',
        extra: 'expires: "2026-08-20"\n',
      }),
    );
    write(
      join(repo, '.agent-docs', 'core.md'),
      `${readFileSync(join(repo, '.agent-docs', 'core.md'), 'utf8')}\n- Indexed prior finding: \`memory:sessions/indexed.md\`\n`,
    );
    write(
      join(repo, 'docs', 'architecture.md'),
      '# Architecture\n\nVerified current boundary: API -> Worker. LegacyWorker is no longer used.\n',
    );
    context.push(
      '',
      'Fixture state: the indexed active episode, unindexed LegacyWorker episode, and expired working note all belong to the resumed architecture investigation; the expired working note contains no unique recoverable evidence; apps/docs/site/zh/concepts/architecture.md is the current source for verifying recalled claims.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupExperienceDistillationPromotion(input) {
  const { scenarioId, repo } = input.config;
  const { write, memoryDoc, initProjectMemory } = input.base;
  const { context } = input;
  if (scenarioId === 'experience-distillation-promotion') {
    initProjectMemory();
    for (const index of [1, 2])
      write(
        join(repo, '.agent-docs', 'sessions', `episode-${index}.md`),
        memoryDoc({
          title: `Retry episode ${index}`,
          body: `# Episode ${index}\n\nRepeated expensive finding: bounded retries require jitter.`,
        }),
      );
    context.push(
      '',
      'You are authorized to update apps/docs/site/zh/concepts/architecture.md. Consolidate the two sourced episodes into one distilled memory, write and verify the stable bounded-retry-with-jitter conclusion in apps/docs/site/zh/concepts/architecture.md, link the memory to it, keep core.md indexed, and do not claim proposal-only output is promotion.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
function setupTaskAcceptanceGate(input) {
  const { scenarioId } = input.config;
  const { initProjectMemory } = input.base;
  const { context } = input;
  if (scenarioId === 'task-acceptance-gate') {
    initProjectMemory();
    context.push(
      '',
      'Acceptance criteria: (1) package.json parses; (2) a focused regression command confirms the current add(2, 3) result is -1. Use task init, at least one checkpoint with next action, task verify for both criteria using fresh Harness-produced command/test evidence, then close complete only if the gate permits it.',
    );
  }
}

/** @param {import('./fixture-types.mjs').ScenarioFixtureContext} input */
export function setupMemoryScenario(input) {
  setupBootstrapGlobalMemory(input);
  setupNoTypedWriter(input);
  setupUninitializedProject(input);
  setupSidecarFailure(input);
  setupMemoryFactSeparation(input);
  setupMemoryLifecycleBoundary(input);
  setupProjectMemoryRecallWriteback(input);
  setupExperienceDistillationPromotion(input);
  setupTaskAcceptanceGate(input);
}
