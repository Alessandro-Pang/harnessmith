import {
  buildCodexInvocation,
  type RunHostProcess,
  runBoundedHostProcess,
} from '../codex/eval-codex-transport.js';

export function executeMemoryHostTurn(options: {
  workspace: string;
  memoryParent: string;
  model: string;
  prompt: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  runProcess?: RunHostProcess;
}) {
  const invocation = buildCodexInvocation(options);
  invocation.args.splice(
    1,
    0,
    '-c',
    'model_reasoning_effort="medium"',
    '--add-dir',
    options.memoryParent,
  );
  invocation.env = options.env;
  return (options.runProcess ?? runBoundedHostProcess)({
    invocation,
    prompt: options.prompt,
    signal: options.signal,
    maxOutputBytes: 1_048_576,
  });
}

export function parseMemoryCheckOutput(status: number | null, stdout: string): boolean {
  if (status !== 0) return false;
  try {
    const value = JSON.parse(stdout);
    return value?.version === 1 && value?.valid === true;
  } catch {
    return false;
  }
}
