import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { errorMessage, HarnessmithError } from './types.js';

const lockStaleMilliseconds = 15 * 60_000;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function userScope(): string {
  try {
    const user = userInfo();
    return digest(`${user.uid}:${user.username}`).slice(0, 16);
  } catch {
    return digest(homedir()).slice(0, 16);
  }
}

function canonicalRoot(input: string): string {
  let existing = resolve(input);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(basename(existing));
    existing = parent;
  }
  const canonical = existsSync(existing) ? realpathSync.native(existing) : existing;
  const path = resolve(canonical, ...missing).normalize('NFC');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? path.toLocaleLowerCase('en-US')
    : path;
}

function lockNamespace(): string {
  let base = '/tmp';
  let expectedUid: number | undefined;
  try {
    const user = userInfo();
    expectedUid = typeof user.uid === 'number' && user.uid >= 0 ? user.uid : undefined;
    if (process.platform === 'win32') base = join(user.homedir, 'AppData', 'Local', 'Temp');
  } catch {
    if (process.platform === 'win32') base = homedir();
  }
  const namespace = join(base, `harnessmith-user-data-locks-${userScope()}`);
  mkdirSync(namespace, { recursive: true, mode: 0o700 });
  const entry = lstatSync(namespace);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`Unsafe user-data lock namespace: ${namespace}`);
  }
  if (expectedUid !== undefined && statSync(namespace).uid !== expectedUid) {
    throw new Error(`User-data lock namespace has an unexpected owner: ${namespace}`);
  }
  return namespace;
}

export function userDataCoordinationTargets(roots: string[]): Array<{
  root: string;
  key: string;
  target: string;
}> {
  const namespace = lockNamespace();
  return [...new Set(roots.map(canonicalRoot))].sort().map((root) => {
    const key = digest(root);
    return { root, key, target: join(namespace, key) };
  });
}

export function withUserDataCoordinationLocks<T>(
  roots: string[],
  operation: (handoffTokens: string[]) => T,
): T {
  const targets = userDataCoordinationTargets(roots);
  const releases: Array<() => void> = [];
  const handoffs: string[] = [];
  const tokens: string[] = [];
  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    for (const { root, target } of targets) {
      mkdirSync(target, { recursive: true });
      try {
        releases.push(
          lockfile.lockSync(target, {
            realpath: false,
            stale: lockStaleMilliseconds,
            retries: 0,
          }),
        );
      } catch (error) {
        throw new HarnessmithError(
          'OPERATION_LOCKED',
          `Another Harnesssmith process is initializing user data at ${root}: ${errorMessage(error)}`,
          4,
          { cause: error },
        );
      }
    }
    for (const { key, target } of targets) {
      const nonce = randomBytes(32).toString('hex');
      const path = join(target, `.handoff-${nonce}.json`);
      writeFileSync(
        path,
        `${JSON.stringify({ version: 1, key, nonce, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      handoffs.push(path);
      tokens.push(`${key}.${nonce}`);
    }
    result = operation(tokens);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  const releaseErrors: unknown[] = [];
  for (const path of handoffs.reverse()) {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') releaseErrors.push(error);
    }
  }
  for (const release of releases.reverse()) {
    try {
      release();
    } catch (error) {
      releaseErrors.push(error);
    }
  }
  if (operationFailed) {
    if (releaseErrors.length > 0) {
      throw new Error(
        `User-data operation failed and lock release was incomplete: ${errorMessage(operationError)}; releases: ${releaseErrors.map(errorMessage).join('; ')}`,
        { cause: operationError instanceof Error ? operationError : undefined },
      );
    }
    throw operationError;
  }
  if (releaseErrors.length > 0) {
    throw new Error(
      `User-data lock release was incomplete: ${releaseErrors.map(errorMessage).join('; ')}`,
    );
  }
  return result as T;
}
