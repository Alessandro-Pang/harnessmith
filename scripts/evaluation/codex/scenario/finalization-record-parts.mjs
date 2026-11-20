import { join } from 'node:path';

/** @param {import('./finalization-types.mjs').FinalizationRecordInput} input */
export function buildRecordExecution(input) {
  return {
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    evaluatedAt: input.evaluatedAt,
    execution: {
      tier: 'L3',
      attempt: input.attempt,
      maxAttempts: 2,
      scenarioBudgetMs: input.scenarioBudgetMs,
      matrixBudgetMs: input.matrixBudgetMs,
      elapsedMs: Math.min(
        Date.parse(input.finishedAt) - Date.parse(input.startedAt),
        input.scenarioBudgetMs,
      ),
      transportFailures: input.transportFailed ? 1 : 0,
      termination: input.termination,
    },
    transcript: {
      artifactRef: 'local:transcript.md',
      sha256: input.digest(input.transcript),
      redacted: true,
    },
    toolActions: input.toolActions,
    filesystemDiff: {
      artifactRef: 'local:filesystem-diff.txt',
      sha256: input.digest(input.diffArtifact),
      changedPaths: input.changedPaths,
      clean: input.changedPaths.length === 0,
    },
  };
}

/**
 * @param {import('./finalization-types.mjs').FinalizationRecordInput} input
 * @param {string[]} evidenceIds
 */
export function buildRecordAssertions(input, evidenceIds) {
  return {
    scenarioAssertions: input.scenario.pass.map((description, index) => ({
      id: `pass-${index + 1}`,
      description,
      passed: input.passValues[index],
      evidenceRefs: evidenceIds,
    })),
    forbiddenActionAssertions: input.scenario.forbidden.map((description, index) => ({
      id: `forbidden-${index + 1}`,
      description,
      passed: input.finalizedForbiddenValues[index],
      evidenceRefs: evidenceIds,
    })),
  };
}

/** @param {import('./finalization-types.mjs').FinalizationRecordInput} input */
export function buildRecordEvidence(input) {
  return [
    {
      id: 'redacted-transcript',
      kind: 'transcript',
      artifactRef: 'local:transcript.md',
      sha256: input.digest(input.transcript),
      description: `Sanitized bounded real-host JSONL/text transcript; evidenceComplete=${input.evidenceComplete}.`,
    },
    {
      id: 'filesystem-diff',
      kind: 'diff',
      artifactRef: 'local:filesystem-diff.txt',
      sha256: input.digest(input.diffArtifact),
      description: 'Repository state and diff captured before and after the host run.',
    },
    {
      id: 'observations',
      kind: 'observation',
      artifactRef: 'local:observations.json',
      sha256: input.fileDigest(join(input.recordDir, 'observations.json')),
      description:
        'Per-turn independent verifier, profile, memory, handoff, and tracked-worktree snapshots.',
    },
    {
      id: 'assessment',
      kind: 'observation',
      artifactRef: 'local:assessment.txt',
      sha256: input.digest(input.assessment),
      description: 'Evaluator observable predicate results.',
    },
  ];
}
