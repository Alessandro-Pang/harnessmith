import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NpmPackageTarball } from './npm-tarball.js';

export interface RuleFingerprint {
  rulesSha256: string;
  ruleSources: string[];
}

const rulePrefixes = [
  'bin',
  'dist',
  'template/agent-harness/bin',
  'template/agent-harness/dist',
  'template/agent-harness/docs',
  'template/agent-harness/schemas',
  'template/agent-harness/templates',
];

function filesUnder(path: string): string[] {
  const pending = [{ path, depth: 0 }];
  const files: string[] = [];
  let entries = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    if (directory.depth > 32) throw new Error(`Release rule source exceeds depth limit: ${path}`);
    for (const entry of readdirSync(directory.path, { withFileTypes: true })) {
      entries += 1;
      if (entries > 20_000) throw new Error(`Release rule source exceeds entry limit: ${path}`);
      const target = join(directory.path, entry.name);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`Release rule source contains symlink: ${target}`);
      if (stat.isDirectory()) pending.push({ path: target, depth: directory.depth + 1 });
      else if (stat.isFile()) files.push(target);
      else throw new Error(`Release rule source is not a regular file: ${target}`);
    }
  }
  return files.sort();
}

function declaredPackageFiles(root: string): Map<string, Buffer> {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    files?: unknown;
  };
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.some((path) => typeof path !== 'string' || !path)
  ) {
    throw new Error('Release package manifest files must be a non-empty string array');
  }
  const paths = [join(root, 'package.json')];
  for (const entry of manifest.files as string[]) {
    if (entry.includes('\\') || isAbsolute(entry)) {
      throw new Error(`Unsafe release package manifest path: ${entry}`);
    }
    const target = resolve(root, entry);
    const targetRelative = relative(root, target);
    if (
      !targetRelative ||
      targetRelative === '..' ||
      targetRelative.startsWith(`..${sep}`) ||
      isAbsolute(targetRelative)
    ) {
      throw new Error(`Unsafe release package manifest path: ${entry}`);
    }
    const stat = lstatSync(target);
    if (stat.isSymbolicLink())
      throw new Error(`Release package source contains symlink: ${target}`);
    if (stat.isDirectory()) paths.push(...filesUnder(target));
    else if (stat.isFile()) paths.push(target);
    else throw new Error(`Release package source is not a regular file: ${target}`);
  }
  return new Map(
    [...new Set(paths)]
      .sort()
      .map((path) => [relative(root, path).split(sep).join('/'), readFileSync(path)]),
  );
}

export function assertCandidatePackageFiles(root: string, tarball: NpmPackageTarball): void {
  const expected = declaredPackageFiles(root);
  const expectedPaths = [...expected.keys()].sort();
  const candidatePaths = [...tarball.files.keys()].sort();
  const missing = expectedPaths.filter((path) => !tarball.files.has(path));
  const unexpected = candidatePaths.filter((path) => !expected.has(path));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
      unexpected.length > 0 ? `unexpected: ${unexpected.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `Candidate npm package file set does not match the release worktree: ${details}`,
    );
  }
  for (const path of expectedPaths) {
    if (!(tarball.files.get(path) as Buffer).equals(expected.get(path) as Buffer)) {
      throw new Error(
        `Candidate npm package file content does not match the release worktree: ${path}`,
      );
    }
  }
}

function worktreeRuleFiles(root: string): Map<string, Buffer> {
  const paths = [
    ...filesUnder(join(root, 'bin')),
    ...filesUnder(join(root, 'dist')),
    join(root, 'template', 'AGENTS.md'),
    ...filesUnder(join(root, 'template', 'agent-harness', 'bin')),
    ...filesUnder(join(root, 'template', 'agent-harness', 'dist')),
    ...filesUnder(join(root, 'template', 'agent-harness', 'docs')),
    join(root, 'template', 'agent-harness', 'manifest.json'),
    ...filesUnder(join(root, 'template', 'agent-harness', 'schemas')),
    ...filesUnder(join(root, 'template', 'agent-harness', 'templates')),
  ].sort();
  return new Map(
    paths.map((path) => [relative(root, path).split(sep).join('/'), readFileSync(path)]),
  );
}

function isRuleSource(path: string): boolean {
  return (
    path === 'template/AGENTS.md' ||
    path === 'template/agent-harness/manifest.json' ||
    rulePrefixes.some((prefix) => path.startsWith(`${prefix}/`))
  );
}

function digest(files: ReadonlyMap<string, Buffer>): string {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    hash.update(path);
    hash.update('\0');
    hash.update(files.get(path) as Buffer);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function candidateRuleFingerprint(
  root: string,
  tarball: NpmPackageTarball,
): RuleFingerprint {
  const candidate = new Map([...tarball.files].filter(([path]) => isRuleSource(path)));
  const current = worktreeRuleFiles(root);
  const ruleSources = [...candidate.keys()].sort();
  if (
    JSON.stringify(ruleSources) !== JSON.stringify([...current.keys()].sort()) ||
    digest(candidate) !== digest(current)
  ) {
    throw new Error('Candidate distributed rules do not match the release worktree');
  }
  return { rulesSha256: digest(candidate), ruleSources };
}
