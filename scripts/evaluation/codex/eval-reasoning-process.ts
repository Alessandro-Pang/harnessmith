/** Thin subprocess adapter for one reasoning case in the unified Codex suite. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluationFingerprint } from '../records/eval-fingerprint.js';
import { validateMatrixOptions } from './eval-codex-options.js';
import { executeReasoningScenario } from './eval-codex-reasoning.js';
import { runSemanticReview } from './eval-semantic-review.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function integer(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return value;
}
function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function main(): Promise<void> {
  const scenarioId = process.argv[2];
  if (!scenarioId) throw new Error('usage: eval-reasoning-process.ts <scenario-id>');
  const outputDir = required('HARNESS_EVAL_OUTPUT_DIR');
  const candidate = required('HARNESS_RELEASE_ARTIFACT');
  if (!isAbsolute(candidate) || !isAbsolute(outputDir))
    throw new Error('candidate and output directory must be absolute');
  if (!existsSync(candidate)) throw new Error('candidate artifact does not exist');
  const fingerprint = evaluationFingerprint(candidate);
  const expectedDigest = required('HARNESS_EXPECTED_PACKAGE_SHA256');
  if (fingerprint.packageArtifactSha256 !== expectedDigest)
    throw new Error('candidate artifact digest mismatch');
  const deadlineMs = Number(
    integer('HARNESS_EVAL_DEADLINE_MS', required('HARNESS_EVAL_DEADLINE_MS')),
  );
  const scenarioBudgetMs = Number(integer('HARNESS_EVAL_SCENARIO_BUDGET_MS', String(deadlineMs)));
  const matrixBudgetMs = Number(integer('HARNESS_EVAL_MATRIX_BUDGET_MS', String(deadlineMs)));
  const maxOutputBytes = Number(integer('HARNESS_EVAL_MAX_OUTPUT_BYTES', '1048576'));
  const options = validateMatrixOptions({
    packageArtifact: candidate,
    expectedPackageSha256: expectedDigest,
    model: required('HARNESS_EVAL_MODEL'),
    outputDir,
    concurrency: '1',
    scenarioBudgetMs: String(Math.min(scenarioBudgetMs, deadlineMs)),
    matrixBudgetMs: String(Math.max(matrixBudgetMs, scenarioBudgetMs)),
    maxOutputBytes: String(maxOutputBytes),
  });
  const remainingMs = Math.max(1, deadlineMs - Date.now());
  const attemptSignal = AbortSignal.timeout(remainingMs);
  const result = await executeReasoningScenario(options, scenarioId, {
    signal: attemptSignal,
    deadlineMs,
  });
  if (result.outcome === 'evaluator-inconclusive' && result.evidence.semanticReviewRequest) {
    const remainingForJudge = Math.max(1, deadlineMs - Date.now());
    const review = await runSemanticReview({
      criteria: [result.evidence.semanticReviewRequest],
      evidence: [
        { ref: 'trace', content: JSON.stringify(result.evidence.commandTrace) },
        { ref: 'structural', content: JSON.stringify(result.evidence) },
      ],
      workspace: outputDir,
      model: options.model,
      signal: AbortSignal.timeout(remainingForJudge),
    });
    result.evidence.semanticReview =
      review.outcome === 'passed' ? 'passed' : review.outcome === 'failed' ? 'failed' : 'pending';
    if (review.outcome === 'failed') result.outcome = 'behavior-failed';
    else if (review.outcome !== 'passed') result.outcome = 'evaluator-inconclusive';
  }
  const record = {
    schemaVersion: 1,
    recordType: 'codex-reasoning-case',
    scenarioId,
    attempt: Number(integer('HARNESS_EVAL_ATTEMPT', '1')),
    candidateSha256: expectedDigest,
    host: {
      model: options.model,
      reasoningEffort: 'medium',
      version: required('HARNESS_EVAL_HOST_VERSION'),
    },
    outcome: result.outcome,
    evidenceDigest: sha256(result.evidence),
    result,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'result.json'), `${JSON.stringify(record, null, 2)}\n`, {
    flag: 'w',
  });
  process.stdout.write(`${JSON.stringify({ scenarioId, outcome: result.outcome })}\n`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
