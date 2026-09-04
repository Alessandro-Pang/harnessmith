import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execaSync } from 'execa';
import { fdir } from 'fdir';
import { canonicalPath } from '../shared/safe-path.js';
import type { Adapter } from '../shared/types.js';

function resolvePackageRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (manifest.name === 'harnessmith' && existsSync(join(current, 'template', 'agent-harness')))
        return current;
    } catch {
      // Missing or malformed manifests do not identify the distribution root.
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Unable to locate Harnessmith package root');
    current = parent;
  }
}

const packageRoot = resolvePackageRoot(dirname(fileURLToPath(import.meta.url)));
export const templateRoot = packageRoot;
export const harnessTemplateRoot = join(packageRoot, 'template', 'agent-harness');
export const packageVersion = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
).version;
const harnessDistributionEntries = new Set([
  'bin',
  'dist',
  'docs',
  'manifest.json',
  'schemas',
  'templates',
]);

export function isHarnessDistributionPath(path: string): boolean {
  return harnessDistributionEntries.has(path.split(sep)[0]);
}

function owner(env: NodeJS.ProcessEnv): string {
  if (env.HARNESS_OWNER) return env.HARNESS_OWNER;
  try {
    return userInfo().username;
  } catch {
    return basename(env.HOME || homedir());
  }
}

export function installationRenderer(
  adapter: Adapter,
  env: NodeJS.ProcessEnv,
): (content: string, path?: string) => string {
  const values: Record<string, string> = {
    HOME: resolve(env.HOME || homedir()),
    HARNESS_HOME: adapter.home,
    HARNESS_MEMORY_HOME: canonicalPath(
      env.HARNESS_MEMORY_HOME || join(env.HOME || homedir(), '.agent-docs'),
    ),
    HARNESS_PERSONAL_HOME: canonicalPath(
      env.HARNESS_PERSONAL_HOME || join(env.HOME || homedir(), '.agent-harness'),
    ),
    HARNESS_REPOSITORY_ROOT: resolve(
      env.HARNESS_REPOSITORY_ROOT || join(env.HOME || homedir(), 'git-repo'),
    ),
    HARNESS_OWNER: owner(env),
  };
  return (content: string, path = '') => {
    if (path.split(sep).includes('templates')) return content;
    return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => values[key] ?? match);
  };
}

export function installationValues(adapter: Adapter, env: NodeJS.ProcessEnv) {
  const home = resolve(env.HOME || homedir());
  return {
    version: 1,
    adapter: adapter.name,
    harnessHome: adapter.home,
    instructionFiles: adapter.instructions.map(({ path }) => path),
    memoryHome: canonicalPath(env.HARNESS_MEMORY_HOME || join(home, '.agent-docs')),
    personalHome: canonicalPath(env.HARNESS_PERSONAL_HOME || join(home, '.agent-harness')),
    repositoryRoot: resolve(env.HARNESS_REPOSITORY_ROOT || join(home, 'git-repo')),
    owner: owner(env),
  };
}

export function listModules(root: string): string[] {
  return new fdir({ excludeSymlinks: true })
    .withFullPaths()
    .withErrors()
    .filter((path, isDirectory) => !isDirectory && path.endsWith('.mjs'))
    .crawl(root)
    .sync()
    .sort();
}

export function checkModules(root: string): void {
  for (const path of listModules(root)) {
    execaSync(process.execPath, ['--check', path], { stderr: 'pipe', stdout: 'pipe' });
  }
}
