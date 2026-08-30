import { isAbsolute } from 'node:path';
import { execa } from 'execa';
import type { HostEvalAttempt, HostEvalAttemptResult } from './eval-runner.js';

const maximumHostOutputBytes = 1024 * 1024;

export type HostProcessInvocation = {
  executable: string;
  args: string[];
  cwd: string;
};

export type HostProcessCapture =
  | {
      kind: 'completed';
      exitCode: 0;
      stdout: string;
      stderr: string;
    }
  | { kind: 'transport-failure'; reason: 'canceled' | 'connection' | 'process-unavailable' }
  | { kind: 'evaluator-failure'; reason: 'host-exit' | 'output-limit' };

export type CompletedHostProcessCapture = Extract<HostProcessCapture, { kind: 'completed' }>;

type RunHostProcess = (options: {
  invocation: HostProcessInvocation;
  prompt: string;
  signal: AbortSignal;
  maxOutputBytes: number;
}) => Promise<HostProcessCapture>;

type HostBehaviorResult = Extract<HostEvalAttemptResult, { termination: 'completed' }>;

export function buildCodexInvocation(options: {
  executable?: string;
  workspace: string;
}): HostProcessInvocation {
  if (!isAbsolute(options.workspace)) {
    throw new Error('Codex Host Eval requires an absolute workspace path');
  }
  const executable = options.executable ?? 'codex';
  return {
    executable,
    args: [
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '--approve-for-me',
      '--cd',
      options.workspace,
      '-',
    ],
    cwd: options.workspace,
  };
}

function isConnectionFailure(output: string): boolean {
  return [
    /\b(?:ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|ETIMEDOUT)\b/i,
    /websocket.{0,80}(?:closed|error|failed)/i,
    /tls.{0,80}(?:certificate|error|handshake)/i,
  ].some((pattern) => pattern.test(output));
}

export async function runBoundedHostProcess(options: {
  invocation: HostProcessInvocation;
  prompt: string;
  signal: AbortSignal;
  maxOutputBytes: number;
}): Promise<HostProcessCapture> {
  if (
    !Number.isInteger(options.maxOutputBytes) ||
    options.maxOutputBytes < 1 ||
    options.maxOutputBytes > maximumHostOutputBytes
  ) {
    throw new Error(
      `Host process output limit must be an integer from 1 to ${maximumHostOutputBytes}`,
    );
  }
  const result = await execa(options.invocation.executable, options.invocation.args, {
    cwd: options.invocation.cwd,
    input: options.prompt,
    cancelSignal: options.signal,
    forceKillAfterDelay: 1_000,
    killDescendants: true,
    maxBuffer: options.maxOutputBytes,
    reject: false,
  });
  if (result.isCanceled) return { kind: 'transport-failure', reason: 'canceled' };
  if (result.code === 'ENOENT') {
    return { kind: 'transport-failure', reason: 'process-unavailable' };
  }
  if (
    Buffer.byteLength(result.stdout) >= options.maxOutputBytes ||
    Buffer.byteLength(result.stderr) >= options.maxOutputBytes
  ) {
    return { kind: 'evaluator-failure', reason: 'output-limit' };
  }
  if (result.exitCode !== 0 && isConnectionFailure(`${result.stdout}\n${result.stderr}`)) {
    return { kind: 'transport-failure', reason: 'connection' };
  }
  if (result.exitCode !== 0) return { kind: 'evaluator-failure', reason: 'host-exit' };
  return {
    kind: 'completed',
    exitCode: 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function createCodexHostEvalExecutor(options: {
  workspace: string;
  executable?: string;
  maxOutputBytes?: number;
  promptForScenario: (scenarioId: string) => string;
  runProcess?: RunHostProcess;
  evaluate: (
    capture: CompletedHostProcessCapture,
    attempt: HostEvalAttempt,
  ) => Promise<HostBehaviorResult>;
}): (attempt: HostEvalAttempt) => Promise<HostEvalAttemptResult> {
  const invocation = buildCodexInvocation(options);
  const runProcess = options.runProcess ?? runBoundedHostProcess;
  const maxOutputBytes = options.maxOutputBytes ?? maximumHostOutputBytes;
  return async (attempt) => {
    const capture = await runProcess({
      invocation,
      prompt: options.promptForScenario(attempt.scenarioId),
      signal: attempt.signal,
      maxOutputBytes,
    });
    if (capture.kind === 'transport-failure') {
      return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
    }
    if (capture.kind === 'evaluator-failure') {
      return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
    }
    try {
      return await options.evaluate(capture, attempt);
    } catch {
      return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
    }
  };
}
