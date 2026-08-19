import { execFileSync } from 'node:child_process';

export function gitRoot(path: string): string | null {
  try {
    return execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function gitVersion(): string | null {
  try {
    return execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
