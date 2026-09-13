import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInstructionPath } from './lib/filesystem/instruction-path.js';
import { canonicalPath, isPathInside, sameCanonicalPath } from './lib/filesystem/safe-path.js';
import type { InstallationContext, Runtime } from './types.js';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
interface ManagedInstallationContext extends InstallationContext {
  harnessHome: string;
  agentsHome: string;
  instructionFiles: string[];
  stateHome: string;
  memoryHome: string;
  personalHome: string;
  repositoryRoot: string;
  owner: string;
}
export type RuntimeIdentity =
  | { kind: 'managed'; context: ManagedInstallationContext }
  | { kind: 'standalone'; source: 'source-tree' }
  | { kind: 'invalid'; reason: string };
export type { InstructionPathCheck } from './lib/filesystem/instruction-path.js';
export { validateInstructionPath } from './lib/filesystem/instruction-path.js';

function validContext(value: unknown, harnessRoot: string): value is ManagedInstallationContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  const absoluteFields = [
    'harnessHome',
    'agentsHome',
    'stateHome',
    'memoryHome',
    'personalHome',
    'repositoryRoot',
  ];
  if (context.version !== 2) return false;
  if (typeof context.owner !== 'string' || !context.owner.trim()) return false;
  if (absoluteFields.some((field) => typeof context[field] !== 'string')) return false;
  if (absoluteFields.some((field) => !isAbsolute(context[field] as string))) return false;
  if (!Array.isArray(context.instructionFiles) || context.instructionFiles.length === 0)
    return false;
  if (context.instructionFiles.some((path) => typeof path !== 'string' || !isAbsolute(path))) {
    return false;
  }
  const harnessHome = context.harnessHome as string;
  if (!sameCanonicalPath(installedHarnessPath(harnessHome), harnessRoot)) return false;
  const canonicalHarnessHome = canonicalPath(harnessHome);
  return context.instructionFiles.every((path) => {
    const check = validateInstructionPath(harnessHome, path);
    return check.valid && isPathInside(canonicalHarnessHome, canonicalPath(path));
  });
}
function installedHarnessPath(harnessHome: string): string {
  return join(harnessHome, 'skills', 'agent-harness');
}
function isStandaloneSourceTree(harnessRoot: string): boolean {
  const normalized = resolve(harnessRoot);
  const packageRoot = normalized.endsWith(`${sep}packages${sep}harness`)
    ? dirname(dirname(normalized))
    : dirname(dirname(dirname(normalized)));
  const validHarnessRoot =
    resolve(packageRoot, 'template', 'skills', 'agent-harness') === normalized ||
    resolve(packageRoot, 'packages', 'harness') === normalized;
  if (
    !validHarnessRoot ||
    !existsSync(join(packageRoot, 'packages', 'harness', 'src', 'runtime.ts'))
  )
    return false;
  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      name?: string;
    };
    return manifest.name === 'harnessmith';
  } catch {
    return false;
  }
}
export function resolveRuntimeIdentity(harnessRoot: string): RuntimeIdentity {
  const path = join(harnessRoot, 'install-context.json');
  if (!existsSync(path)) {
    if (isStandaloneSourceTree(harnessRoot)) {
      return { kind: 'standalone', source: 'source-tree' };
    }
    return {
      kind: 'invalid',
      reason: 'Installation context is missing and no verified standalone source tree exists',
    };
  }
  try {
    const context: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (validContext(context, harnessRoot)) return { kind: 'managed', context };
    return { kind: 'invalid', reason: 'Installation context is invalid or incompatible' };
  } catch (error) {
    return {
      kind: 'invalid',
      reason: `Installation context is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
function safeRoute(route: string, separator: string, absolute: (path: string) => boolean): boolean {
  return route !== '..' && !route.startsWith(`..${separator}`) && !absolute(route);
}
export function managedOutputWithinHome(harnessHome: string, output: string): boolean {
  const windowsPath = win32.isAbsolute(harnessHome) || win32.isAbsolute(output);
  if (windowsPath) {
    if (!win32.isAbsolute(harnessHome) || !win32.isAbsolute(output)) return false;
    const route = win32.relative(win32.resolve(harnessHome), win32.resolve(output));
    return safeRoute(route, win32.sep, win32.isAbsolute);
  }
  if (!isAbsolute(harnessHome) || !isAbsolute(output)) return false;
  return safeRoute(relative(resolve(harnessHome), resolve(output)), sep, isAbsolute);
}
export function verifyRuntimeIdentity(
  runtime: Runtime,
): { valid: true } | { valid: false; message: string; details?: string[] } {
  if (runtime.identityOverride === 'test-fixture' && runtime.hostAdapter === 'test') {
    return { valid: true };
  }
  const identity = resolveRuntimeIdentity(runtime.harnessRoot);
  if (runtime.hostAdapter === 'standalone') {
    if (identity.kind === 'standalone') return { valid: true };
    return {
      valid: false,
      message: 'Standalone runtime identity is not verifiable',
      details: [
        identity.kind === 'invalid' ? identity.reason : 'Managed context cannot be standalone',
      ],
    };
  }
  if (identity.kind !== 'managed') {
    return {
      valid: false,
      message: 'Managed installation context is missing or invalid',
      details: [
        identity.kind === 'invalid' ? identity.reason : 'Source-tree identity cannot be managed',
      ],
    };
  }
  const context = identity.context;
  const unsafeInstruction = runtime.instructionFiles
    .map((path) => validateInstructionPath(runtime.harnessHome, path))
    .find((check) => !check.valid);
  if (unsafeInstruction && !unsafeInstruction.valid) {
    return {
      valid: false,
      message: 'Managed instruction path is unsafe',
      details: [unsafeInstruction.reason],
    };
  }
  const expectedInstructions = runtime.instructionFiles.map((path) => canonicalPath(path)).sort();
  const contextInstructions = context.instructionFiles.map((path) => canonicalPath(path)).sort();
  const matches =
    runtime.hostAdapter === managedHostAdapter &&
    resolve(context.harnessHome) === resolve(runtime.harnessHome) &&
    resolve(context.agentsHome) === resolve(runtime.agentsHome) &&
    resolve(context.stateHome) === resolve(runtime.stateRoot) &&
    canonicalPath(context.memoryHome) === canonicalPath(runtime.memoryHome) &&
    canonicalPath(context.personalHome) === canonicalPath(runtime.personalHome) &&
    resolve(context.repositoryRoot) === resolve(runtime.repositoryRoot) &&
    context.owner === runtime.owner &&
    expectedInstructions.length === contextInstructions.length &&
    expectedInstructions.every((path, index) => path === contextInstructions[index]);
  return matches
    ? { valid: true }
    : { valid: false, message: 'Managed installation context does not match the active runtime' };
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

const managedHostAdapter = 'hub';

export function createRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const home = resolve(env.HOME || homedir());
  const adjacentHarnessRoot = resolve(sourceDirectory, '..');
  const harnessRoot = existsSync(join(adjacentHarnessRoot, 'manifest.json'))
    ? adjacentHarnessRoot
    : resolve(sourceDirectory, '..', '..', '..', 'template', 'skills', 'agent-harness');
  const identity = resolveRuntimeIdentity(harnessRoot);
  const context = identity.kind === 'managed' ? identity.context : null;
  const explicitHome = env.HARNESS_HOME || context?.harnessHome;
  const harnessHome = resolve(explicitHome || resolve(harnessRoot, '..', '..'));
  const installedHarness = explicitHome ? installedHarnessPath(harnessHome) : harnessRoot;
  const userDataHome = explicitHome ? harnessHome : join(home, '.agents', 'harnessmith');
  return Object.freeze({
    env,
    home,
    harnessRoot,
    distributionRoot: harnessHome,
    harnessHome,
    agentsHome: resolve(context?.agentsHome || join(home, '.agents')),
    hostAdapter:
      identity.kind === 'managed'
        ? managedHostAdapter
        : identity.kind === 'standalone'
          ? 'standalone'
          : 'invalid-installation-context',
    instructionFiles: context?.instructionFiles || [join(harnessHome, 'entry', 'AGENTS.md')],
    installedHarness,
    docsRoot: join(installedHarness, 'docs'),
    stateRoot: resolve(
      env.HARNESS_STATE_HOME ||
        context?.stateHome ||
        join(explicitHome ? harnessHome : harnessRoot, 'state'),
    ),
    memoryHome: canonicalPath(
      env.HARNESS_MEMORY_HOME || context?.memoryHome || join(userDataHome, 'memory'),
    ),
    personalHome: canonicalPath(
      env.HARNESS_PERSONAL_HOME || context?.personalHome || join(userDataHome, 'rules'),
    ),
    repositoryRoot: resolve(
      env.HARNESS_REPOSITORY_ROOT || context?.repositoryRoot || join(home, 'git-repo'),
    ),
    owner: env.HARNESS_OWNER || context?.owner || username(home),
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
export function timestamp(date = new Date()): string {
  return date.toISOString().replaceAll(':', '').replaceAll('.', '-');
}
