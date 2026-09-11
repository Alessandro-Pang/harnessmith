import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execaSync } from 'execa';
import { fdir } from 'fdir';
import type { Hub } from '../shared/types.js';

function resolvePackageRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (
        manifest.name === 'harnessmith' &&
        existsSync(join(current, 'template', 'skills', 'agent-harness'))
      )
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
export const harnessTemplateRoot = join(packageRoot, 'template', 'skills', 'agent-harness');
export const packageVersion = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
).version;
/**
 * Top-level entries of the distributed `agent-harness` skill. The layout follows the
 * Agent Skills convention: `SKILL.md` entry point, `scripts/` executables, `assets/`
 * templates and schemas; `docs/` is the routed guidance corpus and `dist/` the bundle.
 */
const harnessDistributionEntries = new Set([
  'SKILL.md',
  'assets',
  'dist',
  'docs',
  'manifest.json',
  'scripts',
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

/**
 * Placeholder values shared by every host: the hub is rendered once, so `HARNESS_HOME` is
 * the hub home rather than a host directory.
 */
export function installationRenderer(
  hub: Hub,
  env: NodeJS.ProcessEnv,
): (content: string, path?: string) => string {
  const values: Record<string, string> = {
    HOME: hub.userHome,
    HARNESS_HOME: hub.home,
    HARNESS_AGENTS_HOME: hub.agentsHome,
    HARNESS_STATE_HOME: hub.state,
    HARNESS_MEMORY_HOME: hub.memory,
    HARNESS_PERSONAL_HOME: hub.rules,
    HARNESS_REPOSITORY_ROOT: repositoryRoot(hub, env),
    HARNESS_OWNER: owner(env),
  };
  return (content: string, path = '') => {
    if (path.split(sep).includes('templates')) return content;
    return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => values[key] ?? match);
  };
}

function repositoryRoot(hub: Hub, env: NodeJS.ProcessEnv): string {
  return resolve(env.HARNESS_REPOSITORY_ROOT || join(hub.userHome, 'git-repo'));
}

/** Contents of `install-context.json`, the runtime identity of the installed Harness. */
export function installationValues(hub: Hub, env: NodeJS.ProcessEnv) {
  return {
    version: 2,
    harnessHome: hub.home,
    agentsHome: hub.agentsHome,
    instructionFiles: [hub.entry],
    stateHome: hub.state,
    memoryHome: hub.memory,
    personalHome: hub.rules,
    repositoryRoot: repositoryRoot(hub, env),
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
