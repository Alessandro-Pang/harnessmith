import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import type { InheritedEvaluationSource } from './eval-contract.js';
import { repositoryRoot, requiredEvaluationAdapters } from './eval-fingerprint.js';
import { readNpmPackageTarball } from './npm-tarball.js';

export interface ReleaseState {
  schemaVersion: 3 | 4;
  status: 'prepared' | 'published';
  artifactPath: string;
  artifactSha256: string;
  packageVersion: string;
  preparedAt: string;
  publishedAt?: string;
  evaluation: {
    assurance: 'maintainer-attested-structure' | 'maintainer-attested-risk-exception';
    coverageCount: number;
    exactArtifactCoverageCount: number;
    inheritedBehaviorCoverageCount: number;
    inheritedFrom: InheritedEvaluationSource[];
    packageArtifactSha256: string;
    behaviorSha256: string;
    harnessVersion: string;
    rulesSha256: string;
    scenarios: Record<string, string>;
    requiredHosts: string[];
    riskAcceptance?: ReleaseRiskAcceptance;
  };
}

export interface ReleaseRiskAcceptance {
  schemaVersion: 1;
  acceptedAt: string;
  authorizedBy: 'user';
  reason: string;
  uncoveredScenarios: string[];
  packageVersion: string;
  packageArtifactSha256: string;
}

