import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { evalAdapterEnum } from '../src/adapter-registry.js';
import type { AgentName } from '../src/types.js';
import {
  assertCandidatePackageFiles,
  candidateRuleFingerprint,
  type RuleFingerprint,
} from './eval-rule-fingerprint.js';
import {
  readScenarioCatalog,
  type ScenarioCatalog,
  scenarioDependencyFingerprints,
  worktreeScenarioCatalog,
} from './eval-scenarios.js';
import {
  type NpmPackageTarball,
  readNpmPackageTarball,
  releaseArtifactPath as resolveReleaseArtifactPath,
} from './npm-tarball.js';

export const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const supportedAdapters = evalAdapterEnum();
export const requiredEvaluationAdapters = ['codex'] as const satisfies readonly AgentName[];

const requiredDistributionFiles = [
  'package.json',
  'bin/harnessmith.mjs',
  'dist/cli.js',
  'template/AGENTS.md',
  'template/agent-harness/bin/harness.mjs',
  'template/agent-harness/dist/harness.mjs',
  'template/agent-harness/manifest.json',
  'template/agent-harness/schemas/task.schema.json',
  'evals/scenarios.json',
  'evals/scenarios.schema.json',
  'evals/run.schema.json',
];

function parseJson<T>(content: Buffer, name: string): T {
  try {
    return JSON.parse(content.toString('utf8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in candidate npm package ${name}: ${message}`);
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function releaseArtifactPath(configured?: string): string {
  return resolveReleaseArtifactPath(configured, repositoryRoot);
}

function scenarioFingerprints(catalog: ScenarioCatalog): Record<string, string> {
  return Object.fromEntries(
    catalog.scenarios.map(({ id, prompt, setup, pass, forbidden }) => [
      id,
      sha256(JSON.stringify({ id, prompt, setup, pass, forbidden })),
    ]),
  );
}

export function evaluationScenarioFingerprints(): Record<string, string> {
  return scenarioFingerprints(worktreeScenarioCatalog(repositoryRoot));
}

function requiredFile(tarball: NpmPackageTarball, path: string): Buffer {
  const content = tarball.files.get(path);
  if (!content) throw new Error(`Candidate npm package is missing ${path}`);
  return content;
}

function assertCurrentReleaseContract(tarball: NpmPackageTarball): RuleFingerprint {
  for (const path of requiredDistributionFiles) requiredFile(tarball, path);
  const candidatePackage = parseJson<{ name?: string; version?: string }>(
    requiredFile(tarball, 'package.json'),
    'package.json',
  );
  const currentPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  if (
    candidatePackage.name !== currentPackage.name ||
    candidatePackage.version !== currentPackage.version
  ) {
    throw new Error('Candidate npm package name/version does not match the release worktree');
  }
  if (!isDeepStrictEqual(candidatePackage, currentPackage)) {
    throw new Error('Candidate package manifest does not match the release worktree');
  }
  const candidateHarness = parseJson<{ harnessVersion?: string }>(
    requiredFile(tarball, 'template/agent-harness/manifest.json'),
    'template/agent-harness/manifest.json',
  );
  const currentHarness = JSON.parse(
    readFileSync(join(repositoryRoot, 'template', 'agent-harness', 'manifest.json'), 'utf8'),
  ) as { harnessVersion: string };
  if (candidateHarness.harnessVersion !== currentHarness.harnessVersion) {
    throw new Error('Candidate Harness version does not match the release worktree');
  }
  const rules = candidateRuleFingerprint(repositoryRoot, tarball);
  const candidateScenarios = requiredFile(tarball, 'evals/scenarios.json');
  readScenarioCatalog(candidateScenarios, requiredFile(tarball, 'evals/scenarios.schema.json'));
  const currentScenarios = readFileSync(join(repositoryRoot, 'evals', 'scenarios.json'));
  if (!candidateScenarios.equals(currentScenarios)) {
    throw new Error('Candidate evaluation scenarios do not match the release worktree');
  }
  const candidateScenarioSchema = requiredFile(tarball, 'evals/scenarios.schema.json');
  const currentScenarioSchema = readFileSync(
    join(repositoryRoot, 'evals', 'scenarios.schema.json'),
  );
  if (!candidateScenarioSchema.equals(currentScenarioSchema)) {
    throw new Error('Candidate evaluation scenario schema does not match the release worktree');
  }
  const candidateRunSchema = requiredFile(tarball, 'evals/run.schema.json');
  const currentRunSchema = readFileSync(join(repositoryRoot, 'evals', 'run.schema.json'));
  if (!candidateRunSchema.equals(currentRunSchema)) {
    throw new Error('Candidate evaluation run schema does not match the release worktree');
  }
  assertCandidatePackageFiles(repositoryRoot, tarball);
  return rules;
}

export function evaluationFingerprint(packageArtifactPath = releaseArtifactPath()) {
  const tarball = readNpmPackageTarball(packageArtifactPath);
  const rules = assertCurrentReleaseContract(tarball);
  const packageManifest = parseJson<{ version: string }>(
    requiredFile(tarball, 'package.json'),
    'package.json',
  );
  const harnessManifest = parseJson<{ harnessVersion: string }>(
    requiredFile(tarball, 'template/agent-harness/manifest.json'),
    'template/agent-harness/manifest.json',
  );
  const catalog = readScenarioCatalog(
    requiredFile(tarball, 'evals/scenarios.json'),
    requiredFile(tarball, 'evals/scenarios.schema.json'),
  );
  return {
    packageVersion: packageManifest.version,
    harnessVersion: harnessManifest.harnessVersion,
    packageArtifactSha256: tarball.sha256,
    behaviorSha256: sha256(JSON.stringify({ schemaVersion: 1, rulesSha256: rules.rulesSha256 })),
    ...rules,
    scenarios: scenarioFingerprints(catalog),
    scenarioDependencies: scenarioDependencyFingerprints(catalog, repositoryRoot),
  };
}
