import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { evaluationFingerprint } from '../records/eval-fingerprint.js';

export type CodexMatrixOptions = {
  packageArtifact: string;
  expectedPackageSha256: string;
  model: string;
  concurrency: number;
  scenarioBudgetMs: number;
  matrixBudgetMs: number;
  maxOutputBytes: number;
  outputDir: string;
};

function boundedInteger(label: string, value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function validateMatrixOptions(raw: Record<string, string>): CodexMatrixOptions {
  const concurrency = boundedInteger('Host Eval concurrency', raw.concurrency, 1, 3);
  const scenarioBudgetMs = boundedInteger(
    'Host Eval scenario budget',
    raw.scenarioBudgetMs,
    1,
    900_000,
  );
  const matrixBudgetMs = boundedInteger(
    'Host Eval matrix budget',
    raw.matrixBudgetMs,
    scenarioBudgetMs,
    3_600_000,
  );
  const maxOutputBytes = boundedInteger(
    'Host process output limit',
    raw.maxOutputBytes,
    1,
    1_048_576,
  );
  if (!/^[a-f0-9]{64}$/u.test(raw.expectedPackageSha256)) {
    throw new Error('Expected package artifact SHA-256 must contain 64 lowercase hex characters');
  }
  if (!raw.model.trim()) throw new Error('Codex model must be non-empty');
  if (!isAbsolute(raw.packageArtifact)) {
    throw new Error('Candidate package artifact path must be absolute');
  }
  if (!isAbsolute(raw.outputDir)) throw new Error('Matrix output directory must be absolute');
  return {
    packageArtifact: raw.packageArtifact,
    expectedPackageSha256: raw.expectedPackageSha256,
    model: raw.model,
    concurrency,
    scenarioBudgetMs,
    matrixBudgetMs,
    maxOutputBytes,
    outputDir: raw.outputDir,
  };
}

export function requireMatrixCandidate(options: CodexMatrixOptions) {
  if (existsSync(options.outputDir)) {
    throw new Error('Matrix output directory must not already exist');
  }
  const fingerprint = evaluationFingerprint(options.packageArtifact);
  if (fingerprint.packageArtifactSha256 !== options.expectedPackageSha256) {
    throw new Error(
      `Candidate artifact SHA-256 mismatch: expected ${options.expectedPackageSha256}, received ${fingerprint.packageArtifactSha256}`,
    );
  }
  return fingerprint;
}
