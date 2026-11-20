import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryEvaluationRecord } from './memory-record.mjs';
import { digest } from './memory-runtime.mjs';

/**
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').prepareMemoryScenario>} setup
 * @param {Awaited<ReturnType<typeof import('./memory-scenario-execution.mjs').executeMemoryScenario>>} execution
 * @param {ReturnType<typeof import('./memory-scenario-verification.mjs').verifyMemoryScenario>} verification
 */
export function finalizeMemoryScenario(setup, execution, verification) {
  const record = createMemoryEvaluationRecord({
    scenario: setup.scenario,
    variant: setup.variant,
    runId: setup.runId,
    model: setup.model,
    packageVersion: setup.packageVersion,
    packageArtifactSha256: setup.packageArtifactSha256,
    startedAt: execution.startedAt,
    action: execution.action,
    typed: execution.typed,
    verification: verification.verification,
    initial: execution.initial,
    final: execution.final,
    changedPaths: execution.changedPaths,
    verifier: verification.verifier,
    hostEvaluatorFailed: verification.hostEvaluatorFailed,
    criticalForbidden: verification.criticalForbidden,
    contract: verification.contract,
    contractResult: verification.contractResult,
    semanticInitialDigest: digest(JSON.stringify(execution.semanticInitial)),
    semanticFinalDigest: digest(JSON.stringify(execution.semanticFinal)),
    forbiddenContract: execution.forbiddenContract,
    semanticReviewRequest: verification.semanticReviewRequest,
    outputsCount: execution.outputs.length,
  });
  writeFileSync(join(setup.recordDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
