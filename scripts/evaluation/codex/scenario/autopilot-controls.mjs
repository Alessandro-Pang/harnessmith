import { buildAutopilotControlBoundary } from './autopilot-control-boundary.mjs';
import { buildAutopilotProfileControls } from './autopilot-profile-controls.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile>} state
 */
export function buildAutopilotControls(context, state) {
  const boundary = buildAutopilotControlBoundary(context);
  const controls = buildAutopilotProfileControls(context, state);
  return { ...boundary, ...controls };
}
