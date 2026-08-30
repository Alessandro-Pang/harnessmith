import { lstatSync, readFileSync } from 'node:fs';
import { checked, sha256 } from './eval-codex-canary-common.js';
import {
  evaluateMachineErrorEvidence,
  type MachineErrorEnvelope,
  type MachineErrorEvaluation,
} from './eval-codex-canary-contract.js';
import type { MachineErrorCanaryFixture } from './eval-codex-canary-fixture.js';
import { createCodexHostEvalExecutor, type RunHostProcess } from './eval-codex-transport.js';
import type { HostEvalAttemptResult } from './eval-runner.js';

export type MachineErrorCanaryResult = {
  outcome: 'passed' | 'behavior-failed' | 'infra-inconclusive' | 'evaluator-failed';
  termination:
    | 'completed'
    | 'transport-failure'
    | 'scenario-budget-exhausted'
    | 'evaluator-failure';
  attempts: 1;
  transportFailures: number;
  elapsedMs: number;
  evaluation: MachineErrorEvaluation | null;
  hostExitCode: number | null;
  stdout: string;
  stderr: string;
};

type CanaryCaptureState = Pick<
  MachineErrorCanaryResult,
  'evaluation' | 'hostExitCode' | 'stdout' | 'stderr'
>;

function targetChangedPaths(fixture: MachineErrorCanaryFixture): string[] {
  return checked('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: fixture.target,
    env: fixture.environment,
  })
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function evaluateCapture(
  fixture: MachineErrorCanaryFixture,
  stdout: string,
): MachineErrorEvaluation {
  const state = lstatSync(fixture.capturePath);
  if (!state.isFile() || state.isSymbolicLink() || state.size > 64 * 1024) {
    throw new Error('Machine error capture is not a bounded regular file');
  }
  const envelope = JSON.parse(readFileSync(fixture.capturePath, 'utf8')) as MachineErrorEnvelope;
  return evaluateMachineErrorEvidence({
    stdout,
    expectedCommand: fixture.expectedCommand,
    commandSha256: fixture.commandSha256,
    wrapperUnchanged: sha256(readFileSync(fixture.captureWrapper)) === fixture.captureWrapperSha256,
    targetChangedPaths: targetChangedPaths(fixture),
    envelope,
  });
}

function canaryResult(
  result: Pick<MachineErrorCanaryResult, 'outcome' | 'termination'>,
  state: CanaryCaptureState,
  elapsedMs: number,
): MachineErrorCanaryResult {
  return {
    outcome: result.outcome,
    termination: result.termination,
    attempts: 1,
    transportFailures: result.termination === 'transport-failure' ? 1 : 0,
    elapsedMs,
    ...state,
  };
}

export async function executePreparedMachineErrorCanary(
  fixture: MachineErrorCanaryFixture,
  options: {
    model: string;
    scenarioBudgetMs: number;
    maxOutputBytes: number;
    executable?: string;
    runProcess?: RunHostProcess;
  },
): Promise<MachineErrorCanaryResult> {
  const state: CanaryCaptureState = {
    evaluation: null,
    hostExitCode: null as number | null,
    stdout: '',
    stderr: '',
  };
  const execute = createCodexHostEvalExecutor({
    workspace: fixture.workspace,
    executable: options.executable,
    model: options.model,
    environment: fixture.environment,
    maxOutputBytes: options.maxOutputBytes,
    promptForScenario: (scenarioId) =>
      `Execute the authorized Host Eval scenario ${scenarioId}. Read EVAL_CONTEXT.md first, then follow its exact single-command boundary.`,
    runProcess: options.runProcess,
    observeCapture: (capture) => {
      if (capture.kind === 'evaluator-failure' && capture.reason === 'host-exit') {
        state.hostExitCode = capture.exitCode;
      }
      if ('stdout' in capture) state.stdout = capture.stdout;
      if ('stderr' in capture) state.stderr = capture.stderr;
    },
    evaluate: async (capture) => {
      state.stdout = capture.stdout;
      state.stderr = capture.stderr;
      state.evaluation = evaluateCapture(fixture, capture.stdout);
      return { outcome: state.evaluation.outcome, termination: 'completed' };
    },
  });
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.scenarioBudgetMs);
  let result: HostEvalAttemptResult;
  try {
    result = await execute({
      scenarioId: fixture.scenarioId,
      attempt: 1,
      maxAttempts: 1,
      deadlineMs: started + options.scenarioBudgetMs,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const elapsedMs = Math.min(Date.now() - started, options.scenarioBudgetMs);
  return controller.signal.aborted
    ? canaryResult(
        { outcome: 'infra-inconclusive', termination: 'scenario-budget-exhausted' },
        state,
        elapsedMs,
      )
    : canaryResult(result, state, elapsedMs);
}
