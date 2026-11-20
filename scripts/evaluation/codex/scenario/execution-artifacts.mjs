import { join } from 'node:path';
import { sanitizeAndBoundArtifact } from '../eval-codex-support.mjs';

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {ReturnType<typeof import('./execution-setup.mjs').initializeScenario>} baseline
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 */
function createTranscriptAndDiff(context, services, baseline, turns) {
  const rawTranscript = `# Sanitized bounded real-host transcript\n\n${turns.turnResults
    .map(
      (turn, index) =>
        `## Turn ${index + 1}: ${turn.label} (${turn.kind})\n\nPrompt:\n\n${turn.prompt}\n\nHost exit: ${String(turn.result.status)}\nSignal: ${turn.result.signal ?? 'none'}\nSpawn error: ${turn.result.error ?? 'none'}\nCompletion evidence: ${JSON.stringify(turn.completion)}\nIndependent verifier: ${turn.verifier ? `${String(turn.verifier.status)} (${turn.verifier.command.join(' ')})` : 'not applicable'}\n\n### stdout\n\n${turn.result.stdout}\n\n### stderr\n\n${turn.result.stderr}`,
    )
    .join('\n\n')}\n`;
  const transcriptState = sanitizeAndBoundArtifact(rawTranscript, 7 * 1024 * 1024);
  const rawDiffArtifact = `# Before\n${baseline.before || '(clean)\n'}\n# After\n${turns.after || '(clean)\n'}\n\n# Git diff\n${services.run('git', ['diff', '--no-ext-diff'], { cwd: context.repo }).stdout}`;
  const diffState = sanitizeAndBoundArtifact(rawDiffArtifact, 4 * 1024 * 1024);
  return {
    transcriptState,
    transcript: transcriptState.content,
    diffState,
    diffArtifact: diffState.content,
    evidenceComplete:
      !transcriptState.truncated && !diffState.truncated && turns.malformedJsonlCount === 0,
  };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {ReturnType<typeof import('./execution-setup.mjs').initializeScenario>} baseline
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 * @param {ReturnType<typeof createTranscriptAndDiff>} artifacts
 */
function createObservationArtifact(context, services, baseline, turns, artifacts) {
  const { content: _transcriptContent, ...transcriptMetadata } = artifacts.transcriptState;
  const { content: _diffContent, ...diffMetadata } = artifacts.diffState;
  /** @type {import('../support/types.mjs').ObservationArtifact} */
  const observationArtifact = {
    note: 'The 8% marker is evaluator instrumentation; native compaction is credited only when the follow-up JSONL contains a native context-compacted event.',
    idempotencyInstrumentation:
      'repeat-identical-checkpoint is evaluator instrumentation, not a user persistence request.',
    logicalThreadId:
      context.scenarioId === 'memory-autopilot-unprompted'
        ? 'host-thread-42'
        : context.scenarioId === 'memory-autopilot-phase-only'
          ? 'phase-thread-17'
          : context.scenarioId === 'memory-autopilot-multi-task'
            ? 'multi-thread-23'
            : null,
    codexThreadId: turns.codexThreadId ?? null,
    forcedCompactionConfig: turns.forcedCompactionConfig,
    jsonlDiagnostics: {
      malformedCount: turns.malformedJsonlCount,
      malformed: turns.malformedJsonl,
      exceeded: turns.malformedJsonlCount > turns.malformedJsonl.length,
    },
    nativeCompactionObserved: services
      .jsonEvents(
        turns.turnResults.find((turn) => turn.label === 'follow-up-edit')?.result.stdout ?? '',
      )
      .some((event) => event?.type === 'context_compacted' || event?.type === 'context.compacted'),
    artifactBounds: { transcript: transcriptMetadata, diff: diffMetadata },
    fixturePaths: {
      target: services.fixturePaths.target ?? null,
      outside: services.fixturePaths.outside ?? null,
      captureWrapper: services.fixturePaths.captureWrapper ?? null,
      captureWrapperSha256: services.fixturePaths.captureWrapperSha256 ?? null,
      captureCommandSha256: services.fixturePaths.captureCommandSha256 ?? null,
    },
    baseline: baseline.baselineObservation,
    turns: turns.turnResults.map(
      ({
        label,
        kind,
        result,
        completion,
        verifier,
        handoffEvidence,
        memoryPayloadEvidence,
        observation,
      }) => ({
        label,
        kind,
        hostProcess: { status: result.status, signal: result.signal, error: result.error },
        completion,
        verifier,
        handoffEvidence,
        memoryPayloadEvidence,
        observation,
      }),
    ),
  };
  return observationArtifact;
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {ReturnType<typeof import('./execution-setup.mjs').initializeScenario>} baseline
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 */
export function createRunArtifacts(context, services, baseline, turns) {
  const artifacts = createTranscriptAndDiff(context, services, baseline, turns);
  const observationArtifact = createObservationArtifact(
    context,
    services,
    baseline,
    turns,
    artifacts,
  );
  services.write(join(context.recordDir, 'transcript.md'), artifacts.transcript);
  services.write(join(context.recordDir, 'filesystem-diff.txt'), artifacts.diffArtifact);
  return { ...artifacts, observationArtifact };
}
