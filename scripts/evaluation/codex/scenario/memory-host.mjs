import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { executeMemoryHostTurn } from '../../memory/memory-host-runtime.ts';
import { sanitizeAndBoundArtifact } from '../support/artifacts.mjs';
import { evaluateCodexTurnCompletion } from '../support/codex-completion.ts';

/**
 * @param {{
 *   model: string,
 *   repo: string,
 *   memory: string,
 *   env: NodeJS.ProcessEnv,
 *   scenarioSignal: AbortSignal,
 *   prompts: string[],
 *   recordDir: string,
 * }} input
 */
export async function runMemoryHostTurns(input) {
  const { model, repo, memory, env, scenarioSignal, prompts, recordDir } = input;
  /** @type {import('./memory-types.mjs').MemoryHostOutput[]} */
  const outputs = [];
  for (const prompt of prompts) {
    const capture = await executeMemoryHostTurn({
      model,
      workspace: repo,
      memoryParent: dirname(memory),
      prompt,
      env,
      signal: scenarioSignal,
    });
    const status =
      capture.kind === 'completed' ? 0 : 'exitCode' in capture ? capture.exitCode : null;
    const output = {
      status,
      stdout: 'stdout' in capture ? capture.stdout : '',
      stderr: 'stderr' in capture ? capture.stderr : '',
      kind: capture.kind,
      reason: 'reason' in capture ? capture.reason : null,
      completion:
        capture.kind === 'completed'
          ? evaluateCodexTurnCompletion({
              status: capture.exitCode,
              signal: null,
              error: null,
              stdout: capture.stdout,
              stderr: capture.stderr,
            })
          : null,
      prompt,
    };
    outputs.push(output);
    writeFileSync(
      join(recordDir, `host-${outputs.length}.json`),
      sanitizeAndBoundArtifact(JSON.stringify(output, null, 2), 3 * 1024 * 1024).content,
    );
    if (capture.kind !== 'completed' || output.completion?.completed !== true) break;
  }
  return outputs;
}