export function releaseStateDirectory(configured?: string): string {
  const directory = resolve(repositoryRoot, configured ?? '.release');
  if (existsSync(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Release state directory must be a real directory: ${directory}`);
    }
  } else {
    mkdirSync(directory, { mode: 0o700, recursive: true });
  }
  chmodSync(directory, 0o700);
  return directory;
}

function statePath(directory: string): string {
  return join(directory, 'release-state.json');
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((entry) => typeof entry === 'string' && sha256Pattern.test(entry))
  );
}

export function releaseRiskAcceptanceIsValid(
  value: unknown,
  artifactSha256: unknown,
  packageVersion: unknown,
): value is ReleaseRiskAcceptance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const acceptance = value as Partial<ReleaseRiskAcceptance>;
  return (
    acceptance.schemaVersion === 1 &&
    acceptance.authorizedBy === 'user' &&
    typeof acceptance.acceptedAt === 'string' &&
    Number.isFinite(Date.parse(acceptance.acceptedAt)) &&
    typeof acceptance.reason === 'string' &&
    acceptance.reason.trim().length > 0 &&
    acceptance.reason.length <= 500 &&
    Array.isArray(acceptance.uncoveredScenarios) &&
    acceptance.uncoveredScenarios.length > 0 &&
    new Set(acceptance.uncoveredScenarios).size === acceptance.uncoveredScenarios.length &&
    acceptance.uncoveredScenarios.every(
      (scenario) =>
        typeof scenario === 'string' &&
        /^(?:codex|cursor|claude-code|opencode)\/[a-z0-9][a-z0-9-]*$/u.test(scenario),
    ) &&
    acceptance.packageVersion === packageVersion &&
    acceptance.packageArtifactSha256 === artifactSha256
  );
}

function hasValidEvaluation(
  value: unknown,
  artifactSha256: unknown,
  packageVersion: unknown,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evaluation = value as Partial<ReleaseState['evaluation']>;
  return (
    ['maintainer-attested-structure', 'maintainer-attested-risk-exception'].includes(
      String(evaluation.assurance),
    ) &&
    Number.isSafeInteger(evaluation.coverageCount) &&
    Number(evaluation.coverageCount) >= 0 &&
    Number.isSafeInteger(evaluation.exactArtifactCoverageCount) &&
    Number(evaluation.exactArtifactCoverageCount) >= 0 &&
    Number.isSafeInteger(evaluation.inheritedBehaviorCoverageCount) &&
    Number(evaluation.inheritedBehaviorCoverageCount) >= 0 &&
    Number(evaluation.exactArtifactCoverageCount) +
      Number(evaluation.inheritedBehaviorCoverageCount) ===
      Number(evaluation.coverageCount) &&
    Array.isArray(evaluation.inheritedFrom) &&
    evaluation.inheritedFrom.every(
      (source) =>
        !!source &&
        typeof source === 'object' &&
        typeof source.packageVersion === 'string' &&
        source.packageVersion.length > 0 &&
        typeof source.packageArtifactSha256 === 'string' &&
        sha256Pattern.test(source.packageArtifactSha256),
    ) &&
    (Number(evaluation.inheritedBehaviorCoverageCount) === 0
      ? evaluation.inheritedFrom.length === 0
      : evaluation.inheritedFrom.length > 0) &&
    typeof evaluation.packageArtifactSha256 === 'string' &&
    sha256Pattern.test(evaluation.packageArtifactSha256) &&
    evaluation.packageArtifactSha256 === artifactSha256 &&
    typeof evaluation.behaviorSha256 === 'string' &&
    sha256Pattern.test(evaluation.behaviorSha256) &&
    typeof evaluation.harnessVersion === 'string' &&
    evaluation.harnessVersion.length > 0 &&
    typeof evaluation.rulesSha256 === 'string' &&
    sha256Pattern.test(evaluation.rulesSha256) &&
    isStringRecord(evaluation.scenarios) &&
    Array.isArray(evaluation.requiredHosts) &&
    JSON.stringify(evaluation.requiredHosts) === JSON.stringify(requiredEvaluationAdapters) &&
    (evaluation.assurance === 'maintainer-attested-structure'
      ? !evaluation.riskAcceptance &&
        Number(evaluation.coverageCount) >=
          evaluation.requiredHosts.length * Object.keys(evaluation.scenarios).length
      : releaseRiskAcceptanceIsValid(evaluation.riskAcceptance, artifactSha256, packageVersion) &&
        evaluation.riskAcceptance.uncoveredScenarios.every((entry) => {
          const [host, scenario] = entry.split('/');
          return (
            evaluation.requiredHosts?.includes(host) === true &&
            Object.hasOwn(evaluation.scenarios ?? {}, scenario)
          );
        }))
  );
}

export function readReleaseState(directory: string): ReleaseState | undefined {
  const path = statePath(directory);
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Release state must be a regular file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid release state: ${message}`);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    ![3, 4].includes(Number((parsed as Partial<ReleaseState>).schemaVersion)) ||
    !['prepared', 'published'].includes(String((parsed as Partial<ReleaseState>).status)) ||
    typeof (parsed as Partial<ReleaseState>).artifactPath !== 'string' ||
    typeof (parsed as Partial<ReleaseState>).artifactSha256 !== 'string' ||
    !sha256Pattern.test(String((parsed as Partial<ReleaseState>).artifactSha256)) ||
    typeof (parsed as Partial<ReleaseState>).packageVersion !== 'string' ||
    typeof (parsed as Partial<ReleaseState>).preparedAt !== 'string' ||
    !hasValidEvaluation(
      (parsed as Partial<ReleaseState>).evaluation,
      (parsed as Partial<ReleaseState>).artifactSha256,
      (parsed as Partial<ReleaseState>).packageVersion,
    )
  ) {
    throw new Error(`Invalid release state structure: ${path}`);
  }
  return parsed as ReleaseState;
}

export function writeReleaseState(directory: string, state: ReleaseState): void {
  const target = statePath(directory);
  writeFileAtomic.sync(target, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
}

export function checkedPreparedState(directory: string, state: ReleaseState): ReleaseState {
  if (state.status === 'published') {
    throw new Error(
      `Release ${state.packageVersion} is already recorded as published; provide a new candidate to prepare another release`,
    );
  }
  const artifact = resolve(state.artifactPath);
  if (dirname(artifact) !== directory) {
    throw new Error(`Prepared release artifact escaped its state directory: ${artifact}`);
  }
  if (!existsSync(artifact)) throw new Error(`Prepared release artifact is missing: ${artifact}`);
  let actual: string;
  try {
    actual = readNpmPackageTarball(artifact).sha256;
  } catch {
    throw new Error(`Prepared release artifact changed after checks: ${artifact}`);
  }
  if (actual !== state.artifactSha256) {
    throw new Error(`Prepared release artifact changed after checks: ${artifact}`);
  }
  return { ...state, artifactPath: artifact };
}
