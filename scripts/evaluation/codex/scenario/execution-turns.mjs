import {
  parseCodexInputTokens,
  parseCodexThreadId,
  parseJsonlEvidence,
} from '../eval-codex-support.mjs';
import { createScenarioEvidence } from './evidence.mjs';

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {ReturnType<typeof import('./execution-setup.mjs').initializeScenario>} baseline
 */
async function runPlannedTurns(context, services, baseline) {
  const { turnVerifier, captureHandoffEvidence, captureMemoryPayloadEvidence, hostTurnCompletion } =
    createScenarioEvidence({
      scenarioId: context.scenarioId,
      host: context.host,
      repo: context.repo,
      temp: context.temp,
      nodeBin: context.nodeBin,
      harnessBin: services.harnessBin,
      verifierDigests: services.verifierDigests,
      fileDigest: services.fileDigest,
      run: services.run,
      safeReadFile: services.safeReadFile,
      digest: services.digest,
      canonicalJson: services.canonicalJson,
    });
  /** @type {import('../support/types.mjs').ScenarioTurn[]} */
  const turnResults = [];
  /** @type {string | undefined} */
  let codexThreadId;
  /** @type {import('../support/types.mjs').HostInvocation | undefined} */
  let invocation;
  /** @type {{ inputTokens: number, autoCompactLimit: number, contextWindow: number } | { error: string } | null} */
  let forcedCompactionConfig = null;
  for (const planned of baseline.turnPlan) {
    /** @type {string[]} */
    let configOverrides = [];
    if (
      context.scenarioId === 'memory-autopilot-unprompted' &&
      planned.label === 'follow-up-edit'
    ) {
      const signalTurn = turnResults.find((turn) => turn.label === 'pre-compaction-signal');
      if (signalTurn) {
        try {
          const inputTokens = parseCodexInputTokens(signalTurn.result.stdout);
          const autoCompactLimit = inputTokens + 64;
          const contextWindow = Math.ceil(autoCompactLimit / 0.92);
          forcedCompactionConfig = { inputTokens, autoCompactLimit, contextWindow };
          configOverrides = [
            `model_context_window=${contextWindow}`,
            `model_auto_compact_token_limit=${autoCompactLimit}`,
          ];
        } catch (error) {
          forcedCompactionConfig = { error: String(error) };
        }
      }
    }
    invocation = services.hostCommand(
      codexThreadId ?? null,
      baseline.turnPlan.length > 1,
      configOverrides,
    );
    const result = await services.runHostCommand(invocation, planned.prompt);
    if (context.host === 'codex' && !codexThreadId && baseline.turnPlan.length > 1) {
      try {
        codexThreadId = parseCodexThreadId(result.stdout);
      } catch (error) {
        result.status = result.status === 0 ? 1 : result.status;
        result.stderr = `${result.stderr}${result.stderr ? '\n' : ''}${String(error)}`;
      }
    }
    const completion = hostTurnCompletion(result, planned);
    turnResults.push({
      ...planned,
      invocation: { command: invocation.command, args: invocation.args },
      result,
      completion,
      handoffEvidence: captureHandoffEvidence(result.stdout),
      memoryPayloadEvidence: captureMemoryPayloadEvidence(result.stdout, planned.label),
      verifier: turnVerifier(planned.label),
      observation: services.observeState(),
    });
    if (
      !completion.completed ||
      (context.host === 'codex' && baseline.turnPlan.length > 1 && !codexThreadId)
    )
      break;
  }
  if (!invocation) throw new Error(`Scenario ${context.scenarioId} produced no Host invocation`);
  return { turnResults, codexThreadId, invocation, forcedCompactionConfig };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {ReturnType<typeof import('./execution-setup.mjs').initializeScenario>} baseline
 * @param {Awaited<ReturnType<typeof runPlannedTurns>>} turns
 */
function summarizeTurns(context, services, baseline, turns) {
  const { turnResults } = turns;
  const everyTurnCompleted =
    turnResults.length === baseline.turnPlan.length &&
    turnResults.every((turn) => turn.completion.completed === true);
  const firstFailedTurn = turnResults.find((turn) => turn.completion.completed !== true);
  const result = {
    status: everyTurnCompleted ? 0 : 1,
    signal: turnResults.find((turn) => turn.result.signal)?.result.signal,
    error: firstFailedTurn?.result.error,
    stdout: turnResults.map((turn) => turn.result.stdout).join('\n'),
    stderr: turnResults.map((turn) => turn.result.stderr).join('\n'),
  };
  const diagnostics =
    context.host === 'codex'
      ? turnResults.map((turn) => ({ turn: turn.label, ...parseJsonlEvidence(turn.result.stdout) }))
      : [];
  const malformedJsonlCount = diagnostics.reduce((count, item) => count + item.malformedCount, 0);
  const malformedJsonl = diagnostics
    .flatMap((item) => item.malformed.map((entry) => ({ turn: item.turn, ...entry })))
    .slice(0, 128);
  if (malformedJsonlCount > 0) {
    context.evaluatorErrors.push(
      `Codex JSONL contained ${malformedJsonlCount} malformed non-empty line(s); evidence is incomplete`,
    );
  }
  return {
    result,
    everyTurnCompleted,
    malformedJsonlCount,
    malformedJsonl,
    finishedAt: new Date().toISOString(),
    after: services.status(),
    afterHead: services.gitHead(),
  };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {ReturnType<typeof import('./execution-setup.mjs').initializeScenario>} baseline
 */
export async function executeScenarioTurns(context, services, baseline) {
  const turns = await runPlannedTurns(context, services, baseline);
  return { ...turns, ...summarizeTurns(context, services, baseline, turns) };
}
