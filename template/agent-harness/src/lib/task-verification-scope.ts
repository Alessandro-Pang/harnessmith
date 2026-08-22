import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createDigestBudget, type DigestBudget, type DigestOptions, digestPath } from './files.js';
import { isPathInside } from './safe-path.js';

const maxVerificationScopes = 16;
const taskDigestDefaults = {
  maxEntries: 25_000,
  maxBytes: 128 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxDepth: 32,
  maxDurationMs: 15_000,
};

export type VerificationDigestOptions = Pick<
  DigestOptions,
  'maxEntries' | 'maxBytes' | 'maxFileBytes' | 'maxDepth' | 'maxDurationMs'
>;

interface VerificationScope {
  root: string;
  path: string;
  target: string;
  depth: number;
}

function excludesHarnessMetadata(path: string): boolean {
  return path
    .split(/[\\/]/)
    .map((component) => component.normalize('NFC').toLowerCase())
    .some((component) => component === '.git' || component === '.agent-docs');
}

function relativeScope(root: string, input: string, budget: DigestBudget): VerificationScope {
  const value = input.trim();
  if (!value || isAbsolute(value)) throw new Error(`Invalid verification scope: ${input}`);
  const target = resolve(root, value);
  const route = relative(root, target);
  if (!isPathInside(root, target)) {
    throw new Error(`Verification scope escapes project root: ${input}`);
  }
  const path = (route || '.').split(sep).join('/');
  if (excludesHarnessMetadata(path)) {
    throw new Error(`Verification scope targets harness metadata: ${input}`);
  }
  const depth = path === '.' ? 0 : path.split('/').length;
  if (depth > budget.maxDepth) throw new Error(`Digest depth budget exceeded: ${target}`);
  return { root, path, target, depth };
}

function digestBudget(options: VerificationDigestOptions): DigestBudget {
  return createDigestBudget({ ...taskDigestDefaults, ...options });
}

function normalizedScopes(
  root: string,
  inputs: string[],
  budget: DigestBudget,
): VerificationScope[] {
  if (inputs.length === 0) throw new Error('Mechanical verification requires --scope <path>');
  if (inputs.length > maxVerificationScopes) {
    throw new Error(
      `Mechanical verification accepts at most ${maxVerificationScopes} verification scopes`,
    );
  }
  const scopes = [
    ...new Map(
      inputs.map((input) => {
        const scope = relativeScope(root, input, budget);
        return [scope.path, scope] as const;
      }),
    ).values(),
  ].sort((left, right) => left.path.localeCompare(right.path));
  for (let index = 0; index < scopes.length; index += 1) {
    for (let other = index + 1; other < scopes.length; other += 1) {
      if (scopes[index].path === '.' || scopes[other].path.startsWith(`${scopes[index].path}/`)) {
        throw new Error(
          `Overlapping verification scopes are not allowed: ${scopes[index].path}, ${scopes[other].path}`,
        );
      }
    }
  }
  return scopes;
}

function scopeDigest(
  scope: VerificationScope,
  budget: DigestBudget,
): { path: string; digest: string } {
  const digest = digestPath(scope.target, {
    budget,
    baseDepth: scope.depth,
    authorizedRoot: scope.root,
    exclude: excludesHarnessMetadata,
    rejectSymlinks: true,
    rejectSpecial: true,
  });
  if (!digest) throw new Error(`Verification scope does not exist: ${scope.target}`);
  return { path: scope.path, digest: `sha256:${digest}` };
}

export function captureScopeDigests(
  root: string,
  inputs: string[],
  options: VerificationDigestOptions = {},
): Array<{ path: string; digest: string }> {
  const budget = digestBudget(options);
  return normalizedScopes(root, inputs, budget).map((scope) => scopeDigest(scope, budget));
}

export function scopeDigestsAreFresh(
  root: string,
  expected: Array<{ path: string; digest: string }>,
): boolean {
  if (expected.length === 0) return false;
  try {
    const actual = captureScopeDigests(
      root,
      expected.map(({ path }) => path),
    );
    const digests = new Map(expected.map(({ path, digest }) => [path, digest]));
    return (
      actual.length === expected.length &&
      actual.every((item) => digests.get(item.path) === item.digest)
    );
  } catch {
    return false;
  }
}

export function fileDigest(root: string, input: string): { path: string; digest: string } {
  const budget = digestBudget({});
  const scope = relativeScope(root, input, budget);
  const digest = digestPath(scope.target, {
    budget,
    baseDepth: scope.depth,
    authorizedRoot: root,
    rejectSymlinks: true,
    rejectSpecial: true,
    requireRootFile: true,
  });
  if (!digest) throw new Error(`Verification scope does not exist: ${scope.target}`);
  return { path: scope.path, digest: `sha256:${digest}` };
}

export function fileDigestIsFresh(root: string, path: string, expected: string): boolean {
  try {
    return fileDigest(root, path).digest === expected;
  } catch {
    return false;
  }
}
