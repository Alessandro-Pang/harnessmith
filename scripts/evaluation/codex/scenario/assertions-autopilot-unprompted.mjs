import { assessAutopilotUnprompted } from './autopilot-assessment.mjs';
import { buildAutopilotControls } from './autopilot-controls.mjs';
import { buildAutopilotHandoffs } from './autopilot-handoffs.mjs';
import { buildAutopilotInputProfile } from './autopilot-input-profile.mjs';
import { buildAutopilotTiming } from './autopilot-timing.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./assertion-types.mjs').SetAssertions} setAssertions
 */
export function evaluateAutopilotUnprompted(context, setAssertions) {
  if (context.scenarioId !== 'memory-autopilot-unprompted') return;
  const input = buildAutopilotInputProfile(context);
  const handoffs = buildAutopilotHandoffs(context, input);
  const controls = buildAutopilotControls(context, input);
  const timing = buildAutopilotTiming(context, { ...input, ...handoffs, ...controls });
  assessAutopilotUnprompted(
    context,
    { ...input, ...handoffs, ...controls, ...timing },
    setAssertions,
  );
}
