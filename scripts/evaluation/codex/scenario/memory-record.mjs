import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDigest } from './memory-runtime.mjs';

/**
 * @param {{
 *   scenario: import('./memory-types.mjs').MemoryScenario,
 *   variant: number,
 *   runId: string,
 *   recordDir: string,
 *   model: string,
 *   packageVersion: string,
 *   packageArtifactSha256: string,
 *   digest: (value: string | Buffer) => string,
 * }} input
 */
export function writeScenarioCatalogInconclusive(input) {
  const {
    scenario,
    variant,
    runId,
    recordDir,
    model,
    packageVersion,
    packageArtifactSha256,
    digest,
  } = input;
  const startedAt = new Date().toISOString();
  const reason = String(scenario.evaluationReason ?? 'scenario-catalog-inconclusive');
  const artifact = JSON.stringify({
    scenarioId: scenario.id,
    reason,
    status: 'evaluator-inconclusive',
  });
  writeFileSync(join(recordDir, 'verifier.json'), `${artifact}\n`);
  const syntheticDigest = digest(JSON.stringify({ scenarioId: scenario.id, reason }));
  writeFileSync(
    join(recordDir, 'states.json'),
    `${JSON.stringify({ initial: { files: {} }, final: { files: {} } }, null, 2)}\n`,
  );
  const record = {
    schemaVersion: 1,
    recordType: 'memory-evaluation',
    runId,
    scenarioId: scenario.id,
    trial: 1,
    promptVariant: variant,
    host: {
      adapter: 'codex',
      product: 'Codex CLI',
      version: process.env.HARNESS_EVAL_HOST_VERSION ?? 'unspecified',
      model,
      modelVersion: process.env.HARNESS_EVAL_MODEL_VERSION ?? 'unspecified',
    },
    subject: { packageVersion, packageArtifactSha256 },
    startedAt,
    finishedAt: new Date().toISOString(),
    expectedDecision: scenario.expectedDecision,
    actualDecision: {
      decision: 'no-write',
      action: 'none',
      writer: 'scenario-catalog',
      reasonCode: reason,
    },
    transition: 'no-change',
    initialState: { digest: syntheticDigest, changedPaths: [] },
    finalState: { digest: syntheticDigest, changedPaths: [] },
    verifier: {
      command: 'scenario catalog status',
      exitCode: 0,
      passed: false,
      artifactRef: 'local:verifier.json',
      sha256: digest(`${artifact}\n`),
    },
    outcome: 'evaluator-inconclusive',
    failureCategory: 'evaluator-inconclusive',
    criticalForbidden: false,
    notes: `Scenario is excluded from model behavior scoring until its fixture/oracle is repaired: ${reason}`,
  };
  writeFileSync(join(recordDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { outcome: record.outcome, reason };
}

/**
 * @param {{
 *   scenario: import('./memory-types.mjs').MemoryScenario,
 *   variant: number,
 *   runId: string,
 *   model: string,
 *   packageVersion: string,
 *   packageArtifactSha256: string,
 *   startedAt: string,
 *   action: import('./memory-types.mjs').MemoryAction,
 *   typed: import('../support/types.mjs').MemoryPayloadOutput | undefined,
 *   verification: import('../../memory/memory-state-verifier.ts').MemoryVerificationResult,
 *   initial: import('../../memory/memory-state-verifier.ts').MemoryFileState,
 *   final: import('../../memory/memory-state-verifier.ts').MemoryFileState,
 *   changedPaths: string[],
 *   verifier: { command: string, exitCode: number, passed: boolean, sha256: string },
 *   hostEvaluatorFailed: boolean,
 *   criticalForbidden: boolean,
 *   contract: import('./memory-types.mjs').MemoryContract | undefined,
 *   contractResult: import('../../memory/memory-contract-verifier.ts').MemoryContractResult,
 *   semanticInitialDigest: string,
 *   semanticFinalDigest: string,
 *   forbiddenContract: ReturnType<typeof import('../support/safe-snapshot.mjs').evaluateRepositoryForbiddenContract>,
 *   semanticReviewRequest: Record<string, unknown> | undefined,
 *   outputsCount: number,
 * }} input
 */
export function createMemoryEvaluationRecord(input) {
  const {
    scenario,
    variant,
    runId,
    model,
    packageVersion,
    packageArtifactSha256,
    startedAt,
    action,
    typed,
    verification,
    initial,
    final,
    changedPaths,
    verifier,
    hostEvaluatorFailed,
    criticalForbidden,
    contract,
    contractResult,
    semanticInitialDigest,
    semanticFinalDigest,
    forbiddenContract,
    semanticReviewRequest,
    outputsCount,
  } = input;
  const outcome = hostEvaluatorFailed
    ? 'evaluator-failed'
    : verification.outcome === 'passed' && !criticalForbidden
      ? 'passed'
      : verification.outcome === 'inconclusive'
        ? contractResult.outcome === 'inconclusive'
          ? 'evaluator-inconclusive'
          : 'infra-inconclusive'
        : 'behavior-failed';
  return {
    schemaVersion: 1,
    recordType: 'memory-evaluation',
    runId,
    scenarioId: scenario.id,
    trial: 1,
    promptVariant: variant,
    host: {
      adapter: 'codex',
      product: 'Codex CLI',
      version: process.env.HARNESS_EVAL_HOST_VERSION ?? 'unspecified',
      model,
      modelVersion: process.env.HARNESS_EVAL_MODEL_VERSION ?? 'unspecified',
    },
    subject: { packageVersion, packageArtifactSha256 },
    startedAt,
    finishedAt: new Date().toISOString(),
    expectedDecision: scenario.expectedDecision,
    actualDecision: {
      decision: verification.actualDecision,
      action,
      writer: typed ? 'harness-memory-cli' : 'missing-typed-writer-output',
      reasonCode: String(typed?.reasonCode ?? 'typed-output-missing'),
    },
    transition: verification.transition,
    initialState: { digest: stateDigest(initial), changedPaths: [] },
    finalState: { digest: stateDigest(final), changedPaths },
    verifier: { ...verifier, artifactRef: 'local:verifier.json' },
    outcome,
    failureCategory: hostEvaluatorFailed
      ? 'verifier-failed'
      : criticalForbidden
        ? 'policy-mismatch'
        : verification.failureCategory,
    criticalForbidden,
    stateEvidence: {
      contract,
      outcome: contractResult.outcome,
      reasons: contractResult.reasons,
      independentScopes: ['global', 'project'],
      beforeDigest: semanticInitialDigest,
      afterDigest: semanticFinalDigest,
      artifactRef: 'local:states.json',
      forbiddenContract,
      ...(semanticReviewRequest ? { semanticReviewRequest } : {}),
    },
    ...(scenario.id === 'duplicate-write'
      ? { idempotency: { expectedUnchanged: true, actualUnchanged: changedPaths.length === 0 } }
      : {}),
    notes: `Prompt variant ${variant}; ${outputsCount} task(s); state evidence is filesystem-based and independent of the final response.`,
  };
}
