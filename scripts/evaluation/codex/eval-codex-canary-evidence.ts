import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { verifyHighConfidenceSecretRedaction } from '../records/eval-artifacts.js';
import { sha256, writeCanaryFile } from './eval-codex-canary-common.js';
import type { MachineErrorCanaryResult } from './eval-codex-canary-run.js';

type EvidenceOptions = {
  outputDirectory: string;
  model: string;
  hostVersion: string;
  packageArtifactSha256: string;
  behaviorSha256: string;
  rulesSha256: string;
  scenarioSha256: string;
  dependencySha256: string;
  startedAt: string;
  finishedAt: string;
  scenarioBudgetMs: number;
  maxOutputBytes: number;
  result: MachineErrorCanaryResult;
};

function boundedArtifacts(result: MachineErrorCanaryResult): {
  transcript: string;
  hostStderr: string;
  redactionApplied: boolean;
} {
  try {
    verifyHighConfidenceSecretRedaction('canary transcript', result.stdout);
    verifyHighConfidenceSecretRedaction('canary host stderr', result.stderr);
    return { transcript: result.stdout, hostStderr: result.stderr, redactionApplied: false };
  } catch {
    return {
      transcript: '[redacted: high-confidence secret pattern detected]\n',
      hostStderr: '[redacted: high-confidence secret pattern detected]\n',
      redactionApplied: true,
    };
  }
}

function canaryRecord(
  options: EvidenceOptions,
  artifacts: ReturnType<typeof boundedArtifacts>,
  assessment: string,
) {
  const outcome = artifacts.redactionApplied ? 'evaluator-failed' : options.result.outcome;
  return {
    schemaVersion: 1,
    recordType: 'host-evaluation-canary',
    officialRunRecord: false,
    scenarioId: 'machine-error-contract',
    host: {
      adapter: 'codex',
      product: 'Codex CLI',
      version: options.hostVersion,
      model: options.model,
    },
    subject: {
      packageArtifactSha256: options.packageArtifactSha256,
      behaviorSha256: options.behaviorSha256,
      rulesSha256: options.rulesSha256,
      scenarioSha256: options.scenarioSha256,
      dependencySha256: options.dependencySha256,
    },
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    execution: {
      attempts: options.result.attempts,
      maxAttempts: 1,
      retries: 0,
      concurrency: 1,
      scenarioBudgetMs: options.scenarioBudgetMs,
      maxOutputBytes: options.maxOutputBytes,
      elapsedMs: options.result.elapsedMs,
      hostExitCode: options.result.hostExitCode,
      transportFailures: options.result.transportFailures,
      termination: options.result.termination,
    },
    assertions: {
      scenario: options.result.evaluation?.scenarioAssertions ?? [false, false],
      forbiddenAction: options.result.evaluation?.forbiddenActionAssertions ?? [false],
    },
    usage: { inputTokens: options.result.evaluation?.inputTokens ?? null },
    toolActions: options.result.evaluation?.toolActions ?? [],
    artifacts: {
      transcript: { path: 'transcript.jsonl', sha256: sha256(artifacts.transcript) },
      hostStderr: { path: 'host-stderr.txt', sha256: sha256(artifacts.hostStderr) },
      assessment: { path: 'assessment.txt', sha256: sha256(assessment) },
    },
    verdict: {
      outcome,
      summary: artifacts.redactionApplied
        ? 'Evidence contained a high-confidence secret pattern and was redacted.'
        : (options.result.evaluation?.summary ?? options.result.termination),
    },
    redactionApplied: artifacts.redactionApplied,
    notes:
      'This zero-retry RC canary intentionally does not create run.json because eval run schema v6 fixes maxAttempts at 2.',
  };
}

export function writeCanaryEvidence(options: EvidenceOptions): string {
  if (!isAbsolute(options.outputDirectory) || existsSync(options.outputDirectory)) {
    throw new Error('Canary evidence directory must be a new absolute path');
  }
  mkdirSync(options.outputDirectory, { recursive: true });
  const artifacts = boundedArtifacts(options.result);
  const assessment = `${options.result.evaluation?.summary ?? 'Behavior evaluator did not complete.'}\n`;
  writeCanaryFile(join(options.outputDirectory, 'transcript.jsonl'), artifacts.transcript);
  writeCanaryFile(join(options.outputDirectory, 'host-stderr.txt'), artifacts.hostStderr);
  writeCanaryFile(join(options.outputDirectory, 'assessment.txt'), assessment);
  const recordPath = join(options.outputDirectory, 'canary.json');
  writeCanaryFile(
    recordPath,
    `${JSON.stringify(canaryRecord(options, artifacts, assessment), null, 2)}\n`,
  );
  return recordPath;
}
