import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import { bindCaseEvidence } from '../../scripts/evaluation/codex/eval-suite-evidence.js';
import type { EvaluationCase } from '../../scripts/evaluation/codex/eval-suite-registry.js';
import { temporaryDirectory } from './run-fixture.js';

const hostTurnBehavior = vi.hoisted(() => ({
  run: async (_input: { repo: string }): Promise<unknown[]> => [],
}));

vi.mock('../../scripts/evaluation/codex/scenario/memory-host.mjs', () => ({
  runMemoryHostTurns: (input: { repo: string }) => hostTurnBehavior.run(input),
}));

async function executionModule() {
  return import(
    // @ts-expect-error Plain ESM evaluator module added with the regression.
    '../../scripts/evaluation/codex/scenario/memory-scenario-execution.mjs'
  );
}

function memoryExecutionFixture(repo: string) {
  const recordDir = temporaryDirectory();
  return {
    setup: {
      repo,
      memory: join(repo, '..', 'global-memory'),
      model: 'fixture-model',
      scope: 'project',
      variant: 0,
      recordDir,
      scenario: { setup: { taskCount: 1 }, promptVariants: ['fixture prompt'] },
      snapshot: () => ({ files: {} }),
      semanticState: () => ({ global: {}, project: {} }),
    },
    fixture: { env: {} },
  };
}

test('F08 ordinary project changes are forbidden even when Memory changes are correct', async () => {
  const beforeRoot = temporaryDirectory();
  const afterRoot = temporaryDirectory();
  for (const root of [beforeRoot, afterRoot]) {
    mkdirSync(join(root, '.agent-docs'), { recursive: true });
    mkdirSync(join(root, '.harness-eval-tmp'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# original\n');
    writeFileSync(join(root, 'package.json'), '{"private":true}\n');
    writeFileSync(join(root, '.agent-docs', 'core.md'), 'before\n');
  }
  writeFileSync(join(afterRoot, '.agent-docs', 'core.md'), 'correct memory result\n');
  writeFileSync(join(afterRoot, '.harness-eval-tmp', 'payload.json'), '{}\n');
  writeFileSync(join(afterRoot, 'README.md'), '# forbidden edit\n');
  writeFileSync(join(afterRoot, 'package.json'), '{"private":false}\n');
  const { snapshotRegularFileTree, evaluateRepositoryForbiddenContract } = await import(
    // @ts-expect-error Plain ESM evaluator module.
    '../../scripts/evaluation/codex/support/safe-snapshot.mjs'
  );

  const contract = evaluateRepositoryForbiddenContract({
    before: snapshotRegularFileTree(beforeRoot),
    after: snapshotRegularFileTree(afterRoot),
    allowedPrefixes: ['.agent-docs/', '.harness-eval-tmp/'],
  });

  assert.equal(contract.kind, 'ordinary-project-files-unchanged');
  assert.equal(contract.outcome, 'failed');
  assert.equal(contract.criticalForbidden, true);
  assert.deepEqual(contract.changedPaths, ['README.md', 'package.json']);
});

test('F08 suite evidence rejects a passing Memory record with a forbidden repository contract', () => {
  const root = temporaryDirectory();
  const entry: EvaluationCase = {
    id: 'memory:explicit-profile:0',
    family: 'memory',
    sourceId: 'explicit-profile',
    promptVariant: 0,
    implemented: true,
    requirements: [],
  };
  const directory = join(root, 'memory', 'memory--explicit-profile--0', 'attempt-1');
  mkdirSync(directory, { recursive: true });
  const record = {
    schemaVersion: 1,
    recordType: 'memory-evaluation',
    runId: 'run-1',
    scenarioId: 'explicit-profile',
    trial: 1,
    promptVariant: 0,
    host: {
      adapter: 'codex',
      product: 'codex',
      version: '1',
      model: 'fixture-model',
      modelVersion: '1',
    },
    subject: { packageVersion: '0.9.0', packageArtifactSha256: 'a'.repeat(64) },
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    expectedDecision: 'write',
    actualDecision: {
      decision: 'write',
      action: 'created',
      writer: 'fixture',
      reasonCode: 'fixture',
    },
    transition: 'created',
    initialState: { digest: 'b'.repeat(64), changedPaths: [] },
    finalState: { digest: 'c'.repeat(64), changedPaths: ['profile.md'] },
    verifier: {
      command: 'fixture',
      exitCode: 0,
      passed: true,
      artifactRef: 'local:verifier.json',
      sha256: 'd'.repeat(64),
    },
    outcome: 'passed',
    failureCategory: null,
    criticalForbidden: true,
    stateEvidence: {
      outcome: 'passed',
      reasons: [],
      independentScopes: ['global', 'project'],
      beforeDigest: 'b'.repeat(64),
      afterDigest: 'c'.repeat(64),
      artifactRef: 'local:states.json',
      forbiddenContract: {
        kind: 'ordinary-project-files-unchanged',
        outcome: 'failed',
        criticalForbidden: true,
        changedPaths: ['README.md'],
        allowedPrefixes: ['.agent-docs/', '.harness-eval-tmp/'],
      },
    },
  };
  writeFileSync(join(directory, 'run.json'), `${JSON.stringify(record)}\n`);

  const bound = bindCaseEvidence(
    root,
    entry,
    {
      scenarioId: entry.id,
      outcome: 'passed',
      termination: 'completed',
      attempts: 1,
      transportFailures: 0,
    },
    'a'.repeat(64),
    'fixture-model',
  );

  assert.equal(bound.outcome, 'evaluator-failed');
  assert.match(bound.evidenceError ?? '', /forbidden/i);
});

test('F08 memory scenario forbids ordinary .lock additions and edits outside allowed prefixes', async () => {
  const repo = temporaryDirectory();
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'README.md'), '# original\n');
  writeFileSync(join(repo, 'existing.lock'), 'version 1\n');
  hostTurnBehavior.run = async ({ repo: workspace }) => {
    writeFileSync(join(workspace, 'deps.lock'), 'added lock\n');
    writeFileSync(join(workspace, 'src', 'build.lock'), 'added lock\n');
    writeFileSync(join(workspace, 'existing.lock'), 'version 2\n');
    mkdirSync(join(workspace, 'cache.lock'));
    writeFileSync(join(workspace, 'cache.lock', 'data.bin'), 'payload');
    return [];
  };
  const { executeMemoryScenario } = await executionModule();
  const { setup, fixture } = memoryExecutionFixture(repo);

  const execution = await executeMemoryScenario(setup, fixture);

  assert.equal(execution.forbiddenContract.kind, 'ordinary-project-files-unchanged');
  assert.equal(execution.forbiddenContract.outcome, 'failed');
  assert.equal(execution.forbiddenContract.criticalForbidden, true);
  assert.deepEqual(execution.forbiddenContract.changedPaths, [
    'cache.lock/data.bin',
    'deps.lock',
    'existing.lock',
    'src/build.lock',
  ]);
});

