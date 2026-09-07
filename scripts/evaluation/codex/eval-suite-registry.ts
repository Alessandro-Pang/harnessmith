import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { worktreeScenarioCatalog } from '../planning/eval-scenarios.js';
import { repositoryRoot } from '../records/eval-fingerprint.js';
import { reasoningScenarioManifest } from './eval-codex-reasoning.js';

export type EvaluationCase = {
  id: string;
  family: 'behavior' | 'memory' | 'reasoning';
  sourceId: string;
  promptVariant?: number;
  implemented: boolean;
  requirements: string[];
};

const PLAYBOOK_SCENARIOS: Record<string, string[]> = {
  change: ['safe-path-boundary', 'memory-lifecycle-boundary'],
  diagnose: ['progressive-disclosure', 'machine-error-contract'],
  review: ['destructive-boundary', 'task-acceptance-gate'],
  'research-and-design': ['cross-repository-map-writeback'],
  'release-and-external': ['destructive-boundary', 'task-acceptance-gate'],
  'understand-and-map': ['progressive-disclosure', 'cross-repository-map-writeback'],
  'verify-and-accept': ['task-acceptance-gate', 'machine-error-contract'],
};

type MemoryScenario = {
  id: string;
  operation: string;
  promptVariants: string[];
  evaluationStatus: string;
  stateContract?: unknown;
};

export function evaluationRegistry(): EvaluationCase[] {
  const memory = JSON.parse(
    readFileSync(join(repositoryRoot, 'evals/memory/scenarios.v1.json'), 'utf8'),
  ) as { scenarios: MemoryScenario[] };
  const entries: EvaluationCase[] = [
    ...worktreeScenarioCatalog(repositoryRoot).scenarios.map((scenario) => ({
      id: `behavior:${scenario.id}`,
      family: 'behavior' as const,
      sourceId: scenario.id,
      implemented: true,
      requirements: [
        `behavior:${scenario.id}`,
        ...Object.entries(PLAYBOOK_SCENARIOS)
          .filter(([, scenarioIds]) => scenarioIds.includes(scenario.id))
          .map(([playbook]) => `playbook:${playbook}`),
      ],
    })),
    ...memory.scenarios.flatMap((scenario) =>
      scenario.promptVariants.map((_, promptVariant) => ({
        id: `memory:${scenario.id}:${promptVariant}`,
        family: 'memory' as const,
        sourceId: scenario.id,
        promptVariant,
        implemented: scenario.evaluationStatus === 'active' && scenario.stateContract !== undefined,
        requirements: [
          `profile-scenario:${scenario.id}`,
          ...(scenario.operation === 'none' ? [] : [`memory-operation:${scenario.operation}`]),
        ],
      })),
    ),
    ...reasoningScenarioManifest.map((scenario) => ({
      id: `reasoning:${scenario.id}`,
      family: 'reasoning' as const,
      sourceId: scenario.id,
      implemented: true,
      requirements: scenario.mode
        ? [`reasoning:${scenario.mode}:${scenario.activation}`]
        : ['reasoning:negative'],
    })),
  ];
  if (entries.length === 0 || new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error('Evaluation registry must be nonempty and unique');
  return entries;
}

/** Freeze evaluator code as well as prompts/oracles: a scoring change invalidates old evidence. */
export function evaluationContractDigest(): string {
  const hash = createHash('sha256');
  const paths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'runs') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:json|ts|mjs)$/u.test(entry.name)) paths.push(path);
    }
  };
  visit(join(repositoryRoot, 'scripts/evaluation'));
  visit(join(repositoryRoot, 'evals'));
  for (const path of paths.sort())
    hash
      .update(relative(repositoryRoot, path))
      .update('\0')
      .update(readFileSync(path))
      .update('\0');
  return hash.digest('hex');
}
