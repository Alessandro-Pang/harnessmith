interface CheckoutResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

type CheckoutRunner = (
  executable: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: 'pipe' },
) => CheckoutResult;

export function readPreparedHead(runner: CheckoutRunner): string {
  const result = runner('git', ['rev-parse', '--verify', 'HEAD'], {
    env: process.env,
    stdio: 'pipe',
  });
  const head = result.stdout?.trim() ?? '';
  if (result.status !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head)) {
    throw new Error(
      `Could not bind the prepared release to HEAD: ${result.stderr || result.error?.message || 'invalid commit'}`,
    );
  }
  return head;
}
