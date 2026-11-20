/**
 * Shared structural types for JSONL, command evidence, and filesystem snapshots.
 * These types describe evaluator-owned evidence; untrusted JSON is narrowed at parse boundaries.
 *
 * @typedef {boolean | null} AssertionValue
 * @typedef {{ id: string, prompt: string, pass: string[], forbidden: string[], semanticReviewAssertions?: string[] }} AssertionScenario
 * @typedef {{ command: string, aggregatedOutput: string, exitCode?: number | null, status?: string, eventPosition?: number }} CommandEvidence
 * @typedef {{ [key: string]: unknown, type?: string, command?: string, aggregated_output?: string, exit_code?: number | null, status?: string, text?: string, path?: string, file_path?: string, target?: string }} CodexItem
 * @typedef {{ [key: string]: unknown, type?: string, item?: CodexItem, thread_id?: string, usage?: { input_tokens?: number } }} CodexEvent
 * @typedef {{ captureKind?: string, error?: unknown, stdout: string, stderr?: string, status?: number | null, signal?: string | null }} HostResult
 * @typedef {{ completed?: boolean, transportFailure?: boolean, hasTurnCompleted?: boolean | null, hasAgentCompletion?: boolean, malformedCount?: number, reasons: string[] }} TurnCompletion
 * @typedef {{ result?: HostResult, completion?: TurnCompletion }} HostTurn
 * @typedef {{ sha256: string, size: number, executable: boolean, content?: string }} SnapshotEntry
 * @typedef {Record<string, SnapshotEntry>} FileSnapshot
 * @typedef {{ path: string, reference: string, digest: string, reason?: string, status?: string, content: string }} HandoffSnapshot
 * @typedef {{ path: string, digest: string, reason?: string }} CheckpointSnapshot
 * @typedef {{ script: string, target: string }} Verifier
 * @typedef {{ [key: string]: unknown, version?: unknown, kind?: unknown, action?: unknown, path?: unknown, reference?: unknown }} MemoryPayloadOutput
 * @typedef {{ turn?: string, action?: string, command: string, output?: MemoryPayloadOutput | null, completed?: boolean, exitCode?: number | null, resolvedPayloadPath?: string | null, exact?: boolean, outputObserved?: boolean, payloadPathOk?: boolean, resolvedScopePath?: string | null, scopePathOk?: boolean, scopeExists?: boolean, payload?: PayloadEnvelope }} PayloadInvocation
 * @typedef {{ command: string, output: string, completed?: boolean, exitCode?: number | null, resolvedPayloadPath?: string, payload?: PayloadEnvelope, parsedOutput?: MemoryPayloadOutput | null }} HandoffInvocation
 * @typedef {{ ok: boolean, value?: Record<string, unknown> | null, canonicalJsonSha256?: string | null, temporalAmbiguous?: boolean, error?: string | null, size?: number, fileSha256?: string }} PayloadEnvelope
 * @typedef {{ entries: Record<string, { type: string }>, errors?: string[] }} TreeSnapshot
 * @typedef {{ trees: Record<string, RuntimeTreeSnapshot | null>, projectMemoryDigest?: string | null, profileDigest?: string | null, profile?: string | null, projectCore?: string | null, handoffs: Record<string, HandoffSnapshot[]>, captureWrapperSha256?: string | null, globalMemoryCheck?: { valid: boolean }, trackedStatus?: string }} Observation
 * @typedef {{ label: string, prompt: string, kind: string, result: HostResult, completion: TurnCompletion, observation: Observation, invocation?: { command: string, args: string[] }, handoffEvidence?: HandoffInvocation[], memoryPayloadEvidence?: PayloadInvocation[], verifier?: VerifierResult | null }} ScenarioTurn
 * @typedef {{ captureWrapper?: string, captureWrapperSha256?: string | null, captureCommand?: string[], captureCommandSha256?: string, target?: string, outside?: string, removedTypedWriter?: string, projectMemory?: string, memoryLock?: string }} FixturePaths
 * @typedef {Record<string, string[]>} TreeDeltas
 * @typedef {{ type: string, mode?: number, target?: string, error?: string, size?: number, sha256?: string }} RuntimeTreeEntry
 * @typedef {{ root: string, exists: boolean, entries: Record<string, RuntimeTreeEntry>, errors: string[], digest: string }} RuntimeTreeSnapshot
 * @typedef {{ ok: true, path: string, size: number, sha256: string, content: Buffer, text: string } | { ok: false, path: string, error: string, size?: number }} SafeReadState
 * @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv, timeout?: number }} RunOptions
 * @typedef {{ turn?: string, type?: string, target?: string }} ToolActionDescriptor
 * @typedef {{ sequence?: number, tool: string, kind: string, target: string, outcome: string, approval: string }} ToolAction
 * @typedef {{ content: string, truncated: boolean, sanitizedBytes: number, fullSanitizedSha256?: string, omittedBytes?: number }} ArtifactState
 * @typedef {(input: unknown, maxBytes?: number) => ArtifactState} ArtifactSanitizer
 * @typedef {{ criterionId?: string, status: string }} SemanticReviewDecision
 * @typedef {{ outcome: string, decisions: SemanticReviewDecision[], errors: string[], transport?: string }} SemanticReviewResult
 * @typedef {{ command: string[], status: number | null, signal?: string | null, stdout?: string, stderr?: string, integrity: boolean, expectedSha256?: string | null, actualSha256?: string | null }} VerifierResult
 * @typedef {{ command: string, args: string[], env: Record<string, string>, version: string, model: string, modelVersion: string }} HostInvocation
 * @typedef {(command: string, args: string[], options?: RunOptions) => HostResult} RunFunction
 * @typedef {(command: string, args: string[], options?: RunOptions) => HostResult} CheckedFunction
 * @typedef {(path: string, content: string | Buffer) => void} WriteFunction
 * @typedef {(content: string | Buffer) => string} DigestFunction
 * @typedef {(path: string) => string | null} FileDigestFunction
 * @typedef {(stdout: unknown) => CodexEvent[]} JsonEventParser
 * @typedef {Pick<ScenarioTurn, 'label' | 'kind' | 'completion' | 'verifier' | 'handoffEvidence' | 'memoryPayloadEvidence' | 'observation'> & { hostProcess: { status?: number | null, signal?: string | null, error?: unknown } }} ObservationTurn
 * @typedef {{ [key: string]: unknown, artifactBounds: { transcript?: unknown, diff?: unknown, toolActions?: unknown, changedPaths?: unknown }, semanticReviewRequests?: SemanticReviewRequest[], semanticReviewResult?: SemanticReviewResult | null, turns: ObservationTurn[] }} ObservationArtifact
 * @typedef {{ version: 1, status: number, signal: string | null, stdout: string, stderr: string, error: string | null, commandSha256: string }} InstallCaptureEnvelope
 * @typedef {{ scenario: AssertionScenario, passes: AssertionValue[], forbiddens: AssertionValue[] }} AssertionEvaluationInput
 * @typedef {{ assertionId: string, criterion: string, reason: string }} SemanticReviewRequest
 * @typedef {{ passValues: AssertionValue[], forbiddenValues: AssertionValue[], semanticReviewRequests: SemanticReviewRequest[], mechanicalFailure: boolean }} AssertionEvaluation
 */

export {};
