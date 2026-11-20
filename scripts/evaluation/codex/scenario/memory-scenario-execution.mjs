import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateRepositoryForbiddenContract,
  snapshotRegularFileTree,
} from '../support/safe-snapshot.mjs';
import { lastTypedMemoryOutput } from './memory-evidence.mjs';
import { runMemoryHostTurns } from './memory-host.mjs';
import { isMemoryAction } from './memory-types.mjs';

/**
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').prepareMemoryScenario>} setup
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').initializeMemoryFixture>} fixture
 */
export async function executeMemoryScenario(setup, fixture) {
  const { repo, scope, snapshot, semanticState, scenario, variant, recordDir } = setup;
  const initial = snapshot(scope);
  const semanticInitial = semanticState();
  // No `.lock` exemption: Harness locks are empty proper-lockfile directories (invisible to a
  // regular-file snapshot), and memory-scope locks live under the allowed prefixes below.
  // Ordinary `.lock` files, directories, and symlinks must stay subject to the boundary.
  const initialRepo = snapshotRegularFileTree(repo);
  const startedAt = new Date().toISOString();
  const configuredDeadline = Number(process.env.HARNESS_EVAL_DEADLINE_MS ?? '0');
  const configuredBudget = Number(process.env.HARNESS_EVAL_SCENARIO_BUDGET_MS ?? '900000');
  const remainingMs =
    configuredDeadline > 0 ? Math.max(1, configuredDeadline - Date.now()) : configuredBudget;
  const scenarioSignal = AbortSignal.timeout(Math.min(900_000, remainingMs));
  const prompts = Array.from(
    { length: Math.max(1, scenario.setup.taskCount) },
    () => scenario.promptVariants[variant],
  );
  const outputs = await runMemoryHostTurns({
    model: setup.model,
    repo,
    memory: setup.memory,
    env: fixture.env,
    scenarioSignal,
    prompts,
    recordDir,
  });
  const final = snapshot(scope);
  const semanticFinal = semanticState();
  const finalRepo = snapshotRegularFileTree(repo);
  const forbiddenContract = evaluateRepositoryForbiddenContract({
    before: initialRepo,
    after: finalRepo,
    allowedPrefixes: ['.agent-docs/', '.harness-eval-tmp/'],
  });
  writeFileSync(
    join(recordDir, 'states.json'),
    JSON.stringify({ initial, final, semanticInitial, semanticFinal }, null, 2),
  );
  const changedPaths = Object.keys({ ...initial.files, ...final.files })
    .filter((path) => initial.files[path] !== final.files[path])
    .sort();
  const typed = lastTypedMemoryOutput(outputs);
  const inferredAction = changedPaths.length
    ? Object.keys(initial.files).length === 0
      ? 'created'
      : 'updated'
    : 'no-change';
  const typedAction = isMemoryAction(typed?.action) ? typed.action : null;
  const action = typedAction ?? inferredAction;
  return {
    startedAt,
    outputs,
    initial,
    final,
    semanticInitial,
    semanticFinal,
    forbiddenContract,
    changedPaths,
    typed,
    action,
  };
}
