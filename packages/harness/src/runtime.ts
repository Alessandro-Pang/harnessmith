import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPath } from './lib/filesystem/safe-path.js';
import type { Runtime } from './types.js';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * The bundled Runtime only ships inside the Harnessmith npm package. Identity is the
 * verified package structure itself; no install-context record or hub layout is consumed.
 */
export type RuntimeIdentity =
  | { kind: 'standalone'; source: 'source-tree' }
  | { kind: 'invalid'; reason: string };
export type { InstructionPathCheck } from './lib/filesystem/instruction-path.js';
export { validateInstructionPath } from './lib/filesystem/instruction-path.js';

function distributionPackageRoot(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (
        manifest.name === 'harnessmith' &&
        existsSync(join(current, 'template', 'skills', 'agent-harness', 'manifest.json'))
      )
        return current;
    } catch {
      // A parent directory without a valid Harnessmith manifest is not a distribution root.
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isStandaloneSourceTree(harnessRoot: string): boolean {
  const normalized = resolve(harnessRoot);
  const packageRoot = distributionPackageRoot(normalized);
  if (!packageRoot) return false;
  return (
    resolve(packageRoot, 'template', 'skills', 'agent-harness') === normalized ||
    resolve(packageRoot, 'packages', 'harness') === normalized
  );
}

export function resolveRuntimeIdentity(harnessRoot: string): RuntimeIdentity {
  if (isStandaloneSourceTree(harnessRoot)) {
    return { kind: 'standalone', source: 'source-tree' };
  }
  return {
    kind: 'invalid',
    reason: 'No verified Harnessmith package structure exists at this path',
  };
}

export function verifyRuntimeIdentity(
  runtime: Runtime,
): { valid: true } | { valid: false; message: string; details?: string[] } {
  if (runtime.identityOverride === 'test-fixture' && runtime.hostAdapter === 'test') {
    return { valid: true };
  }
  const identity = resolveRuntimeIdentity(runtime.harnessRoot);
  if (identity.kind === 'standalone' && runtime.hostAdapter === 'standalone') {
    return { valid: true };
  }
  return {
    valid: false,
    message: 'Standalone runtime identity is not verifiable',
    details: [
      identity.kind === 'invalid'
        ? identity.reason
        : 'Runtime host adapter must be the bundled standalone adapter',
    ],
  };
}

export function assertRuntimeCanMutate(runtime: Runtime): void {
  const identity = verifyRuntimeIdentity(runtime);
  if (identity.valid) return;
  throw new Error(`Runtime identity invalid; write commands are disabled: ${identity.message}`);
}

function username(home: string): string {
  try {
    return userInfo().username || basename(home);
  } catch {
    return basename(home);
  }
}

export function createRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const home = resolve(env.HOME || homedir());
  const packageRoot = distributionPackageRoot(sourceDirectory);
  if (!packageRoot) throw new Error('Unable to locate the Harnessmith npm package root');
  const harnessRoot = join(packageRoot, 'template', 'skills', 'agent-harness');
  const identity = resolveRuntimeIdentity(harnessRoot);
  if (identity.kind !== 'standalone') {
    throw new Error(`Harnessmith package is incomplete: ${identity.reason}`);
  }
  const userDataHome = resolve(env.HARNESS_HOME || join(home, '.harnessmith'));
  return Object.freeze({
    env,
    home,
    harnessRoot,
    distributionRoot: packageRoot,
    harnessHome: userDataHome,
    hostAdapter: 'standalone',
    installedHarness: harnessRoot,
    docsRoot: join(harnessRoot, 'docs'),
    stateRoot: resolve(env.HARNESS_STATE_HOME || join(userDataHome, 'state')),
    memoryHome: canonicalPath(env.HARNESS_MEMORY_HOME || join(userDataHome, 'memory')),
    personalHome: canonicalPath(env.HARNESS_PERSONAL_HOME || join(userDataHome, 'rules')),
    repositoryRoot: resolve(env.HARNESS_REPOSITORY_ROOT || join(home, 'git-repo')),
    owner: env.HARNESS_OWNER || username(home),
  });
}

export function calendarDate(runtime: Runtime, date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: runtime.env.TZ || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
