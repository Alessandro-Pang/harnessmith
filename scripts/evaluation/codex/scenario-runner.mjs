import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodexScenario } from './scenario/execution.mjs';

const [scenarioId, ...extraArguments] = process.argv.slice(2);
const host = 'codex';
if (!scenarioId || extraArguments.length > 0) {
  throw new Error('usage: eval-codex-scenario.mjs <scenario>');
}
const repository = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const nodeBin = process.execPath;
const candidate = process.env.HARNESS_RELEASE_ARTIFACT;
if (!candidate || !isAbsolute(candidate)) {
  throw new Error('HARNESS_RELEASE_ARTIFACT must be an absolute exact candidate tarball');
}
const outputRoot = process.env.HARNESS_EVAL_OUTPUT_DIR;
if (!outputRoot || !isAbsolute(outputRoot)) {
  throw new Error('HARNESS_EVAL_OUTPUT_DIR must be an absolute path');
}
const model = process.env.HARNESS_EVAL_MODEL;
if (!model) throw new Error('HARNESS_EVAL_MODEL is required');
const maxOutputBytes = Number(process.env.HARNESS_EVAL_MAX_OUTPUT_BYTES ?? 1024 * 1024);
if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1024 * 1024) {
  throw new Error('HARNESS_EVAL_MAX_OUTPUT_BYTES must be an integer from 1 to 1048576');
}
const scenarioBudgetMs = Number(process.env.HARNESS_EVAL_SCENARIO_BUDGET_MS ?? 900_000);
if (!Number.isSafeInteger(scenarioBudgetMs) || scenarioBudgetMs < 1 || scenarioBudgetMs > 900_000) {
  throw new Error('HARNESS_EVAL_SCENARIO_BUDGET_MS must be an integer from 1 to 900000');
}
const matrixBudgetMs = Number(process.env.HARNESS_EVAL_MATRIX_BUDGET_MS ?? 3_600_000);
if (
  !Number.isSafeInteger(matrixBudgetMs) ||
  matrixBudgetMs < scenarioBudgetMs ||
  matrixBudgetMs > 3_600_000
) {
  throw new Error(
    'HARNESS_EVAL_MATRIX_BUDGET_MS must cover the scenario budget and not exceed 3600000',
  );
}
const attempt = Number(process.env.HARNESS_EVAL_ATTEMPT ?? 1);
if (![1, 2].includes(attempt) || process.env.HARNESS_EVAL_MAX_ATTEMPTS !== '2') {
  throw new Error(
    'Host Eval attempt metadata must use attempt 1 or 2 with exactly 2 maximum attempts',
  );
}
const scenarioSignal = AbortSignal.timeout(scenarioBudgetMs);
/** @type {{ scenarios: import('./support/types.mjs').AssertionScenario[] }} */
const catalog = JSON.parse(readFileSync(join(repository, 'evals', 'scenarios.json'), 'utf8'));
const scenario = catalog.scenarios.find((item) => item.id === scenarioId);
if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);
const memoryAutopilotScenarios = new Set([
  'memory-autopilot-unprompted',
  'memory-autopilot-phase-only',
  'memory-autopilot-multi-task',
  'memory-profile-cross-task-recall',
]);
const stamp = new Date()
  .toISOString()
  .replaceAll(/[-:.TZ]/g, '')
  .slice(0, 14);
const runId = `${host}-${scenarioId}-${stamp}-${randomUUID().slice(0, 8)}`;
const runRoot = join(tmpdir(), `harnessmith-codex-scenario-${randomUUID()}`);
const repo = join(runRoot, 'repo');
const home = join(runRoot, 'home');
const memory = join(runRoot, 'global-memory', 'memory');
const personal = join(runRoot, 'personal-data', 'personal');
const temp = join(repo, '.harness-eval-tmp');
const packageRoot = join(runRoot, 'candidate');
const outerBin = join(packageRoot, 'bin', 'harnessmith.mjs');
const recordDir = join(outputRoot, runId);
/** @type {string[]} */
const evaluatorErrors = [];
try {
  await runCodexScenario({
    scenarioId,
    scenario,
    host,
    repository,
    nodeBin,
    candidate,
    outputRoot,
    model,
    maxOutputBytes,
    scenarioBudgetMs,
    matrixBudgetMs,
    attempt,
    scenarioSignal,
    memoryAutopilotScenarios,
    runId,
    runRoot,
    repo,
    home,
    memory,
    personal,
    temp,
    packageRoot,
    outerBin,
    recordDir,
    evaluatorErrors,
  });
} finally {
  try {
    rmSync(runRoot, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to clean Host Eval workspace ${runRoot}: ${String(error)}`);
    process.exitCode = 1;
  }
}
