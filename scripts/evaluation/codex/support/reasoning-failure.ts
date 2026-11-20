import type { ReasoningResult, ReasoningScenario } from '../eval-codex-reasoning-types.js';

export function reasoningEvaluatorFailure(
  scenario: ReasoningScenario,
  error: string,
): ReasoningResult {
  return {
    id: scenario.id,
    outcome: 'evaluator-failed',
    evidence: {
      routeJson: false,
      modeHit: false,
      activationMatched: false,
      reasoningSectionRead: false,
      routeRawQueryMatched: false,
      routeCommandSucceeded: false,
      sectionReadBeforeResult: false,
      independentFixtureOracle: false,
      semanticReview: scenario.mode === '' ? 'not-applicable' : 'pending',
      requiredArtifacts: [],
      missingArtifacts: scenario.requiredArtifacts,
      hostCompleted: false,
      commandTrace: [],
    },
    error,
  };
}
