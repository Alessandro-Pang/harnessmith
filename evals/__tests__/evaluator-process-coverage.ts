// Direct-execution c8 coverage for the shared evaluator process launcher.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeEvaluatorProcess } from '../../scripts/evaluation/codex/evaluator-process.js';

const root = mkdtempSync(join(tmpdir(), 'harnessmith-evaluator-process-'));
try {
  const outputDir = join(root, 'output');
  mkdirSync(outputDir, { recursive: true });
  const entry = join(root, 'fake-evaluator.mjs');
  writeFileSync(
    entry,
    'console.log(JSON.stringify({ scenarioId: process.argv[2], variant: process.argv[3], expected: process.env.HARNESS_EXPECTED_PACKAGE_SHA256, deadline: process.env.HARNESS_EVAL_DEADLINE_MS, outputDir: process.env.HARNESS_EVAL_OUTPUT_DIR }));\n',
  );
  const expectedPackageSha256 = 'a'.repeat(64);
  const result = await executeEvaluatorProcess({
    entry,
    args: ['scenario-1', '1'],
    outputDir,
    attempt: {
      scenarioId: 'scenario-1',
      attempt: 1,
      maxAttempts: 1,
      deadlineMs: 5000,
      signal: new AbortController().signal,
    },
    packageArtifact: join(root, 'candidate.tgz'),
    expectedPackageSha256,
    deadlineMs: 5000,
    model: 'test-model',
    hostVersion: 'test-host',
    scenarioBudgetMs: 10_000,
    matrixBudgetMs: 20_000,
    maxOutputBytes: 65_536,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    scenarioId: 'scenario-1',
    variant: '1',
    expected: expectedPackageSha256,
    deadline: '5000',
    outputDir,
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
