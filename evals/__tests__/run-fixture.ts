import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, onTestFinished } from 'vitest';
import { writeCandidateTarball } from './tarball-fixture.js';

export const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const entry = join(root, 'scripts', 'eval-gate.ts');
const candidateDirectory = mkdtempSync(join(tmpdir(), 'harnessmith-eval-candidate-'));
export const candidateArtifact = join(candidateDirectory, 'harnessmith-test-candidate.tgz');
writeCandidateTarball(candidateArtifact, root);
afterAll(() => rmSync(candidateDirectory, { force: true, recursive: true }));

export function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_RELEASE_ARTIFACT: candidateArtifact, ...env },
  });
}

export function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'harnessmith-eval-'));
  onTestFinished(() => rmSync(path, { force: true, recursive: true }));
  return path;
}

let fingerprintCache:
  | {
      packageVersion: string;
      harnessVersion: string;
      packageArtifactSha256: string;
      behaviorSha256: string;
      rulesSha256: string;
      scenarios: Record<string, string>;
    }
  | undefined;

export function currentFingerprint() {
  if (fingerprintCache) return fingerprintCache;
  const result = run(['fingerprint', '--json']);
  assert.equal(result.status, 0, result.stderr);
  fingerprintCache = JSON.parse(result.stdout) as NonNullable<typeof fingerprintCache>;
  return fingerprintCache;
}

export function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function writeRun(
  runsDirectory: string,
  {
    adapter = 'codex',
    scenarioId = 'progressive-disclosure',
    finishedAt = new Date().toISOString(),
    evaluatedAt = finishedAt,
    outcome = 'passed',
    runId = `${adapter}-${scenarioId}`,
  }: {
    adapter?: 'codex' | 'cursor' | 'claude' | 'opencode';
    scenarioId?: string;
    finishedAt?: string;
    evaluatedAt?: string;
    outcome?: 'passed' | 'failed' | 'inconclusive';
    runId?: string;
  } = {},
): string {
  const subject = currentFingerprint();
  const scenarios = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8'))
    .scenarios as Array<{ id: string; pass: string[]; forbidden: string[] }>;
  const scenario = scenarios.find(({ id }) => id === scenarioId);
  if (!scenario) throw new Error(`Unknown fixture scenario: ${scenarioId}`);
  const directory = join(runsDirectory, runId);
  mkdirSync(directory, { recursive: true });
  const transcript = 'redacted host transcript\n';
  const filesystemDiff = 'no filesystem changes\n';
  writeFileSync(join(directory, 'transcript.md'), transcript);
  writeFileSync(join(directory, 'filesystem-diff.txt'), filesystemDiff);
  const record = {
    schemaVersion: 4,
    recordType: 'host-evaluation',
    runId,
    scenarioId,
    host: {
      adapter,
      product: `${adapter} test host`,
      version: '1.2.3',
      model: 'test-model',
      modelVersion: '2026-08-21',
    },
    subject: {
      packageVersion: subject.packageVersion,
      harnessVersion: subject.harnessVersion,
      packageArtifactSha256: subject.packageArtifactSha256,
      scenarioSha256: subject.scenarios[scenarioId],
      rulesSha256: subject.rulesSha256,
    },
    startedAt: new Date(Date.parse(finishedAt) - 60_000).toISOString(),
    finishedAt,
    evaluatedAt,
    transcript: {
      artifactRef: 'local:transcript.md',
      sha256: digest(transcript),
      redacted: true,
    },
    toolActions: [
      {
        sequence: 1,
        tool: 'filesystem.read',
        kind: 'read',
        target: 'task-file',
        outcome: 'completed',
        approval: 'not-required',
      },
    ],
    filesystemDiff: {
      artifactRef: 'local:filesystem-diff.txt',
      sha256: digest(filesystemDiff),
      changedPaths: [],
      clean: true,
    },
    scenarioAssertions: scenario.pass.map((description, index) => ({
      id: `pass-${index + 1}`,
      description,
      passed: true,
      evidenceRefs: ['redacted-transcript', 'filesystem-diff'],
    })),
    forbiddenActionAssertions: scenario.forbidden.map((description, index) => ({
      id: `forbidden-${index + 1}`,
      description,
      passed: true,
      evidenceRefs: ['filesystem-diff'],
    })),
    verdict: {
      outcome,
      evaluator: 'test evaluator',
      summary: 'Observable contract evidence was reviewed.',
      evidenceRefs: ['redacted-transcript', 'filesystem-diff'],
    },
    evidence: [
      {
        id: 'redacted-transcript',
        kind: 'transcript',
        artifactRef: 'local:transcript.md',
        sha256: digest(transcript),
        description: 'Redacted transcript.',
      },
      {
        id: 'filesystem-diff',
        kind: 'diff',
        artifactRef: 'local:filesystem-diff.txt',
        sha256: digest(filesystemDiff),
        description: 'Filesystem diff.',
      },
    ],
  };
  const path = join(directory, 'run.json');
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}
