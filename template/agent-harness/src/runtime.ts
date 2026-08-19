import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstallationContext, Runtime } from './types.js';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

function installationContext(harnessRoot: string): InstallationContext | null {
  const path = join(harnessRoot, 'install-context.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
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
  const context = installationContext(harnessRoot);
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
    hostAdapter: context?.adapter || 'standalone',
    instructionFiles: context?.instructionFiles || [join(harnessHome, 'AGENTS.md')],
    installedHarness,
    docsRoot: join(installedHarness, 'docs'),
    memoryHome: resolve(
      env.HARNESS_MEMORY_HOME || context?.memoryHome || join(home, '.agent-docs'),
    ),
    personalHome: resolve(
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
