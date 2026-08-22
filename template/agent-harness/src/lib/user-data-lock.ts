import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';

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

function inheritedKeySet(
  targets: ReturnType<typeof userDataCoordinationTargets>,
  tokens: string[],
): Set<string> {
  const inherited = new Set<string>();
  let expectedUid: number | undefined;
  try {
    const uid = userInfo().uid;
    expectedUid = typeof uid === 'number' && uid >= 0 ? uid : undefined;
  } catch {}
  for (const token of tokens) {
    const match = token.match(/^([0-9a-f]{64})\.([0-9a-f]{64})$/);
    if (!match) continue;
    const [, key, nonce] = match;
    const target = targets.find((candidate) => candidate.key === key);
    if (!target) continue;
    const proofPath = join(target.target, `.handoff-${nonce}.json`);
    const lockPath = `${target.target}.lock`;
    try {
      const proofStat = lstatSync(proofPath);
      const lockStat = lstatSync(lockPath);
      if (
        !proofStat.isFile() ||
        proofStat.isSymbolicLink() ||
        !lockStat.isDirectory() ||
        lockStat.isSymbolicLink() ||
        (expectedUid !== undefined && statSync(proofPath).uid !== expectedUid)
      ) {
        continue;
      }
      const proof = JSON.parse(readFileSync(proofPath, 'utf8')) as {
        version?: number;
        key?: string;
        nonce?: string;
        pid?: number;
        createdAt?: string;
      };
      const createdAt = Date.parse(proof.createdAt || '');
      if (
        proof.version !== 1 ||
        proof.key !== key ||
        proof.nonce !== nonce ||
        !Number.isInteger(proof.pid) ||
        (proof.pid as number) <= 0 ||
        !Number.isFinite(createdAt) ||
        createdAt < Date.now() - lockStaleMilliseconds ||
        createdAt > Date.now() + 60_000 ||
        (proof.pid !== process.pid && proof.pid !== process.ppid)
      ) {
        continue;
      }
      process.kill(proof.pid as number, 0);
      inherited.add(key);
    } catch {
      // Invalid, stale, or ownerless handoff tokens never bypass the lock.
    }
  }
  return inherited;
}

export function withUserDataCoordinationLocks<T>(
  roots: string[],
  inheritedKeys: string[],
  operation: () => T,
): T {
  const targets = userDataCoordinationTargets(roots);
  const inherited = inheritedKeySet(targets, inheritedKeys);
  const releases: Array<() => void> = [];
  let result: T | undefined;
  let operationError: unknown;
  try {
    for (const { root, key, target } of targets) {
      if (inherited.has(key)) continue;
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
        throw new Error(`User data is being initialized by another process: ${root}`, {
          cause: error,
        });
      }
    }
    result = operation();
  } catch (error) {
    operationError = error;
  }
  const releaseErrors: unknown[] = [];
  for (const release of releases.reverse()) {
    try {
      release();
    } catch (error) {
      releaseErrors.push(error);
    }
  }
  if (operationError) {
    if (releaseErrors.length > 0) {
      throw new Error(
        `User-data operation failed and lock release was incomplete: ${String(operationError)}; releases: ${releaseErrors.map(String).join('; ')}`,
        { cause: operationError instanceof Error ? operationError : undefined },
      );
    }
    throw operationError;
  }
  if (releaseErrors.length > 0) {
    throw new Error(
      `User-data lock release was incomplete: ${releaseErrors.map(String).join('; ')}`,
    );
  }
  return result as T;
}
