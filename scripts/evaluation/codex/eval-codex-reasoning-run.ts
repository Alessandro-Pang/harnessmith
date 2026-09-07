import { executeMemoryHostTurn } from '../memory/memory-host-runtime.js';
import type { CodexMatrixOptions } from './eval-codex-options.js';
import { buildReasoningResult } from './eval-codex-reasoning-observer.js';
import { prepareReasoningFixture } from './eval-codex-reasoning-setup.js';
import type {
  ReasoningAttempt,
  ReasoningResult,
  ReasoningScenario,
} from './eval-codex-reasoning-types.js';

export async function runReasoningScenario(
  options: CodexMatrixOptions,
  scenario: ReasoningScenario,
  attempt?: ReasoningAttempt,
): Promise<ReasoningResult> {
  const fixture = prepareReasoningFixture(options, scenario);
  const started = await executeMemoryHostTurn({
    workspace: fixture.repo,
    memoryParent: fixture.memory,
    model: options.model,
    prompt: scenario.prompt,
    env: fixture.env,
    signal: attempt?.signal ?? AbortSignal.timeout(options.scenarioBudgetMs),
  });
  return buildReasoningResult(scenario, fixture.repo, started);
}
