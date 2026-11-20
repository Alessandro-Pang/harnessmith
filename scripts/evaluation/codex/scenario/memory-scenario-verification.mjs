import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyMemoryContract } from '../../memory/memory-contract-verifier.ts';
import { parseMemoryCheckOutput } from '../../memory/memory-host-runtime.ts';
import { verifyMemoryState } from '../../memory/memory-state-verifier.ts';
import { resolveMemoryContract } from './memory-evidence.mjs';
import { digest } from './memory-runtime.mjs';

/**
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').prepareMemoryScenario>} setup
 * @param {Awaited<ReturnType<typeof import('./memory-scenario-execution.mjs').executeMemoryScenario>>} execution
 * @param {import('../../memory/memory-contract-verifier.ts').MemoryContract | undefined} contract
 * @param {import('../../memory/memory-contract-verifier.ts').MemoryContractResult} contractResult
 */
function semanticReviewRequest(setup, execution, contract, contractResult) {
  if (contractResult.outcome !== 'inconclusive' || contract?.kind === 'no-write') {
    return undefined;
  }
  return {
    criterion:
      contract?.kind === 'profile-forget'
        ? 'forget-target-exact'
        : contract?.kind === 'project-input-create'
          ? 'project-constraint-preserved'
          : 'user-intent-preserved',
    userInput: setup.scenario.promptVariants[setup.variant],
    before: execution.semanticInitial,
    after: execution.semanticFinal,
    evidenceRefs: ['local:states.json', 'local:verifier.json'],
  };
}

/**
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').prepareMemoryScenario>} setup
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').initializeMemoryFixture>} fixture
 */
function runMemoryVerifier(setup, fixture) {
  const verifierScope = setup.scope === 'global' ? 'global' : setup.repo;
  const result = setup.run(
    fixture.nodeBin,
    [fixture.harnessBin, 'memory', 'check', verifierScope, '--json'],
    { cwd: setup.repo, env: fixture.env },
  );
  const artifact = JSON.stringify({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(setup.recordDir, 'verifier.json'), `${artifact}\n`);
  /** @type {'passed' | 'failed'} */
  const status = parseMemoryCheckOutput(result.status, result.stdout) ? 'passed' : 'failed';
  return {
    status,
    record: {
      command: `${fixture.nodeBin} ${fixture.harnessBin} memory check ${verifierScope} --json`,
      exitCode: result.status ?? 70,
      passed: status === 'passed',
      sha256: digest(`${artifact}\n`),
    },
  };
}

/**
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').prepareMemoryScenario>} setup
 * @param {ReturnType<typeof import('./memory-scenario-setup.mjs').initializeMemoryFixture>} fixture
 * @param {Awaited<ReturnType<typeof import('./memory-scenario-execution.mjs').executeMemoryScenario>>} execution
 */
export function verifyMemoryScenario(setup, fixture, execution) {
  const { scenario } = setup;
  const { semanticInitial, semanticFinal, outputs, initial, final, typed, action } = execution;
  const contract = resolveMemoryContract(scenario, semanticInitial, semanticFinal);
  const contractResult = verifyMemoryContract({
    before: semanticInitial,
    after: semanticFinal,
    contract,
  });
  const reviewRequest = semanticReviewRequest(setup, execution, contract, contractResult);
  const verifier = runMemoryVerifier(setup, fixture);
  const hostInconclusive =
    outputs.length === 0 || outputs.some((output) => output.kind === 'transport-failure');
  const hostEvaluatorFailed = outputs.some(
    (output) => output.kind === 'evaluator-failure' || output.completion?.completed === false,
  );
  const expectedAction = scenario.expectedAction === 'none' ? 'no-change' : scenario.expectedAction;
  const semanticReview = {
    status: contractResult.outcome,
    ...(contractResult.reasons.length > 0 ? { message: contractResult.reasons.join('; ') } : {}),
  };
  const verification = verifyMemoryState({
    before: { files: initial.files },
    after: { files: final.files },
    expectedDecision: scenario.expectedDecision,
    expectedAction,
    actual: { action, reasonCode: String(typed?.reasonCode ?? 'typed-output-missing') },
    verifier: { status: verifier.status },
    evidence: { complete: true },
    semantic: semanticReview,
    infrastructureInconclusive: hostInconclusive,
  });
  const criticalForbidden =
    (scenario.expectedDecision !== 'write' && execution.changedPaths.length > 0) ||
    execution.forbiddenContract.criticalForbidden;
  return {
    verification,
    verifier: verifier.record,
    hostEvaluatorFailed,
    criticalForbidden,
    contract,
    contractResult,
    semanticReviewRequest: reviewRequest,
  };
}
