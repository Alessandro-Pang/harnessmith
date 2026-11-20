/**
 * @typedef {import('../support/types.mjs').AssertionScenario} AssertionScenario
 * @typedef {ReturnType<typeof import('./runtime.mjs').createScenarioRuntime> & { fileDigest: (path: string) => string | null }} ScenarioRuntime
 * @typedef {{
 *   scenarioId: string,
 *   scenario: AssertionScenario,
 *   nodeBin: string,
 *   candidate: string,
 *   outerBin: string,
 *   runRoot: string,
 *   repo: string,
 *   home: string,
 *   memory: string,
 *   personal: string,
 *   temp: string,
 *   packageRoot: string,
 *   repository: string,
 *   memoryAutopilotScenarios: Set<string>,
 *   commonRuntime: ScenarioRuntime,
 * }} FixtureConfig
 * @typedef {ReturnType<typeof import('./fixture-base.mjs').createFixtureBase>} FixtureBase
 * @typedef {{ config: FixtureConfig, base: FixtureBase, context: string[] }} ScenarioFixtureContext
 */
