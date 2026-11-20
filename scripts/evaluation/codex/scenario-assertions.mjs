import { evaluateScenarioAssertions } from './eval-codex-support.mjs';
import { evaluateAutopilotMultiTask } from './scenario/assertions-autopilot-multi.mjs';
import { evaluateAutopilotPhase } from './scenario/assertions-autopilot-phase.mjs';
import { evaluateAutopilotUnprompted } from './scenario/assertions-autopilot-unprompted.mjs';
import { evaluateBasicScenarios } from './scenario/assertions-basic.mjs';
import { evaluateProfileRecall } from './scenario/assertions-profile-recall.mjs';
import { evaluateProjectMemoryRecall } from './scenario/assertions-project-memory.mjs';
import { evaluateWorkflowScenarios } from './scenario/assertions-workflow.mjs';

/** @param {import('./scenario/assertion-types.mjs').AssertionContext} context */
export function evaluateScenarioBranches(context) {
  const { scenarioId, scenario, observationArtifact, evaluatorErrors } = context;
  /** @type {import('./support/types.mjs').AssertionValue[]} */
  let passValues = scenario.pass.map(() => false);
  /** @type {import('./support/types.mjs').AssertionValue[]} */
  let forbiddenValues = scenario.forbidden.map(() => false);
  /** @type {string[]} */
  const details = [];
  /** @type {import('./scenario/assertion-types.mjs').SetAssertions} */
  const setAssertions = (passes, forbiddens, notes = []) => {
    if (passes.length !== scenario.pass.length || forbiddens.length !== scenario.forbidden.length) {
      throw new Error(`assertion mapping mismatch for ${scenarioId}`);
    }
    const semantic = evaluateScenarioAssertions({ scenario, passes, forbiddens });
    passValues = semantic.passValues;
    forbiddenValues = semantic.forbiddenValues;
    if (semantic.semanticReviewRequests.length > 0) {
      observationArtifact.semanticReviewRequests = [
        ...(observationArtifact.semanticReviewRequests ?? []),
        ...semantic.semanticReviewRequests,
      ];
    }
    details.push(...notes);
  };

  try {
    evaluateBasicScenarios(context, setAssertions);
    evaluateProjectMemoryRecall(context, setAssertions);
    evaluateWorkflowScenarios(context, setAssertions);
    evaluateAutopilotUnprompted(context, setAssertions);
    evaluateAutopilotPhase(context, setAssertions);
    evaluateAutopilotMultiTask(context, setAssertions);
    evaluateProfileRecall(context, setAssertions);
  } catch (error) {
    evaluatorErrors.push(`assertion evaluation failed closed: ${String(error)}`);
    details.push(`assertion evaluation failed closed: ${String(error)}`);
    passValues = scenario.pass.map(() => false);
    forbiddenValues = scenario.forbidden.map(() => false);
  }
  return { passValues, forbiddenValues, details };
}
