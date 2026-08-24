import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPath, isPathInside } from './lib/safe-path.js';
import type { InstallationContext, Runtime } from './types.js';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

interface ManagedInstallationContext extends InstallationContext {
  adapter: string;
  harnessHome: string;
  instructionFiles: string[];
  memoryHome: string;
  personalHome: string;
  repositoryRoot: string;
  owner: string;
}

export type RuntimeIdentity =
  | { kind: 'managed'; context: ManagedInstallationContext }
  | { kind: 'standalone'; source: 'source-tree' }
  | { kind: 'invalid'; reason: string };

function sameExistingPath(left: string, right: string): boolean {
  try {
    return realpathSync.native(left) === realpathSync.native(right);
  } catch {
    return false;
  }
}

function validContext(value: unknown, harnessRoot: string): value is ManagedInstallationContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  const absoluteFields = ['harnessHome', 'memoryHome', 'personalHome', 'repositoryRoot'];
  if (context.version !== 1) return false;
  if (typeof context.adapter !== 'string' || !context.adapter.trim()) return false;
  if (typeof context.owner !== 'string' || !context.owner.trim()) return false;
  if (absoluteFields.some((field) => typeof context[field] !== 'string')) return false;
  if (absoluteFields.some((field) => !isAbsolute(context[field] as string))) return false;
  if (!Array.isArray(context.instructionFiles) || context.instructionFiles.length === 0)
    return false;
  if (context.instructionFiles.some((path) => typeof path !== 'string' || !isAbsolute(path))) {
    return false;
  }
  const harnessHome = context.harnessHome as string;
  if (!sameExistingPath(resolve(harnessHome, 'agent-harness'), resolve(harnessRoot))) return false;
  return context.instructionFiles.every((path) => isPathInside(harnessHome, path));
}

function isStandaloneSourceTree(harnessRoot: string): boolean {
  const packageRoot = dirname(dirname(harnessRoot));
  if (resolve(packageRoot, 'template', 'agent-harness') !== resolve(harnessRoot)) return false;
  if (!existsSync(join(harnessRoot, 'src', 'runtime.ts'))) return false;
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
  const expectedInstructions = runtime.instructionFiles.map((path) => resolve(path)).sort();
  const contextInstructions = context.instructionFiles.map((path) => resolve(path)).sort();
  const matches =
    context.adapter === runtime.hostAdapter &&
    resolve(context.harnessHome) === resolve(runtime.harnessHome) &&
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

export function createRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const home = resolve(env.HOME || homedir());
  const harnessRoot = resolve(sourceDirectory, '..');
  const identity = resolveRuntimeIdentity(harnessRoot);
  const context = identity.kind === 'managed' ? identity.context : null;
  const harnessHome = resolve(
    env.HARNESS_HOME || context?.harnessHome || resolve(harnessRoot, '..'),
  );
  const installedHarness = join(harnessHome, 'agent-harness');
  return Object.freeze({
    env,
    home,
    harnessRoot,
    distributionRoot: resolve(harnessRoot, '..'),
    harnessHome,
    hostAdapter:
      identity.kind === 'managed'
        ? identity.context.adapter
        : identity.kind === 'standalone'
          ? 'standalone'
          : 'invalid-installation-context',
    instructionFiles: context?.instructionFiles || [join(harnessHome, 'AGENTS.md')],
    installedHarness,
    docsRoot: join(installedHarness, 'docs'),
    memoryHome: canonicalPath(
      env.HARNESS_MEMORY_HOME || context?.memoryHome || join(home, '.agent-docs'),
    ),
    personalHome: canonicalPath(
      env.HARNESS_PERSONAL_HOME || context?.personalHome || join(home, '.agent-harness'),
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
