import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';
import type { ProjectSnapshot } from '../types.js';
import { gitRoot } from './git.js';

function git(path: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', path, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function nearestAgents(start: string, stop: string): string[] {
  const files: string[] = [];
  let current = resolve(start);
  if (!statSync(current).isDirectory()) current = dirname(current);
  while (true) {
    const candidate = join(current, 'AGENTS.md');
    if (existsSync(candidate)) files.push(candidate);
    if (current === stop || current === parse(current).root) break;
    current = dirname(current);
  }
  return files;
}

function packageManager(root: string): string | null {
  const candidates: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
    ['uv.lock', 'uv'],
    ['poetry.lock', 'poetry'],
    ['Pipfile.lock', 'pipenv'],
    ['go.mod', 'go'],
  ];
  return candidates.find(([file]) => existsSync(join(root, file)))?.[1] || null;
}

function packageScripts(root: string): string[] {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return [];
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return Object.keys(value.scripts || {}).sort();
  } catch {
    return [];
  }
}

export function projectSnapshot(input = process.cwd()): ProjectSnapshot {
  const requested = resolve(input);
  if (!existsSync(requested)) throw new Error(`Path does not exist: ${requested}`);
  const root =
    gitRoot(requested) || (statSync(requested).isDirectory() ? requested : dirname(requested));
  const status = git(root, ['status', '--short']);
  const memoryRoot = join(root, '.agent-docs');
  return {
    requested,
    root,
    name: basename(root),
    isGitRepository: Boolean(gitRoot(requested)),
    branch: git(root, ['branch', '--show-current']),
    head: git(root, ['rev-parse', '--short=12', 'HEAD']),
    dirty: status === null ? null : status.length > 0,
    status: status ? status.split(/\r?\n/) : [],
    agents: nearestAgents(requested, root),
    docs: existsSync(join(root, 'docs')),
    memory: {
      root: memoryRoot,
      exists: existsSync(memoryRoot),
      initialized:
        existsSync(join(memoryRoot, 'README.md')) && existsSync(join(memoryRoot, 'core.md')),
    },
    packageManager: packageManager(root),
    packageScripts: packageScripts(root),
    manifests: [
      'package.json',
      'go.mod',
      'pyproject.toml',
      'Cargo.toml',
      'Makefile',
      'Taskfile.yml',
    ].filter((name) => existsSync(join(root, name))),
  };
}
