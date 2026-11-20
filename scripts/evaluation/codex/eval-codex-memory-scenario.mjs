import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeScenarioCatalogInconclusive } from './scenario/memory-record.mjs';
import { digest } from './scenario/memory-runtime.mjs';
import { executeMemoryScenario } from './scenario/memory-scenario-execution.mjs';
import { finalizeMemoryScenario } from './scenario/memory-scenario-finalization.mjs';
import {
  initializeMemoryFixture,
  prepareMemoryScenario,
} from './scenario/memory-scenario-setup.mjs';
import { verifyMemoryScenario } from './scenario/memory-scenario-verification.mjs';

const repository = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const scenarioId = process.argv[2];
const variant = Number(process.argv[3] ?? 0);
const candidate = process.env.HARNESS_RELEASE_ARTIFACT;
const outputRoot = process.env.HARNESS_EVAL_OUTPUT_DIR;
const model = process.env.HARNESS_EVAL_MODEL;
if (!scenarioId || !Number.isInteger(variant) || variant < 0) {
  throw new Error('usage: eval-codex-memory-scenario.mjs <scenario> <variant>');
}
if (!candidate || !isAbsolute(candidate) || !outputRoot || !isAbsolute(outputRoot) || !model) {
  throw new Error('candidate, output directory, and model are required');
}

const setup = prepareMemoryScenario({
  repository,
  scenarioId,
  variant,
  candidate,
  outputRoot,
  model,
});
if (setup.scenario.evaluationStatus === 'inconclusive') {
  const result = writeScenarioCatalogInconclusive({
    scenario: setup.scenario,
    variant,
    runId: setup.runId,
    recordDir: setup.recordDir,
    model,
    packageVersion: setup.packageVersion,
    packageArtifactSha256: setup.packageArtifactSha256,
    digest,
  });
  process.stdout.write(
    `${JSON.stringify({ scenarioId, variant, outcome: result.outcome, runId: setup.runId, reason: result.reason })}\n`,
  );
  process.exit(0);
}

const fixture = initializeMemoryFixture(setup);
const execution = await executeMemoryScenario(setup, fixture);
const verification = verifyMemoryScenario(setup, fixture, execution);
const record = finalizeMemoryScenario(setup, execution, verification);
process.stdout.write(
  `${JSON.stringify({ scenarioId, variant, outcome: record.outcome, runId: setup.runId })}\n`,
);
