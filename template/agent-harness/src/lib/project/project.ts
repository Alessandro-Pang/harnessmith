import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { ProjectSnapshot } from '../../types.js';
import { digestPath } from '../filesystem/files.js';
import {
  createProjectGitBudget,
  type ProjectGitBudget,
  type ProjectSnapshotOptions,
  projectGit,
  projectGitRaw,
} from './project-git.js';
import { canonicalPath } from '../filesystem/safe-path.js';

export type { ProjectSnapshotOptions } from './project-git.js';

function projectLocation(
  input: string,
  budget: ProjectGitBudget,
): {
  requested: string;
  repository: string | null;
  root: string;
} {
  const inputPath = resolve(input);
  if (!existsSync(inputPath)) throw new Error(`Path does not exist: ${inputPath}`);
  const requested = canonicalPath(inputPath);
  const repository = projectGit(requested, ['rev-parse', '--show-toplevel'], budget);
  const root = canonicalPath(
    repository || (statSync(requested).isDirectory() ? requested : dirname(requested)),
  );
  return {
    requested,
    repository: repository ? root : null,
    root,
  };
}

export function resolveProjectRoot(
  input = process.cwd(),
  options: ProjectSnapshotOptions = {},
): string {
  return projectLocation(input, createProjectGitBudget(options)).root;
}

const workspaceBudget = {
  maxFiles: 100_000,
  maxBytes: 512 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxDurationMs: 30_000,
};

function hashFile(path: string, hash: ReturnType<typeof createHash>, deadline: number): number {
  const stat = lstatSync(path);
  if (stat.size > workspaceBudget.maxFileBytes) throw new Error('Workspace file budget exceeded');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let bytes = 0;
  try {
    while (true) {
      if (Date.now() > deadline) throw new Error('Workspace digest time budget exceeded');
      const length = readSync(descriptor, buffer, 0, buffer.length, null);
      if (length === 0) return bytes;
      bytes += length;
      if (bytes > workspaceBudget.maxFileBytes) throw new Error('Workspace file budget exceeded');
      hash.update(buffer.subarray(0, length));
    }
  } finally {
    closeSync(descriptor);
  }
}

function changedPaths(status: Buffer): string[] {
  const entries = status.toString('utf8').split('\0');
  const paths = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const state = entry.slice(0, 2);
    paths.add(entry.slice(3));
    if (/[RC]/.test(state) && entries[index + 1]) {
      index += 1;
      paths.add(entries[index]);
    }
  }
  return [...paths].sort();
}

function workspaceDigest(root: string, budget: ProjectGitBudget): string | null {
  const status = projectGitRaw(
    root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    budget,
  );
  const indexState = projectGitRaw(
    root,
    ['diff', '--cached', '--raw', '--no-abbrev', '-z'],
    budget,
  );
  if (!status || !indexState) return null;
  try {
    const hash = createHash('sha256');
    const deadline = Date.now() + workspaceBudget.maxDurationMs;
    let bytes = status.length + indexState.length;
    const paths = changedPaths(status);
    if (paths.length > workspaceBudget.maxFiles) return null;
    hash.update('harness-workspace-v1\0');
    hash.update(status);
    hash.update('\0index\0');
    hash.update(indexState);
    for (const name of paths) {
      if (Date.now() > deadline) return null;
      hash.update(`path:${name}\0`);
      const path = resolve(root, name);
      const route = relative(root, path);
      if (route === '..' || route.startsWith(`..${sep}`) || isAbsolute(route)) {
        hash.update('unsafe\0');
        continue;
      }
      if (!existsSync(path)) {
        hash.update('missing\0');
        continue;
      }
      const stat = lstatSync(path);
      if (stat.isFile()) {
        hash.update(`file:${stat.mode & 0o777}:${stat.size}\0`);
        bytes += hashFile(path, hash, deadline);
        if (bytes > workspaceBudget.maxBytes) return null;
      } else if (stat.isSymbolicLink()) {
        hash.update(`symlink:${readlinkSync(path)}\0`);
      } else if (stat.isDirectory()) hash.update('directory\0');
      else hash.update('other\0');
    }
    return `sha256:${hash.digest('hex')}`;
  } catch {
    return null;
  }
}

function localWorkspaceDigest(root: string): string | null {
  try {
    const digest = digestPath(root, {
      exclude: (path) =>
        path === '.git' ||
        path.startsWith(`.git${sep}`) ||
        path === '.agent-docs' ||
        path.startsWith(`.agent-docs${sep}`),
    });
    return digest ? `sha256:${digest}` : null;
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

export function projectSnapshot(
  input = process.cwd(),
  options: ProjectSnapshotOptions = {},
): ProjectSnapshot {
  const budget = createProjectGitBudget(options);
  const { requested, repository, root } = projectLocation(input, budget);
  const status = repository ? projectGit(root, ['status', '--short'], budget) : null;
  const branch = repository ? projectGit(root, ['branch', '--show-current'], budget) : null;
  const head = repository ? projectGit(root, ['rev-parse', '--short=12', 'HEAD'], budget) : null;
  const workspace = budget.exhausted
    ? null
    : repository
      ? workspaceDigest(root, budget)
      : localWorkspaceDigest(root);
  const memoryRoot = join(root, '.agent-docs');
  return {
    requested,
    root,
    name: basename(root),
    isGitRepository: Boolean(repository),
    branch,
    head,
    dirty: status === null ? null : status.length > 0,
    workspaceDigest: workspace,
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
