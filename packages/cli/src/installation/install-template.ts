import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserDataPaths } from '../shared/types.js';

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

function owner(env: NodeJS.ProcessEnv): string {
  if (env.HARNESS_OWNER) return env.HARNESS_OWNER;
  try {
    return userInfo().username;
  } catch {
    return basename(env.HOME || homedir());
  }
}

function repositoryRoot(userData: UserDataPaths, env: NodeJS.ProcessEnv): string {
  return resolve(env.HARNESS_REPOSITORY_ROOT || join(userData.userHome, 'git-repo'));
}

/**
 * Placeholder values shared by every host. Only the tokens the distributed templates
 * actually use are provided; `HOME` is consumed solely to derive the default repository
 * root and is not exposed as a token. Distribution files stay in the package and skills
 * owns Agent skill locations.
 */
export function installationRenderer(
  userData: UserDataPaths,
  env: NodeJS.ProcessEnv,
): (content: string, path?: string) => string {
  const values: Record<string, string> = {
    HARNESS_HOME: userData.home,
    HARNESS_STATE_HOME: userData.state,
    HARNESS_MEMORY_HOME: userData.memory,
    HARNESS_PERSONAL_HOME: userData.rules,
    HARNESS_REPOSITORY_ROOT: repositoryRoot(userData, env),
    HARNESS_OWNER: owner(env),
  };
  return (content: string, path = '') => {
    if (path.split(sep).includes('templates')) return content;
    return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => values[key] ?? match);
  };
}