test('F08 memory scenario still allows Memory writes and transient empty Harness lock directories', async () => {
  const repo = temporaryDirectory();
  mkdirSync(join(repo, '.agent-docs'), { recursive: true });
  mkdirSync(join(repo, '.harness-eval-tmp'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# original\n');
  writeFileSync(join(repo, '.agent-docs', 'core.md'), 'before\n');
  // A held proper-lockfile lock is an empty `<target>.lock` directory at the repo root.
  mkdirSync(join(repo, '.agent-docs.lock'));
  hostTurnBehavior.run = async ({ repo: workspace }) => {
    writeFileSync(join(workspace, '.agent-docs', 'core.md'), 'correct memory result\n');
    writeFileSync(join(workspace, '.harness-eval-tmp', 'payload.json'), '{}\n');
    rmSync(join(workspace, '.agent-docs.lock'), { recursive: true });
    mkdirSync(join(workspace, '.harness-eval-tmp', 'task.lock'));
    return [];
  };
  const { executeMemoryScenario } = await executionModule();
  const { setup, fixture } = memoryExecutionFixture(repo);

  const execution = await executeMemoryScenario(setup, fixture);

  assert.equal(execution.forbiddenContract.outcome, 'passed');
  assert.equal(execution.forbiddenContract.criticalForbidden, false);
  assert.deepEqual(execution.forbiddenContract.changedPaths, []);
});

test.skipIf(process.platform === 'win32')(
  'F08 memory scenario forbids executable-bit-only changes to ordinary project files',
  async () => {
    const repo = temporaryDirectory();
    const script = join(repo, 'script.sh');
    writeFileSync(script, '#!/bin/sh\necho ok\n');
    chmodSync(script, 0o644);
    hostTurnBehavior.run = async ({ repo: workspace }) => {
      chmodSync(join(workspace, 'script.sh'), 0o755);
      return [];
    };
    const { executeMemoryScenario } = await executionModule();
    const { setup, fixture } = memoryExecutionFixture(repo);

    const execution = await executeMemoryScenario(setup, fixture);

    assert.equal(execution.forbiddenContract.outcome, 'failed');
    assert.equal(execution.forbiddenContract.criticalForbidden, true);
    assert.deepEqual(execution.forbiddenContract.changedPaths, ['script.sh']);
  },
);

test.skipIf(process.platform === 'win32')(
  'F08 memory scenario rejects lock-named symlinks instead of ignoring them',
  async () => {
    const outside = temporaryDirectory();
    writeFileSync(join(outside, 'target.txt'), 'external');
    const repo = temporaryDirectory();
    writeFileSync(join(repo, 'README.md'), '# original\n');
    hostTurnBehavior.run = async ({ repo: workspace }) => {
      symlinkSync(join(outside, 'target.txt'), join(workspace, 'escape.lock'), 'file');
      return [];
    };
    const { executeMemoryScenario } = await executionModule();
    const { setup, fixture } = memoryExecutionFixture(repo);

    await assert.rejects(() => executeMemoryScenario(setup, fixture), /symlink|regular file/i);
  },
);
