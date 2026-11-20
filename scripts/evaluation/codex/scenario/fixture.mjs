import { createFixtureBase } from './fixture-base.mjs';
import { createScenarioSetup } from './fixture-scenarios.mjs';

/** @param {import('./fixture-types.mjs').FixtureConfig} config */
export function createScenarioFixture(config) {
  const base = createFixtureBase(config);
  return { ...base, setupScenario: createScenarioSetup(config, base) };
}
