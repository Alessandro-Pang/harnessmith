import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScenarioExecutor } from '../../scripts/eval-codex-scenario-process.js';

const directory = mkdtempSync(join(tmpdir(), 'harnessmith-matrix-coverage-'));
try {
  const scenarioEntry = join(directory, 'scenario.mjs');
  writeFileSync(
    scenarioEntry,
    `const id = process.argv[2];
if (id === 'exit') process.exit(7);
if (id === 'malformed') process.stdout.write('not-json\\n');
else if (id === 'slow') setTimeout(() => {}, 10000);
else {
  const values = {
    passed: ['passed', 'completed'],
    behavior: ['behavior-failed', 'completed'],
    infra: ['infra-inconclusive', 'transport-failure'],
    evaluator: ['evaluator-failed', 'evaluator-failure'],
    mismatch: ['passed', 'completed'],
  };
  const [outcome, termination] = values[id];
  process.stdout.write(JSON.stringify({ scenarioId: id === 'mismatch' ? 'other' : id, outcome, termination }) + '\\n');
}
`,
  );
  const execute = createScenarioExecutor({
    packageArtifact: join(directory, 'candidate.tgz'),
    outputDir: join(directory, 'runs'),
    model: 'gpt-5.6-sol',
    scenarioBudgetMs: 900_000,
    matrixBudgetMs: 3_600_000,
    maxOutputBytes: 1_048_576,
    hostVersion: 'codex-cli test',
    scenarioEntry,
  });
  const attempt = (scenarioId: string, signal = new AbortController().signal) =>
    execute({
      scenarioId,
      attempt: 1,
      maxAttempts: 2,
      deadlineMs: Date.now() + 900_000,
      signal,
    });

  assert.deepEqual(await attempt('passed'), { outcome: 'passed', termination: 'completed' });
  assert.deepEqual(await attempt('behavior'), {
    outcome: 'behavior-failed',
    termination: 'completed',
  });
  assert.deepEqual(await attempt('infra'), {
    outcome: 'infra-inconclusive',
    termination: 'transport-failure',
  });
  for (const scenarioId of ['evaluator', 'mismatch', 'malformed', 'exit']) {
    assert.deepEqual(await attempt(scenarioId), {
      outcome: 'evaluator-failed',
      termination: 'evaluator-failure',
    });
  }
  const controller = new AbortController();
  const canceled = attempt('slow', controller.signal);
  controller.abort();
  assert.deepEqual(await canceled, {
    outcome: 'infra-inconclusive',
    termination: 'transport-failure',
  });
} finally {
  rmSync(directory, { force: true, recursive: true });
}
