import { createHostObservation } from './observation-host.mjs';
import { createStateObservation } from './observation-state.mjs';
import {
  completedCommandItems,
  jsonEvents,
  scalar,
  turnAgentMessages,
  turnCommands,
  turnVisibleAgentMessages,
} from './observation-transcript.mjs';

export { jsonEvents };

/** @param {Parameters<typeof createHostObservation>[0] & Parameters<typeof createStateObservation>[0]} config */
export function createScenarioObservation(config) {
  return {
    ...createHostObservation(config),
    ...createStateObservation(config),
    scalar,
    jsonEvents,
    completedCommandItems,
    turnAgentMessages,
    turnVisibleAgentMessages,
    turnCommands,
  };
}
