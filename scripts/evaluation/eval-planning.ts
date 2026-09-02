import { posix, win32 } from 'node:path';
import { repositoryRoot } from './eval-fingerprint.js';
import { worktreeScenarioCatalog } from './eval-scenarios.js';

export type EvaluationPlan = {
  version: 1;
  tier: 'L1' | 'L2' | 'L3';
  reason:
    | 'deterministic-only'
    | 'mapped-behavior-change'
    | 'unmapped-behavior-source'
    | 'selection-exceeds-l2-limit';
  changedFiles: string[];
  scenarios: string[];
};

const behaviorPrefixes = [
  'src/',
  'template/agent-harness/src/',
  'template/agent-harness/docs/',
  'template/agent-harness/schemas/',
  'template/agent-harness/templates/',
];
const behaviorFiles = new Set([
  'template/AGENTS.md',
  'evals/scenarios.json',
  'evals/scenarios.schema.json',
  'evals/run.schema.json',
]);

function normalizeChangedFiles(changedFiles: string[]): string[] {
  const normalized = changedFiles.map((path) => {
    if (
      path.length === 0 ||
      path.includes('\\') ||
      posix.isAbsolute(path) ||
      win32.isAbsolute(path) ||
      posix.normalize(path) !== path ||
      path === '.' ||
      path === '..' ||
      path.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error(`Unsafe changed file path: ${path}`);
    }
    return path;
  });
  return [...new Set(normalized)].sort();
}

function isBehaviorFile(path: string): boolean {
  return behaviorFiles.has(path) || behaviorPrefixes.some((prefix) => path.startsWith(prefix));
}

function dependencyMatches(path: string, dependency: string): boolean {
  return path === dependency || path.startsWith(`${dependency}/`);
}

export function planEvaluation(changedFileInputs: string[]): EvaluationPlan {
  const changedFiles = normalizeChangedFiles(changedFileInputs);
  const behaviorChanges = changedFiles.filter(isBehaviorFile);
  const catalog = worktreeScenarioCatalog(repositoryRoot);
  const allScenarios = catalog.scenarios.map(({ id }) => id);
  if (behaviorChanges.length === 0) {
    return { version: 1, tier: 'L1', reason: 'deterministic-only', changedFiles, scenarios: [] };
  }
  const selected = catalog.scenarios.filter(({ dependencyPaths }) =>
    behaviorChanges.some((path) =>
      dependencyPaths.some((dependency) => dependencyMatches(path, dependency)),
    ),
  );
  const unmapped = behaviorChanges.some((path) =>
    selected.every(({ dependencyPaths }) =>
      dependencyPaths.every((dependency) => !dependencyMatches(path, dependency)),
    ),
  );
  if (unmapped) {
    return {
      version: 1,
      tier: 'L3',
      reason: 'unmapped-behavior-source',
      changedFiles,
      scenarios: allScenarios,
    };
  }
  if (selected.length > 3) {
    return {
      version: 1,
      tier: 'L3',
      reason: 'selection-exceeds-l2-limit',
      changedFiles,
      scenarios: allScenarios,
    };
  }
  return {
    version: 1,
    tier: 'L2',
    reason: 'mapped-behavior-change',
    changedFiles,
    scenarios: selected.map(({ id }) => id),
  };
}
