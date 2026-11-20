/**
 * @typedef {import('../support/types.mjs').AssertionScenario} AssertionScenario
 * @typedef {import('../support/types.mjs').AssertionValue} AssertionValue
 * @typedef {import('../support/types.mjs').ArtifactSanitizer} ArtifactSanitizer
 * @typedef {import('../support/types.mjs').ArtifactState} ArtifactState
 * @typedef {import('../support/types.mjs').CheckedFunction} CheckedFunction
 * @typedef {import('../support/types.mjs').DigestFunction} DigestFunction
 * @typedef {import('../support/types.mjs').FileDigestFunction} FileDigestFunction
 * @typedef {import('../support/types.mjs').HostInvocation} HostInvocation
 * @typedef {import('../support/types.mjs').HostResult} HostResult
 * @typedef {import('../support/types.mjs').JsonEventParser} JsonEventParser
 * @typedef {import('../support/types.mjs').ObservationArtifact} ObservationArtifact
 * @typedef {import('../support/types.mjs').ScenarioTurn} ScenarioTurn
 * @typedef {import('../support/types.mjs').SemanticReviewResult} SemanticReviewResult
 * @typedef {import('../support/types.mjs').ToolActionDescriptor} ToolActionDescriptor
 * @typedef {import('../support/types.mjs').WriteFunction} WriteFunction
 *
 * @typedef {{
 *   everyTurnCompleted: boolean,
 *   evaluatorErrors: string[],
 *   treeErrors: string[],
 *   boundaryViolations: string[],
 *   passValues: AssertionValue[],
 *   forbiddenValues: AssertionValue[],
 *   semanticReviewResult: SemanticReviewResult | null,
 *   turnResults: ScenarioTurn[],
 *   scenarioId: string,
 *   host: string,
 *   scenario: AssertionScenario,
 *   evidenceComplete: boolean,
 *   details: string[],
 *   sanitizeAndBoundArtifact: ArtifactSanitizer,
 *   recordDir: string,
 *   write: WriteFunction,
 *   nodeBin: string,
 *   repository: string,
 *   checked: CheckedFunction,
 *   candidate: string,
 *   runRoot: string,
 *   transcript: string,
 *   diffArtifact: string,
 *   digest: DigestFunction,
 *   fileDigest: FileDigestFunction,
 *   changedPaths: string[],
 *   rawToolActionDescriptors: ToolActionDescriptor[],
 *   rawChangedPaths: string[],
 *   transcriptState: ArtifactState,
 *   diffState: ArtifactState,
 *   observationArtifact: ObservationArtifact,
 *   observationsText: string,
 *   runId: string,
 *   invocation: HostInvocation,
 *   startedAt: string,
 *   finishedAt: string,
 *   attempt: number,
 *   scenarioBudgetMs: number,
 *   matrixBudgetMs: number,
 *   result: HostResult,
 *   jsonEvents: JsonEventParser,
 * }} FinalizationContext
 *
 * @typedef {FinalizationContext & {
 *   assessment: string,
 *   evaluatedAt: string,
 *   finalizedForbiddenValues: AssertionValue[],
 *   fingerprint: ScenarioFingerprint,
 *   outcome: string,
 *   termination: string,
 *   transportFailed: boolean,
 *   toolActions: import('../support/types.mjs').ToolAction[],
 * }} FinalizationRecordInput
 *
 * @typedef {{
 *   packageVersion: string,
 *   harnessVersion: string,
 *   packageArtifactSha256: string,
 *   scenarios: Record<string, string>,
 *   scenarioDependencies: Record<string, string>,
 *   rulesSha256: string,
 * }} ScenarioFingerprint
 */

export {};
