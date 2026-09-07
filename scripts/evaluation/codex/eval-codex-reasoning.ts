import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodexMatrixOptions } from './eval-codex-options.js';
import { runReasoningScenario } from './eval-codex-reasoning-run.js';
import { getReasoningScenario } from './eval-codex-reasoning-scenarios.js';
import type { ReasoningAttempt, ReasoningResult } from './eval-codex-reasoning-types.js';

export {
  getReasoningScenario,
  reasoningScenarioManifest,
} from './eval-codex-reasoning-scenarios.js';
export type { ReasoningAttempt, ReasoningResult } from './eval-codex-reasoning-types.js';

/** Execute one scenario; retry and ordering policy remain in the unified suite. */
export async function executeReasoningScenario(
  options: CodexMatrixOptions,
  scenarioId: string,
  attempt?: ReasoningAttempt,
): Promise<ReasoningResult> {
  const result = await runReasoningScenario(
    attempt
      ? { ...options, scenarioBudgetMs: Math.min(options.scenarioBudgetMs, attempt.deadlineMs) }
      : options,
    getReasoningScenario(scenarioId),
    attempt,
  );
  mkdirSync(options.outputDir, { recursive: true });
  writeFileSync(
    join(options.outputDir, `${scenarioId}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    {
      flag: 'w',
    },
  );
  return result;
}
