import { join } from 'node:path';
import { sanitizeAndBoundArtifact } from '../eval-codex-support.mjs';
import { createRunArtifacts } from './execution-artifacts.mjs';
import { evaluateRunAssertions } from './execution-assertions.mjs';
import { createBoundedObservations } from './execution-observations.mjs';
import { reviewScenarioAssertions } from './execution-semantic.mjs';
import { createScenarioServices, initializeScenario } from './execution-setup.mjs';
import { executeScenarioTurns } from './execution-turns.mjs';

/** @param {import('./execution-types.mjs').ScenarioExecutionContext} context */
export async function runCodexScenario(context) {
  const services = createScenarioServices(context);
  const baseline = initializeScenario(context, services);
  const turns = await executeScenarioTurns(context, services, baseline);
  const artifacts = createRunArtifacts(context, services, baseline, turns);
  const evaluation = await evaluateRunAssertions(context, services, baseline, turns, artifacts);
  const boundedObservations = createBoundedObservations(context, artifacts);
  const review = await reviewScenarioAssertions(
    context,
    turns,
    artifacts,
    evaluation,
    boundedObservations,
  );
  services.write(join(context.recordDir, 'observations.json'), review.observationsText);
  const { finalizeScenario } = await import('../scenario-finalization.mjs');
  finalizeScenario({
    ...context,
    ...services,
    ...baseline,
    ...turns,
    ...artifacts,
    ...evaluation,
    ...review,
    sanitizeAndBoundArtifact,
    evidenceComplete: artifacts.evidenceComplete,
  });
}
