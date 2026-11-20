/**
 * @typedef {import('../support/types.mjs').AssertionScenario} AssertionScenario
 * @typedef {import('../support/types.mjs').AssertionValue} AssertionValue
 * @typedef {import('../support/types.mjs').ArtifactSanitizer} ArtifactSanitizer
 * @typedef {import('../support/types.mjs').CommandEvidence} CommandEvidence
 * @typedef {import('../support/types.mjs').DigestFunction} DigestFunction
 * @typedef {import('../support/types.mjs').FileDigestFunction} FileDigestFunction
 * @typedef {import('../support/types.mjs').FixturePaths} FixturePaths
 * @typedef {import('../support/types.mjs').HandoffSnapshot} HandoffSnapshot
 * @typedef {import('../support/types.mjs').HostInvocation} HostInvocation
 * @typedef {import('../support/types.mjs').HostResult} HostResult
 * @typedef {import('../support/types.mjs').JsonEventParser} JsonEventParser
 * @typedef {import('../support/types.mjs').Observation} Observation
 * @typedef {import('../support/types.mjs').ObservationArtifact} ObservationArtifact
 * @typedef {import('../support/types.mjs').PayloadInvocation} PayloadInvocation
 * @typedef {import('../support/types.mjs').RunFunction} RunFunction
 * @typedef {import('../support/types.mjs').RuntimeTreeSnapshot} RuntimeTreeSnapshot
 * @typedef {import('../support/types.mjs').SafeReadState} SafeReadState
 * @typedef {import('../support/types.mjs').ScenarioTurn} ScenarioTurn
 * @typedef {import('../support/types.mjs').TreeDeltas} TreeDeltas
 *
 * @typedef {(passes: AssertionValue[], forbiddens: AssertionValue[], notes?: string[]) => void} SetAssertions
 * @typedef {{ label: string, prompt: string, kind: string }} PlannedTurn
 * @typedef {{ turn: string, eventIndex: number, message: string }} MessageEvidence
 * @typedef {{
 *   scenarioId: string,
 *   scenario: AssertionScenario,
 *   memory: string,
 *   repo: string,
 *   before: string,
 *   after: string,
 *   beforeHead: string | null,
 *   afterHead: string | null,
 *   result: HostResult,
 *   turnResults: ScenarioTurn[],
 *   completedCommandItems: (turn: ScenarioTurn | null | undefined) => CommandEvidence[],
 *   capturedInstall: ReturnType<typeof import('./install-evidence.mjs').captureInstallEvidence>,
 *   fixturePaths: FixturePaths,
 *   nodeBin: string,
 *   harnessBin: () => string,
 *   turnAgentMessages: (turn: ScenarioTurn | null | undefined) => string[],
 *   turnVisibleAgentMessages: (turn: ScenarioTurn | null | undefined) => string[],
 *   turnCommands: (turn: ScenarioTurn) => string[],
 *   observeMemoryCheck: (scope: string) => unknown,
 *   observeState: () => Observation,
 *   baselineObservation: Observation,
 *   finalObservation: Observation,
 *   treeDeltas: TreeDeltas,
 *   treeErrors: string[],
 *   boundaryViolations: string[],
 *   memoryAutopilotScenarios: Set<string>,
 *   memoryAutopilotBoundaryOk: boolean,
 *   allowedAutopilotSourcePaths: Set<string>,
 *   temp: string,
 *   personal: string,
 *   observationArtifact: ObservationArtifact,
 *   evaluatorErrors: string[],
 *   everyTurnCompleted: boolean,
 *   changedPaths: string[],
 *   sourceChangesEqual: (expected: string[]) => boolean,
 *   stageChangesEqual: (label: string, expected: string[]) => boolean,
 *   verifiersPassed: (...labels: string[]) => boolean,
 *   snapshot: (label: string, session: string) => HandoffSnapshot | null,
 *   finalFor: (label: string) => string,
 *   section: (content: string | null | undefined, title: string) => string,
 *   memoryPayloadInvocations: PayloadInvocation[],
 *   configHomePath: () => string,
 *   status: () => string,
 *   gitHead: () => string | null,
 *   hostCommand: (threadId: string | null, persistent: boolean, overrides?: string[]) => HostInvocation,
 *   runHostCommand: (invocation: HostInvocation, prompt: string) => Promise<HostResult>,
 *   model: string,
 *   host: string,
 *   scenarioSignal: AbortSignal,
 *   commonEnv: Record<string, string>,
 *   jsonEvents: JsonEventParser,
 *   scalar: (content: unknown, key: string) => string | undefined,
 *   markdownFiles: (directory: string) => string[],
 *   fileDigest: FileDigestFunction,
 *   digest: DigestFunction,
 *   sanitizeAndBoundArtifact: ArtifactSanitizer,
 *   canonicalJson: (value: unknown) => unknown,
 *   exactJsonObject: (value: unknown) => import('../support/types.mjs').MemoryPayloadOutput | null,
 *   pathWithin: (root: string, path: string) => boolean,
 *   turnByLabel: Map<string, ScenarioTurn>,
 *   finalAgentMessage: string,
 *   routineAnnouncementEvidence: MessageEvidence[],
 *   run: RunFunction,
 *   home: string,
 *   checkpointIdempotencyIsProven: typeof import('../support/checkpoint-idempotency.mjs').checkpointIdempotencyIsProven,
 *   treeSnapshot: (directory: string, options?: { excludeGit?: boolean }) => RuntimeTreeSnapshot,
 *   safeReadFile: (path: string, maxBytes?: number) => SafeReadState,
 *   isReadOnlyMemoryHelp: (command: unknown) => boolean,
 *   sessionSnapshots: (sessionBase: string) => HandoffSnapshot[],
 *   exactCloseHandoffTokens: (command: unknown) => string[] | null,
 *   asksRoutineMemoryPermission: boolean | null,
 *   explicitProfileControlRoutingViolations: import('../support/types.mjs').ToolActionDescriptor[],
 *   nativeCompactionEvent: boolean,
 *   turnPlan: PlannedTurn[],
 *   fixtureTrackedPaths: string[],
 * }} AssertionContext
 */

export {};
