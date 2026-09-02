import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function writeCanaryFile(path: string, content: string | Buffer): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

export function checked(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): string {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: 1024 * 1024,
  });
}

export function gitCommit(directory: string, environment: NodeJS.ProcessEnv): void {
  checked('git', ['add', '-A'], { cwd: directory, env: environment });
  checked(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Harness-Eval',
      '-c',
      'user.email=eval@example.invalid',
      'commit',
      '-m',
      'test: evaluation fixture',
    ],
    { cwd: directory, env: environment },
  );
}

export function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
