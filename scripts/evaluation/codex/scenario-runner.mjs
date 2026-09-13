import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNpmPackageTarball } from '../../release/npm-tarball.js';
import { runBoundedHostProcess } from './eval-codex-transport.ts';
import { createScenarioRuntime } from './scenario/runtime.mjs';
import { createScenarioFixture } from './scenario/fixture.mjs';
import { createScenarioObservation } from './scenario/observation.mjs';
import { createScenarioEvidence } from './scenario/evidence.mjs';
import { captureInstallEvidence } from './scenario/install-evidence.mjs';
import {
  buildCodexTurn,
  canonicalPathWithin,
  classifyBoundaryCommand,
  checkpointIdempotencyIsProven,
  classifyCodexScenarioHostFailures,
  containsApiWorkerBoundary,
  containsAssertedObsoleteRecall,
  containsRetryInvestigationContext,
  commandHasReadOnlyHelp,
  commandInvokesReadTool,
  commandReadSegments,
  commandReadsProjectMemoryStandardAlone,
  compactionHandoffVerificationIsCurrent,
  evaluateCodexTurnCompletion,
  exactCloseHandoffCommandTokens,
  exactCommandTokens,
  extractHandoffInvocations,
  handoffPayloadProvesClearedOpen,
  inspectJsonPayloadPath,
  inspectProjectScopePath,
  isExplicitProfileControlRoutingViolation,
  isCodeReviewProfileKey,
  isUnauditableCloseHandoffCommand,
  isUnauditableMemoryPayloadCommand,
  markEarlierReusedPayloadSnapshotsAmbiguous,
  memoryAutopilotBoundaryIsSafe,
  memoryPayloadCommandHasExpectedPrefix,
  memoryPayloadOutputIsCompatible,
  memoryPayloadAttemptViolatesBoundary,
  mentionsRetryInvestigationContext,
  multiTaskCheckpointReplacementIsProven,
  parseCodexInputTokens,
  parseCodexThreadId,
  parseInstallCaptureEnvelope,
  parseJsonlEvidence,
  parseMemoryPayloadCommand,
  pausedOrdinaryPreferenceStayedEphemeral,
  profileEntriesAreIdentical,
  profileEntryMutationIsExact,
  projectMemoryReadOrderIsValid,
  remoteToolViolatesWriteBoundary,
  sameCanonicalPath,
  sanitizeAndBoundArtifact,
  scenarioTurnPlan,
  selectSingleSuccessfulMemoryPayloadInvocation,
  singleExactPayloadMutationAttempt,
  toolActionArtifactBounds,
  textContainsExactVerifierCommand,
  typedInputCaptureIsProven,
  verificationEvidenceProvesSuccessfulCommand,
  visibleAgentMessages,
  evaluateScenarioAssertions,
  withEphemeralJsonPayload,
} from './eval-codex-support.mjs';

const [scenarioId, ...extraArguments] = process.argv.slice(2);
const host = 'codex';
if (!scenarioId || extraArguments.length > 0) {
  throw new Error('usage: eval-codex-scenario.mjs <scenario>');
}

const repository = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const nodeBin = process.execPath;
const candidate = process.env.HARNESS_RELEASE_ARTIFACT;
if (!candidate || !isAbsolute(candidate)) {
  throw new Error('HARNESS_RELEASE_ARTIFACT must be an absolute exact candidate tarball');
}
const outputRoot = process.env.HARNESS_EVAL_OUTPUT_DIR;
if (!outputRoot || !isAbsolute(outputRoot)) {
  throw new Error('HARNESS_EVAL_OUTPUT_DIR must be an absolute path');
}
const model = process.env.HARNESS_EVAL_MODEL;
if (!model) throw new Error('HARNESS_EVAL_MODEL is required');
const maxOutputBytes = Number(process.env.HARNESS_EVAL_MAX_OUTPUT_BYTES ?? 1024 * 1024);
if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1024 * 1024) {
  throw new Error('HARNESS_EVAL_MAX_OUTPUT_BYTES must be an integer from 1 to 1048576');
}
const scenarioBudgetMs = Number(process.env.HARNESS_EVAL_SCENARIO_BUDGET_MS ?? 900_000);
if (!Number.isSafeInteger(scenarioBudgetMs) || scenarioBudgetMs < 1 || scenarioBudgetMs > 900_000) {
  throw new Error('HARNESS_EVAL_SCENARIO_BUDGET_MS must be an integer from 1 to 900000');
}
const matrixBudgetMs = Number(process.env.HARNESS_EVAL_MATRIX_BUDGET_MS ?? 3_600_000);
if (
  !Number.isSafeInteger(matrixBudgetMs) ||
  matrixBudgetMs < scenarioBudgetMs ||
  matrixBudgetMs > 3_600_000
) {
  throw new Error('HARNESS_EVAL_MATRIX_BUDGET_MS must cover the scenario budget and not exceed 3600000');
}
const attempt = Number(process.env.HARNESS_EVAL_ATTEMPT ?? 1);
if (![1, 2].includes(attempt) || process.env.HARNESS_EVAL_MAX_ATTEMPTS !== '2') {
  throw new Error('Host Eval attempt metadata must use attempt 1 or 2 with exactly 2 maximum attempts');
}
const scenarioSignal = AbortSignal.timeout(scenarioBudgetMs);
const catalog = JSON.parse(readFileSync(join(repository, 'evals', 'scenarios.json'), 'utf8'));
const scenario = catalog.scenarios.find((item) => item.id === scenarioId);
if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);
const memoryAutopilotScenarios = new Set([
  'memory-autopilot-unprompted',
  'memory-autopilot-phase-only',
  'memory-autopilot-multi-task',
  'memory-profile-cross-task-recall',
]);

const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
const runId = `${host}-${scenarioId}-${stamp}-${randomUUID().slice(0, 8)}`;
const runRoot = join(tmpdir(), `harnessmith-codex-scenario-${randomUUID()}`);
const repo = join(runRoot, 'repo');
const home = join(runRoot, 'home');
const memory = join(runRoot, 'global-memory', 'memory');
const personal = join(runRoot, 'personal-data', 'personal');
const temp = join(repo, '.harness-eval-tmp');
const packageRoot = join(runRoot, 'candidate');
const outerBin = join(packageRoot, 'bin', 'harnessmith.mjs');
const recordDir = join(outputRoot, runId);
const evaluatorErrors = [];
for (const directory of [runRoot, repo, home, memory, personal, temp, packageRoot, recordDir]) {
  mkdirSync(directory, { recursive: true });
}
const tarball = readNpmPackageTarball(candidate);
for (const [path, content] of tarball.files) {
  const target = join(packageRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { flag: 'wx' });
}
const dependencies = join(repository, 'node_modules');
if (!existsSync(dependencies)) throw new Error('Repository dependencies are unavailable');
symlinkSync(dependencies, join(packageRoot, 'node_modules'));
for (const requiredPath of [nodeBin, candidate, outerBin]) {
  if (!existsSync(requiredPath)) throw new Error(`required release input is missing: ${requiredPath}`);
}

try {
const {
  run,
  checked,
  assertCleanroomMatchesCandidate,
  write,
  digest,
  safeReadFile,
  treeSnapshot,
  treeChangedPaths,
  pathWithin,
  markdownFiles,
  canonicalJson,
  exactJsonObject,
  git,
  gitCommit,
  memoryDoc,
} = createScenarioRuntime({ repo, repository, candidate, packageRoot, evaluatorErrors });
const commonRuntime = {
  run,
  checked,
  write,
  digest,
  safeReadFile,
  treeSnapshot,
  git,
  gitCommit,
  memoryDoc,
  fileDigest: (path) => {
    const state = safeReadFile(path, 8 * 1024 * 1024);
    return state.ok ? state.sha256 : null;
  },
};
const {
  setupBase,
  installHarness,
  harnessBin,
  initProjectMemory,
  initGlobalMemory,
  runHarness,
  harnessPayload,
  setupVerifier,
  setupInstallCapture,
  setupScenario,
  commonEnv,
  verifierDigests,
  fixturePaths,
  configHomePath,
} = createScenarioFixture({
  scenarioId,
  scenario,
  nodeBin,
  candidate,
  outerBin,
  runRoot,
  repo,
  home,
  memory,
  personal,
  temp,
  packageRoot,
  repository,
  memoryAutopilotScenarios,
  commonRuntime,
});
const {
  status,
  gitHead,
  hostCommand,
  runHostCommand,
  fileDigest,
  markdownTreeDigest,
  scalar,
  sessionSnapshots,
  jsonEvents,
  completedCommandItems,
  turnAgentMessages,
  turnVisibleAgentMessages,
  turnCommands,
  observeMemoryCheck,
  observeState,
} = createScenarioObservation({
  repo,
  scenarioId,
  nodeBin,
  home,
  model,
  host,
  commonEnv,
  configHomePath,
  harnessBin,
  scenarioSignal,
  maxOutputBytes,
  evaluatorErrors,
  fixturePaths,
  memory,
  personal,
  temp,
  runtime: { run, safeReadFile, markdownFiles, treeSnapshot, exactJsonObject, digest },
});
setupBase();
assertCleanroomMatchesCandidate();
installHarness();
setupScenario();
gitCommit();
if (process.env.HARNESS_EVAL_FIXTURE_ONLY === '1') {
  const fixture = {
    runRoot,
    repo,
    scenarioId,
    nodeBin,
    candidate,
    outerBin,
    context: readFileSync(join(repo, 'EVAL_CONTEXT.md'), 'utf8'),
    turns: scenarioTurnPlan(scenarioId, scenario.prompt),
    verifierDigests: Object.fromEntries(verifierDigests),
    profileDigest: fileDigest(join(memory, 'profile.md')),
    trackedStatus: status(),
    memory,
    personal,
    temp,
    hostArgs: hostCommand(null, false).args,
  };
  rmSync(runRoot, { recursive: true, force: true });
  console.log(JSON.stringify(fixture));
  process.exit(0);
}
if (scenarioId === 'destructive-boundary') write(join(repo, 'user-work.txt'), 'original user work\nuncommitted unrelated change\n');
const trackedFilesResult = run('git', ['ls-files', '-z'], { cwd: repo });
const fixtureTrackedPaths = trackedFilesResult.status === 0 ? trackedFilesResult.stdout.split('\0').filter(Boolean) : [];
if (trackedFilesResult.status !== 0) evaluatorErrors.push(`cannot capture baseline tracked paths: ${trackedFilesResult.stderr || trackedFilesResult.error}`);
const before = status();
const beforeHead = gitHead();
const baselineObservation = observeState();
const startedAt = new Date().toISOString();
const turnPlan = scenarioTurnPlan(scenarioId, scenario.prompt);
if (turnPlan.length > 1 && host !== 'codex') throw new Error(`multi-turn scenario ${scenarioId} currently requires the Codex CLI adapter`);
const turnResults = [];
let codexThreadId;
let invocation;
let forcedCompactionConfig = null;
const { turnVerifier, captureHandoffEvidence, captureMemoryPayloadEvidence, hostTurnCompletion } = createScenarioEvidence({ scenarioId, host, repo, temp, nodeBin, harnessBin, verifierDigests, fileDigest, run, safeReadFile, digest, canonicalJson });

for (const planned of turnPlan) {
  let configOverrides = [];
  if (scenarioId === 'memory-autopilot-unprompted' && planned.label === 'follow-up-edit') {
    const signalTurn = turnResults.find((turn) => turn.label === 'pre-compaction-signal');
    if (signalTurn) {
      try {
        const inputTokens = parseCodexInputTokens(signalTurn.result.stdout);
        const autoCompactLimit = inputTokens + 64;
        const contextWindow = Math.ceil(autoCompactLimit / 0.92);
        forcedCompactionConfig = { inputTokens, autoCompactLimit, contextWindow };
        configOverrides = [
          `model_context_window=${contextWindow}`,
          `model_auto_compact_token_limit=${autoCompactLimit}`,
        ];
      } catch (error) {
        forcedCompactionConfig = { error: String(error) };
      }
    }
  }
  invocation = hostCommand(
    codexThreadId,
    turnPlan.length > 1,
    configOverrides,
  );
  const result = await runHostCommand(invocation, planned.prompt);
  if (host === 'codex' && !codexThreadId && turnPlan.length > 1) {
    try {
      codexThreadId = parseCodexThreadId(result.stdout);
    } catch (error) {
      result.status = result.status === 0 ? 1 : result.status;
      result.stderr = `${result.stderr}${result.stderr ? '\n' : ''}${String(error)}`;
    }
  }
  const completion = hostTurnCompletion(result, planned);
  turnResults.push({
    ...planned,
    invocation: { command: invocation.command, args: invocation.args },
    result,
    completion,
    handoffEvidence: captureHandoffEvidence(result.stdout),
    memoryPayloadEvidence: captureMemoryPayloadEvidence(result.stdout, planned.label),
    verifier: turnVerifier(planned.label),
    observation: observeState(),
  });
  if (!completion.completed || (host === 'codex' && turnPlan.length > 1 && !codexThreadId)) break;
}
const finishedAt = new Date().toISOString();
const after = status();
const afterHead = gitHead();
const everyTurnCompleted =
  turnResults.length === turnPlan.length &&
  turnResults.every((turn) => turn.completion.completed === true);
const firstFailedTurn = turnResults.find((turn) => turn.completion.completed !== true);
const result = {
  status: everyTurnCompleted ? 0 : 1,
  signal: turnResults.find((turn) => turn.result.signal)?.result.signal,
  error: firstFailedTurn?.result.error,
  stdout: turnResults.map((turn) => turn.result.stdout).join('\n'),
  stderr: turnResults.map((turn) => turn.result.stderr).join('\n'),
};
const codexJsonlDiagnostics = host === 'codex'
  ? turnResults.map((turn) => ({ turn: turn.label, ...parseJsonlEvidence(turn.result.stdout) }))
  : [];
const malformedJsonlCount = codexJsonlDiagnostics.reduce(
  (count, item) => count + item.malformedCount,
  0,
);
const malformedJsonl = codexJsonlDiagnostics.flatMap((item) =>
  item.malformed.map((entry) => ({ turn: item.turn, ...entry })),
).slice(0, 128);
if (malformedJsonlCount > 0) {
  evaluatorErrors.push(
    `Codex JSONL contained ${malformedJsonlCount} malformed non-empty line(s); evidence is incomplete`,
  );
}
const rawTranscript = `# Sanitized bounded real-host transcript\n\n${turnResults
  .map(
    (turn, index) =>
      `## Turn ${index + 1}: ${turn.label} (${turn.kind})\n\nPrompt:\n\n${turn.prompt}\n\nHost exit: ${String(turn.result.status)}\nSignal: ${turn.result.signal ?? 'none'}\nSpawn error: ${turn.result.error ?? 'none'}\nCompletion evidence: ${JSON.stringify(turn.completion)}\nIndependent verifier: ${turn.verifier ? `${String(turn.verifier.status)} (${turn.verifier.command.join(' ')})` : 'not applicable'}\n\n### stdout\n\n${turn.result.stdout}\n\n### stderr\n\n${turn.result.stderr}`,
  )
  .join('\n\n')}\n`;
const transcriptState = sanitizeAndBoundArtifact(rawTranscript, 7 * 1024 * 1024);
let transcript = transcriptState.content;
const rawDiffArtifact = `# Before\n${before || '(clean)\n'}\n# After\n${after || '(clean)\n'}\n\n# Git diff\n${run('git', ['diff', '--no-ext-diff'], { cwd: repo }).stdout}`;
const diffState = sanitizeAndBoundArtifact(rawDiffArtifact, 4 * 1024 * 1024);
let diffArtifact = diffState.content;
const { content: _transcriptContent, ...transcriptMetadata } = transcriptState;
const { content: _diffContent, ...diffMetadata } = diffState;
let evidenceComplete =
  !transcriptState.truncated && !diffState.truncated && malformedJsonlCount === 0;
write(join(recordDir, 'transcript.md'), transcript);
write(join(recordDir, 'filesystem-diff.txt'), diffArtifact);
const observationArtifact = {
  note: 'The 8% marker is evaluator instrumentation; native compaction is credited only when the follow-up JSONL contains a native context-compacted event.',
  idempotencyInstrumentation: 'repeat-identical-checkpoint is evaluator instrumentation, not a user persistence request.',
  logicalThreadId: scenarioId === 'memory-autopilot-unprompted' ? 'host-thread-42' : scenarioId === 'memory-autopilot-phase-only' ? 'phase-thread-17' : scenarioId === 'memory-autopilot-multi-task' ? 'multi-thread-23' : null,
  codexThreadId: codexThreadId ?? null,
  forcedCompactionConfig,
  jsonlDiagnostics: {
    malformedCount: malformedJsonlCount,
    malformed: malformedJsonl,
    exceeded: malformedJsonlCount > malformedJsonl.length,
  },
  nativeCompactionObserved: jsonEvents(
    turnResults.find((turn) => turn.label === 'follow-up-edit')?.result.stdout ?? '',
  ).some((event) => event?.type === 'context_compacted' || event?.type === 'context.compacted'),
  artifactBounds: { transcript: transcriptMetadata, diff: diffMetadata },
  fixturePaths: {
    target: fixturePaths.target ?? null,
    outside: fixturePaths.outside ?? null,
    captureWrapper: fixturePaths.captureWrapper ?? null,
    captureWrapperSha256: fixturePaths.captureWrapperSha256 ?? null,
    captureCommandSha256: fixturePaths.captureCommandSha256 ?? null,
  },
  baseline: baselineObservation,
  turns: turnResults.map(
    ({ label, kind, result: turnResult, completion, verifier, handoffEvidence, memoryPayloadEvidence, observation }) => ({
      label,
      kind,
      hostProcess: {
        status: turnResult.status,
        signal: turnResult.signal,
        error: turnResult.error,
      },
      completion,
      verifier,
      handoffEvidence,
      memoryPayloadEvidence,
      observation,
    }),
  ),
};

const agentMessages = result.stdout
  .split('\n')
  .flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event?.type === 'item.completed' && event?.item?.type === 'agent_message'
        ? [String(event.item.text ?? '')]
        : [];
    } catch {
      return [];
    }
  });
const finalAgentMessage = agentMessages.at(-1) ?? '';
const rawChangedPaths = after.split('\n').filter(Boolean).map((line) => line.slice(3));
const boundedChangedPaths = rawChangedPaths.map((path) => sanitizeAndBoundArtifact(path, 512));
const changedPaths = [
  ...new Set(boundedChangedPaths.map((state) => state.content)),
].slice(0, 4096);
const changedPathsExceeded =
  rawChangedPaths.length > 4096 ||
  changedPaths.length !== rawChangedPaths.length ||
  boundedChangedPaths.some((state) => state.truncated);
if (changedPathsExceeded) {
  evidenceComplete = false;
  evaluatorErrors.push(
    `filesystem changedPaths exceeded schema-safe representation: count=${rawChangedPaths.length}`,
  );
}
observationArtifact.artifactBounds.changedPaths = {
  originalCount: rawChangedPaths.length,
  recordedCount: changedPaths.length,
  originalSha256: digest(JSON.stringify(rawChangedPaths)),
  exceeded: changedPathsExceeded,
};
const statusPaths = (value) => value.split('\n').filter(Boolean).map((line) => line.slice(3));
const stageChangesEqual = (label, expected) => {
  const actual = statusPaths(turnByLabel.get(label)?.observation.trackedStatus ?? '');
  return actual.length === expected.length && expected.every((path) => actual.includes(path));
};
const verifiersPassed = (...labels) => labels.every((label) => {
  const verification = turnByLabel.get(label)?.verifier;
  return verification?.integrity === true && verification.status === 0;
});
const turnByLabel = new Map(turnResults.map((turn) => [turn.label, turn]));
const snapshot = (label, session) =>
  turnByLabel.get(label)?.observation.handoffs[session]?.[0] ?? null;
const finalFor = (label) => turnAgentMessages(turnByLabel.get(label) ?? { result: { stdout: '' } }).at(-1) ?? '';
const section = (content, title) => {
  if (!content) return '';
  const lines = content.split(/\r?\n/);
  const start = lines.indexOf(`# ${title}`);
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && /^# /.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n').trim();
};
const sourceChangesEqual = (expected) =>
  changedPaths.length === expected.length && expected.every((path) => changedPaths.includes(path));
const permissionReviewEvidence = turnResults.flatMap((turn) => turnAgentMessages(turn).map((message, index) => ({ turn: turn.label, eventIndex: index, message: sanitizeAndBoundArtifact(message, 512).content })));
const asksRoutineMemoryPermission = null;
const routineMemoryMutationPattern = /\bmemory\s+(?:capture-input|handoff|close-handoff|reconcile-profile|forget-profile|profile-autopilot)\b/i;
const isReadOnlyMemoryHelp = (command) =>
  commandHasReadOnlyHelp(command, {
    nodePath: nodeBin,
    harnessPath: harnessBin(),
    profilePath: join(memory, 'profile.md'),
    allowLiteralNode: true,
  });
const exactCloseHandoffTokens = (command) =>
  exactCloseHandoffCommandTokens(command, {
    nodePath: nodeBin,
    harnessPath: harnessBin(),
    repo,
  });
const routineAnnouncementEvidence = turnResults.flatMap((turn) =>
  turnAgentMessages(turn).map((message, index) => ({
    turn: turn.label,
    eventIndex: index,
    message: sanitizeAndBoundArtifact(message, 512).content,
  })),
);
const routineAnnouncement = null;
const explicitProfileControlRoutingViolations = turnResults.flatMap((turn) =>
  jsonEvents(turn.result.stdout).flatMap((event) => {
    const item = event?.item;
    if (
      event?.type !== 'item.completed' ||
      !isExplicitProfileControlRoutingViolation({ turnLabel: turn.label, item })
    ) {
      return [];
    }
    return [{
      turn: turn.label,
      type: String(item.type ?? 'unknown'),
      target: sanitizeAndBoundArtifact(
        String(item.command ?? item.query ?? item.name ?? item.server ?? '(target unavailable)'),
        512,
      ).content,
    }];
  }),
);
observationArtifact.routineAnnouncementEvidence = routineAnnouncementEvidence;
observationArtifact.permissionReviewEvidence = permissionReviewEvidence;
observationArtifact.explicitProfileControlRoutingViolations =
  explicitProfileControlRoutingViolations;
const nativeCompactionEvent = turnResults.some((turn) =>
  jsonEvents(turn.result.stdout).some(
    (event) => event?.type === 'context_compacted' || event?.type === 'context.compacted',
  ),
);
const rawToolActionDescriptors = [];
for (const turn of turnResults) {
  for (const event of jsonEvents(turn.result.stdout)) {
    if (event?.type === 'context_compacted' || event?.type === 'context.compacted') {
      rawToolActionDescriptors.push({ turn: turn.label, type: 'context_compacted', target: turn.label });
      continue;
    }
    const item = event?.item;
    if (event?.type !== 'item.completed' || !item) continue;
    if (item.type === 'command_execution') {
      rawToolActionDescriptors.push({ turn: turn.label, type: item.type, target: String(item.command ?? '') });
    } else if (item.type === 'file_change') {
      rawToolActionDescriptors.push({
        turn: turn.label,
        type: item.type,
        target: (Array.isArray(item.changes) ? item.changes : [])
          .map((change) => change?.path)
          .filter(Boolean)
          .join(', '),
      });
    } else if (item.type === 'agent_message') {
      rawToolActionDescriptors.push({ turn: turn.label, type: item.type, target: turn.label });
    } else if (['web_search', 'mcp_tool_call', 'network_request'].includes(item.type)) {
      rawToolActionDescriptors.push({
        turn: turn.label,
        type: item.type,
        target: String(item.query ?? item.name ?? item.server ?? '(target unavailable)'),
      });
    }
  }
  if (turn.verifier) {
    rawToolActionDescriptors.push({
      turn: turn.label,
      type: 'evaluator.verifier',
      target: turn.verifier.command.join(' '),
    });
  }
}
const toolActionBounds = toolActionArtifactBounds(rawToolActionDescriptors);
if (toolActionBounds.exceeded) {
  evidenceComplete = false;
  evaluatorErrors.push(
    `toolActions exceeded schema-safe representation: count=${rawToolActionDescriptors.length}`,
  );
}
observationArtifact.artifactBounds.toolActions = toolActionBounds;
const finalObservation = turnResults.at(-1)?.observation ?? baselineObservation;
const treeDeltas = Object.fromEntries(
  ['project', 'globalMemory', 'personal', 'target', 'outside', 'evaluator'].map((name) => [
    name,
    treeChangedPaths(baselineObservation.trees?.[name], finalObservation.trees?.[name]),
  ]),
);
const treeErrors = [baselineObservation, ...turnResults.map((turn) => turn.observation)]
  .flatMap((observation) =>
    Object.entries(observation?.trees ?? {}).flatMap(([name, tree]) =>
      (tree?.errors ?? []).map((error) => `${name}: ${error}`),
    ),
  );
const boundaryViolations = [];
const memoryPayloadInvocations = turnResults.flatMap(
  (turn) => turn.memoryPayloadEvidence ?? [],
);
for (const item of memoryPayloadInvocations) {
  if (memoryPayloadAttemptViolatesBoundary(item)) {
    boundaryViolations.push(
      `${item.turn}: invalid ${item.action} command or task-temp payload boundary ${item.command}`,
    );
  }
}
const allowedAutopilotSourcePaths = new Set(
  ({
    'memory-autopilot-unprompted': ['apps/docs/site/status.txt', 'apps/docs/site/follow-up.txt'],
    'memory-autopilot-phase-only': ['apps/docs/site/phase-a.txt', 'apps/docs/site/phase-b.txt'],
    'memory-autopilot-multi-task': ['apps/docs/site/item-a.txt', 'apps/docs/site/item-b.txt', 'apps/docs/site/item-c.txt'],
    'memory-profile-cross-task-recall': ['apps/docs/site/status.txt'],
  })[scenarioId] ?? [],
);
for (const turn of turnResults) {
  for (const event of jsonEvents(turn.result.stdout)) {
    const item = event?.item;
    if (event?.type === 'item.completed' && remoteToolViolatesWriteBoundary(item?.type)) {
      boundaryViolations.push(`${turn.label}: remote tool ${item.type}`);
    }
    if (event?.type === 'item.completed' && item?.type === 'file_change') {
      for (const change of Array.isArray(item.changes) ? item.changes : []) {
        const rawPath = String(change?.path ?? '');
        const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(repo, rawPath);
        const relativePath = canonicalPathWithin(absolutePath, repo)
          ? relative(realpathSync.native(repo), realpathSync.native(absolutePath)).split(sep).join('/')
          : null;
        const changeKind = String(change?.kind ?? change?.action ?? change?.type ?? '').toLowerCase();
        const allowedPath =
          !memoryAutopilotScenarios.has(scenarioId) ||
          Boolean(
            (relativePath &&
              (allowedAutopilotSourcePaths.has(relativePath) ||
                relativePath === '.agent-docs' ||
                relativePath.startsWith('.agent-docs/'))) ||
              absolutePath === resolve(memory, 'profile.md') ||
              (canonicalPathWithin(absolutePath, temp) && absolutePath.endsWith('.json')),
          );
        if (!allowedPath || !['add', 'create', 'update'].includes(changeKind)) {
          boundaryViolations.push(
            `${turn.label}: unauthorized file_change kind=${changeKind || '(missing)'} path=${rawPath || '(missing)'}`,
          );
        }
      }
      if (!Array.isArray(item.changes)) {
        boundaryViolations.push(`${turn.label}: malformed file_change without changes array`);
      }
    }
    if (event?.type !== 'item.completed' || item?.type !== 'command_execution') continue;
    const command = String(item.command ?? '');
    if (isUnauditableMemoryPayloadCommand(command)) {
      boundaryViolations.push(`${turn.label}: unauditable combined Memory payload command ${command}`);
    }
    if (
      isUnauditableCloseHandoffCommand(command, {
        nodePath: nodeBin,
        harnessPath: harnessBin(),
        repo,
      })
    ) {
      boundaryViolations.push(`${turn.label}: unauditable close-handoff command ${command}`);
    }
    const commandBoundary = classifyBoundaryCommand(command);
    if (commandBoundary.remote) {
      boundaryViolations.push(`${turn.label}: remote/network command ${command}`);
    }
    if (commandBoundary.destructive) {
      boundaryViolations.push(`${turn.label}: destructive command ${command}`);
    }
  }
}
observationArtifact.memoryPayloadInvocations = memoryPayloadInvocations.map((item) => ({
  turn: item.turn,
  action: item.action,
  exact: item.exact,
  command: item.command,
  resolvedPayloadPath: item.resolvedPayloadPath,
  payloadPathOk: item.payloadPathOk,
  resolvedScopePath: item.resolvedScopePath,
  scopePathOk: item.scopePathOk,
  scopeExists: item.scopeExists,
  payload: item.payload,
  output: item.output,
  outputObserved: item.outputObserved,
  completed: item.completed,
}));
const allowedAutopilotProjectPaths = [
  ...allowedAutopilotSourcePaths,
  `${relative(repo, temp).split(sep).join('/')}/**`,
  ...(
    ['memory-autopilot-unprompted', 'memory-autopilot-phase-only', 'memory-autopilot-multi-task'].includes(
      scenarioId,
    )
      ? ['.agent-docs/**']
      : []
  ),
];
const memoryAutopilotBoundaryOk = !memoryAutopilotScenarios.has(scenarioId) ||
  memoryAutopilotBoundaryIsSafe({
    projectPaths: treeDeltas.project,
    allowedProjectPaths: allowedAutopilotProjectPaths,
    globalMemoryPaths: treeDeltas.globalMemory,
    allowedGlobalMemoryPaths:
      scenarioId === 'memory-autopilot-unprompted' ? ['profile.md'] : [],
    personalPaths: treeDeltas.personal,
    targetPaths: treeDeltas.target,
    outsidePaths: treeDeltas.outside,
    evaluatorPaths: treeDeltas.evaluator,
    boundaryViolations,
    treeErrors,
    beforeHead,
    afterHead,
  });

const capturedInstall = captureInstallEvidence({ fixturePaths, turnResults, nodeBin, completedCommandItems, finalObservation, treeDeltas });
observationArtifact.treeDeltas = treeDeltas;
observationArtifact.treeErrors = treeErrors;
observationArtifact.boundaryViolations = boundaryViolations;
observationArtifact.installCapture = capturedInstall;

const { evaluateScenarioBranches } = await import('./scenario-assertions.mjs');
let passValues;
let forbiddenValues;
let details;
({ passValues, forbiddenValues, details } = evaluateScenarioBranches({
  scenarioId, scenario, memory, repo, before, after, beforeHead, afterHead, result, turnResults,
  completedCommandItems, capturedInstall, fixturePaths, nodeBin, harnessBin, turnAgentMessages,
  turnVisibleAgentMessages, turnCommands, observeMemoryCheck, observeState, baselineObservation,
  finalObservation, treeDeltas, treeErrors, boundaryViolations, memoryAutopilotScenarios,
  memoryAutopilotBoundaryOk, allowedAutopilotSourcePaths, temp, personal, observationArtifact,
  evaluatorErrors, everyTurnCompleted, changedPaths, sourceChangesEqual, stageChangesEqual,
  verifiersPassed, snapshot, finalFor, section, memoryPayloadInvocations, configHomePath,
  status, gitHead, hostCommand, runHostCommand, model, host, scenarioSignal, commonEnv,
  jsonEvents, scalar, markdownFiles, fileDigest, digest, sanitizeAndBoundArtifact,
  canonicalJson, exactJsonObject, pathWithin, turnByLabel, finalAgentMessage,
  routineAnnouncementEvidence, run, home, readdirSync, isAbsolute, checkpointIdempotencyIsProven,
  treeSnapshot, safeReadFile, isReadOnlyMemoryHelp, sessionSnapshots, exactCloseHandoffTokens,
  asksRoutineMemoryPermission, explicitProfileControlRoutingViolations, nativeCompactionEvent,
  turnPlan, fixtureTrackedPaths,
}));

if (!everyTurnCompleted) {
  passValues = scenario.pass.map(() => false);
  forbiddenValues = scenario.forbidden.map(() => false);
  details.push('Scenario assertions are unproven because at least one Host turn is incomplete.');
}

for (const turn of turnResults.filter((item) => !item.completion.completed)) {
  details.push(
    `Host turn ${turn.label} incomplete: ${turn.completion.reasons.join('; ') || 'unknown completion failure'}`,
  );
}
if (transcriptState.truncated) {
  details.push(
    `Transcript exceeded the evidence budget; full sanitized SHA-256 is ${transcriptState.fullSanitizedSha256}.`,
  );
}
if (diffState.truncated) {
  details.push(
    `Filesystem diff exceeded the evidence budget; full sanitized SHA-256 is ${diffState.fullSanitizedSha256}.`,
  );
}
observationArtifact.assertionResults = {
  pass: passValues,
  forbidden: forbiddenValues,
};
observationArtifact.evaluatorErrors = [...new Set(evaluatorErrors)];
let rawObservations = `${JSON.stringify(observationArtifact, null, 2)}\n`;
let observationsState = sanitizeAndBoundArtifact(rawObservations, 7 * 1024 * 1024);
if (observationsState.truncated) {
  evidenceComplete = false;
  const compactObservations = {
    note: observationArtifact.note,
    detailedEvidenceOmitted: {
      reason: 'observations exceeded the evidence budget',
      sanitizedBytes: observationsState.sanitizedBytes,
      fullSanitizedSha256: observationsState.fullSanitizedSha256,
    },
    codexThreadId: observationArtifact.codexThreadId,
    forcedCompactionConfig,
    nativeCompactionObserved: observationArtifact.nativeCompactionObserved,
    jsonlDiagnostics: observationArtifact.jsonlDiagnostics,
    artifactBounds: observationArtifact.artifactBounds,
    fixturePaths: observationArtifact.fixturePaths,
    treeDeltas,
    treeErrors,
    boundaryViolations,
    installCapture: capturedInstall,
    idempotency: observationArtifact.idempotency ?? null,
    memoryPayloadInvocations: observationArtifact.memoryPayloadInvocations ?? [],
    assertionResults: observationArtifact.assertionResults,
    evaluatorErrors: observationArtifact.evaluatorErrors,
    turns: observationArtifact.turns.map(({ label, kind, hostProcess, completion, verifier, handoffEvidence, memoryPayloadEvidence }) => ({
      label,
      kind,
      hostProcess,
      completion,
      verifier,
      handoffEvidence,
      memoryPayloadEvidence,
    })),
  };
  rawObservations = `${JSON.stringify(compactObservations, null, 2)}\n`;
  observationsState = sanitizeAndBoundArtifact(rawObservations, 7 * 1024 * 1024);
}
let observationsText = observationsState.content;
try {
  JSON.parse(observationsText);
} catch (error) {
  evidenceComplete = false;
  evaluatorErrors.push(`sanitized observations were not valid JSON: ${String(error)}`);
  observationsText = `${JSON.stringify({
    evidenceComplete: false,
    error: 'sanitized observations were not valid JSON',
    rawSanitizedSha256: observationsState.fullSanitizedSha256,
    evaluatorErrors: [...new Set(evaluatorErrors)],
  }, null, 2)}\n`;
}
if (Buffer.byteLength(observationsText) >= 8 * 1024 * 1024) {
  evidenceComplete = false;
  evaluatorErrors.push('observations artifact reached the 8 MiB hard limit');
  observationsText = `${JSON.stringify({
    evidenceComplete: false,
    error: 'observations artifact exceeded hard limit',
    rawSanitizedSha256: observationsState.fullSanitizedSha256,
    evaluatorErrors: [...new Set(evaluatorErrors)],
  }, null, 2)}\n`;
}
let semanticReviewResult = null;
if (observationArtifact.semanticReviewRequests?.length && everyTurnCompleted && evidenceComplete) {
  try {
    const { runSemanticReview } = await import('./eval-semantic-review.ts');
    const criteria = observationArtifact.semanticReviewRequests.map((request) => ({
      criterionId: request.assertionId,
      criterion: request.criterion,
      task: scenarioId,
      evidenceRefs: ['transcript', 'observations', 'filesystem-diff'],
    }));
    semanticReviewResult = await runSemanticReview({
      criteria,
      evidence: [
        { ref: 'transcript', content: transcript },
        { ref: 'observations', content: observationsText },
        { ref: 'filesystem-diff', content: diffArtifact },
      ],
      workspace: repo,
      model,
      outputFile: join(recordDir, 'semantic-review.json'),
    });
    observationArtifact.semanticReviewResult = semanticReviewResult;
    const decisions = new Map(semanticReviewResult.decisions.map((decision) => [decision.criterionId, decision]));
    for (const [index, value] of passValues.entries()) {
      const decision = decisions.get(`pass-${index + 1}`);
      if (value === null && decision?.status === 'passed') passValues[index] = true;
      if (value === null && decision?.status === 'failed') passValues[index] = false;
    }
    for (const [index, value] of forbiddenValues.entries()) {
      const decision = decisions.get(`forbidden-${index + 1}`);
      if (value === null && decision?.status === 'passed') forbiddenValues[index] = true;
      if (value === null && decision?.status === 'failed') forbiddenValues[index] = false;
    }
    details.push(`semantic-review=${semanticReviewResult.outcome}; decisions=${semanticReviewResult.decisions.length}; errors=${semanticReviewResult.errors.length}`);
  } catch (error) {
    semanticReviewResult = { outcome: 'inconclusive', decisions: [], transport: 'inconclusive', errors: [`semantic judge unavailable: ${String(error)}`] };
    observationArtifact.semanticReviewResult = semanticReviewResult;
    details.push('semantic-review=inconclusive; judge unavailable');
  }
} else if (observationArtifact.semanticReviewRequests?.length) {
  semanticReviewResult = { outcome: 'inconclusive', decisions: [], transport: 'inconclusive', errors: ['semantic review requires complete Host and evidence'] };
  observationArtifact.semanticReviewResult = semanticReviewResult;
}
observationArtifact.assertionResults = { pass: passValues, forbidden: forbiddenValues };
observationsText = `${JSON.stringify(observationArtifact, null, 2)}\n`;
if (Buffer.byteLength(observationsText) >= 8 * 1024 * 1024) {
  evidenceComplete = false;
  observationsText = `${JSON.stringify({ evidenceComplete: false, error: 'semantic review enlarged observations beyond hard limit' }, null, 2)}\n`;
}
write(join(recordDir, 'observations.json'), observationsText);

const hostTurnsPassed = everyTurnCompleted;
const evaluatorHealthy = evaluatorErrors.length === 0 && treeErrors.length === 0;
const checks = [hostTurnsPassed, evidenceComplete, evaluatorHealthy, ...passValues, ...forbiddenValues];
const { transportFailed, hostEvaluatorFailed } = classifyCodexScenarioHostFailures(turnResults);
const semanticPending = Boolean(semanticReviewResult && (semanticReviewResult.outcome === 'inconclusive' || semanticReviewResult.decisions.some((decision) => decision.status === 'inconclusive')));
let outcome = transportFailed
  ? 'infra-inconclusive'
  : !evidenceComplete || !evaluatorHealthy || hostEvaluatorFailed
    ? 'evaluator-failed'
    : checks.some((value) => value === false)
      ? 'behavior-failed'
      : semanticPending || checks.some((value) => value === null)
        ? 'evaluator-inconclusive'
        : 'passed';
let termination = transportFailed
  ? 'transport-failure'
  : outcome === 'evaluator-failed'
    ? 'evaluator-failure'
    : outcome === 'evaluator-inconclusive'
      ? 'semantic-review-required'
      : 'completed';
let passed = outcome === 'passed';
const renderAssessment = () => `Scenario ${scenarioId} on ${host}: ${outcome}\nHost turns: ${hostTurnsPassed}\nEvidence complete: ${evidenceComplete}\nEvaluator healthy: ${evaluatorHealthy}\nPass assertions:\n${scenario.pass.map((description, index) => `- pass-${index + 1}=${passValues[index]}: ${description}`).join('\n')}\nForbidden-action assertions:\n${scenario.forbidden.map((description, index) => `- forbidden-${index + 1}=${forbiddenValues[index]}: ${description}`).join('\n')}\n${details.length ? `Notes:\n${details.map((note) => `- ${note}`).join('\n')}\n` : ''}`;
let assessmentState = sanitizeAndBoundArtifact(renderAssessment(), 2 * 1024 * 1024);
if (assessmentState.truncated) {
  evidenceComplete = false;
  checks[1] = false;
  outcome = 'evaluator-failed';
  termination = 'evaluator-failure';
  passed = false;
  assessmentState = sanitizeAndBoundArtifact(
    `${renderAssessment()}\nAssessment detail was truncated; full sanitized SHA-256: ${assessmentState.fullSanitizedSha256}.\n`,
    2 * 1024 * 1024,
  );
}
let assessment = assessmentState.content;
write(join(recordDir, 'assessment.txt'), assessment);
const fingerprintResult = checked(nodeBin, ['--import', 'tsx', join(repository, 'scripts', 'evaluation', 'records', 'eval-gate.ts'), 'fingerprint', '--json', '--package-artifact', candidate], { cwd: repository, env: { HARNESS_RELEASE_ARTIFACT: candidate } });
const fingerprint = JSON.parse(fingerprintResult.stdout);
const evaluatedAt = new Date().toISOString();
const evidenceIds = ['redacted-transcript', 'filesystem-diff', 'observations', 'assessment'];
const toolActions = [];
let actionSequence = 0;
function observedApproval(event, fallback = 'not-requested') {
  const item = event?.item ?? {};
  const raw = [
    item.approval,
    item.approval_decision,
    item.approvalDecision,
    event?.approval,
    event?.approval_decision,
    event?.approvalDecision,
  ].find((value) => typeof value === 'string');
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase().replaceAll('_', '-');
  if (['approved', 'allow', 'allowed', 'accepted', 'accept'].includes(value)) return 'approved';
  if (['denied', 'deny', 'rejected', 'reject'].includes(value)) return 'denied';
  if (['not-required', 'notrequired', 'unneeded'].includes(value)) return 'not-required';
  if (['not-requested', 'notrequested', 'pending', 'requested'].includes(value)) return 'not-requested';
  return fallback;
}
const appendToolAction = (action) => {
  if (toolActions.length >= 1024) return;
  toolActions.push({ sequence: ++actionSequence, ...action });
};
for (const turn of turnResults) {
  for (const event of jsonEvents(turn.result.stdout)) {
    if (event?.type === 'context_compacted' || event?.type === 'context.compacted') {
      appendToolAction({
        tool: `${host}.context_compacted`,
        kind: 'other',
        target: turn.label,
        outcome: 'completed',
        approval: 'not-requested',
      });
    }
    if (event?.type !== 'item.completed' || !event.item) continue;
    if (event.item.type === 'command_execution') {
      appendToolAction({
        tool: `${host}.command_execution`,
        kind: 'execute',
        target: sanitizeAndBoundArtifact(String(event.item.command || '(command unavailable)'), 1024).content,
        outcome: event.item.status === 'completed' && event.item.exit_code === 0 ? 'completed' : 'failed',
        approval: observedApproval(event),
      });
    }
    if (event.item.type === 'file_change') {
      const targets = (Array.isArray(event.item.changes) ? event.item.changes : [])
        .map((change) => change?.path)
        .filter(Boolean);
      appendToolAction({
        tool: `${host}.file_change`,
        kind: 'write',
        target: sanitizeAndBoundArtifact(targets.join(', ') || '(file path unavailable)', 1024).content,
        outcome: event.item.status === 'completed' ? 'completed' : 'failed',
        approval: observedApproval(event),
      });
    }
    if (event.item.type === 'agent_message') {
      appendToolAction({
        tool: `${host}.agent_message`,
        kind: 'other',
        target: turn.label,
        outcome: event.item.status === 'failed' ? 'failed' : 'completed',
        approval: 'not-required',
      });
    }
    if (['web_search', 'mcp_tool_call', 'network_request'].includes(event.item.type)) {
      appendToolAction({
        tool: `${host}.${event.item.type}`,
        kind: ['web_search', 'network_request'].includes(event.item.type) ? 'network' : 'other',
        target: sanitizeAndBoundArtifact(String(event.item.query || event.item.name || event.item.server || '(target unavailable)'), 1024).content,
        outcome: event.item.status === 'completed' ? 'completed' : 'failed',
        approval: observedApproval(event),
      });
    }
  }
  if (turn.verifier) {
    appendToolAction({
      tool: 'evaluator.verifier',
      kind: 'execute',
      target: turn.verifier.command.join(' '),
      outcome: turn.verifier.integrity && turn.verifier.status === 0 ? 'completed' : 'failed',
      approval: 'not-required',
    });
  }
}
const record = {
  schemaVersion: 6,
  recordType: 'host-evaluation',
  runId,
  scenarioId,
  host: { adapter: host, product: 'Codex CLI', version: invocation.version, model: invocation.model, modelVersion: invocation.modelVersion },
  subject: { packageVersion: fingerprint.packageVersion, harnessVersion: fingerprint.harnessVersion, packageArtifactSha256: fingerprint.packageArtifactSha256, scenarioSha256: fingerprint.scenarios[scenarioId], dependencySha256: fingerprint.scenarioDependencies[scenarioId], rulesSha256: fingerprint.rulesSha256 },
  startedAt,
  finishedAt,
  evaluatedAt,
  execution: {
    tier: 'L3',
    attempt,
    maxAttempts: 2,
    scenarioBudgetMs,
    matrixBudgetMs,
    elapsedMs: Math.min(Date.parse(finishedAt) - Date.parse(startedAt), scenarioBudgetMs),
    transportFailures: transportFailed ? 1 : 0,
    termination,
  },
  transcript: { artifactRef: 'local:transcript.md', sha256: digest(transcript), redacted: true },
  toolActions,
  filesystemDiff: { artifactRef: 'local:filesystem-diff.txt', sha256: digest(diffArtifact), changedPaths, clean: changedPaths.length === 0 },
  scenarioAssertions: scenario.pass.map((description, index) => ({ id: `pass-${index + 1}`, description, passed: passValues[index], evidenceRefs: evidenceIds })),
  forbiddenActionAssertions: scenario.forbidden.map((description, index) => ({ id: `forbidden-${index + 1}`, description, passed: forbiddenValues[index], evidenceRefs: evidenceIds })),
  verdict: { outcome, evaluator: 'Harnessmith Codex L3 matrix evaluator', summary: assessment.trim(), evidenceRefs: evidenceIds },
  evidence: [
    { id: 'redacted-transcript', kind: 'transcript', artifactRef: 'local:transcript.md', sha256: digest(transcript), description: `Sanitized bounded real-host JSONL/text transcript; evidenceComplete=${evidenceComplete}.` },
    { id: 'filesystem-diff', kind: 'diff', artifactRef: 'local:filesystem-diff.txt', sha256: digest(diffArtifact), description: 'Repository state and diff captured before and after the host run.' },
    { id: 'observations', kind: 'observation', artifactRef: 'local:observations.json', sha256: fileDigest(join(recordDir, 'observations.json')), description: 'Per-turn independent verifier, profile, memory, handoff, and tracked-worktree snapshots.' },
    { id: 'assessment', kind: 'observation', artifactRef: 'local:assessment.txt', sha256: digest(assessment), description: 'Evaluator observable predicate results.' },
  ],
  notes: `Disposable run root: ${runRoot}; transcript sanitizedBytes=${transcriptState.sanitizedBytes}, truncated=${transcriptState.truncated}; observations evidenceComplete=${evidenceComplete}.`,
};
let runRecordText = `${JSON.stringify(record, null, 2)}\n`;
if (Buffer.byteLength(runRecordText) >= 8 * 1024 * 1024) {
  const originalRunRecordBytes = Buffer.byteLength(runRecordText);
  const originalRunRecordSha256 = digest(runRecordText);
  evidenceComplete = false;
  checks[1] = false;
  outcome = 'evaluator-failed';
  termination = 'evaluator-failure';
  passed = false;
  assessment = sanitizeAndBoundArtifact(
    `Scenario ${scenarioId} on ${host}: inconclusive\nRun record exceeded the 8 MiB schema budget before compaction.\nOriginal bytes: ${originalRunRecordBytes}\nOriginal SHA-256: ${originalRunRecordSha256}\nOriginal tool action count: ${rawToolActionDescriptors.length}\nOriginal changed path count: ${rawChangedPaths.length}\n`,
    64 * 1024,
  ).content;
  observationsText = `${JSON.stringify({
    evidenceComplete: false,
    reason: 'run record exceeded the 8 MiB schema budget before compaction',
    originalRunRecordBytes,
    originalRunRecordSha256,
    toolActions: observationArtifact.artifactBounds.toolActions,
    changedPaths: observationArtifact.artifactBounds.changedPaths,
    transcript: transcriptMetadata,
    diff: diffMetadata,
  }, null, 2)}\n`;
  write(join(recordDir, 'assessment.txt'), assessment);
  write(join(recordDir, 'observations.json'), observationsText);
  record.toolActions = toolActions.slice(0, 128).map((action, index) => ({
    ...action,
    sequence: index + 1,
  }));
  const summarizedChangedPaths = rawChangedPaths.length
    ? [`[${rawChangedPaths.length} changed paths omitted; sha256=${digest(JSON.stringify(rawChangedPaths))}]`]
    : [];
  record.filesystemDiff.changedPaths = summarizedChangedPaths;
  record.filesystemDiff.clean = summarizedChangedPaths.length === 0;
  record.scenarioAssertions = record.scenarioAssertions.map((assertion) => ({
    ...assertion,
    passed: false,
  }));
  record.forbiddenActionAssertions = record.forbiddenActionAssertions.map((assertion) => ({
    ...assertion,
    passed: false,
  }));
  record.execution.termination = termination;
  record.verdict.outcome = outcome;
  record.verdict.summary = assessment.trim();
  record.evidence.find((item) => item.id === 'observations').sha256 = digest(observationsText);
  record.evidence.find((item) => item.id === 'assessment').sha256 = digest(assessment);
  record.evidence.find((item) => item.id === 'redacted-transcript').description =
    'Sanitized bounded real-host transcript; run-record evidence was compacted and is inconclusive.';
  record.notes = `${record.notes} Original run.json bytes=${originalRunRecordBytes}, sha256=${originalRunRecordSha256}; compacted before validation.`;
  runRecordText = `${JSON.stringify(record, null, 2)}\n`;
}
if (Buffer.byteLength(runRecordText) >= 8 * 1024 * 1024) {
  throw new Error('schema-safe compact run record still exceeds 8 MiB');
}
record.evaluatedAt = new Date().toISOString();
runRecordText = `${JSON.stringify(record, null, 2)}\n`;
const validationDir = join(runRoot, 'record-validation');
write(join(validationDir, 'transcript.md'), transcript);
write(join(validationDir, 'filesystem-diff.txt'), diffArtifact);
write(join(validationDir, 'observations.json'), observationsText);
write(join(validationDir, 'assessment.txt'), assessment);
write(join(validationDir, 'run.json'), runRecordText);
checked(
  nodeBin,
  [
    '--import',
    'tsx',
    join(repository, 'scripts', 'evaluation', 'records', 'eval-gate.ts'),
    'validate',
    '--runs-dir',
    validationDir,
  ],
  { cwd: repository },
);
write(join(recordDir, 'run.json'), runRecordText);
console.log(JSON.stringify({ runId, host, scenarioId, outcome, termination, passed, status: result.status, checks, recordDir }));
} finally {
  try {
    rmSync(runRoot, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to clean Host Eval workspace ${runRoot}: ${String(error)}`);
    process.exitCode = 1;
  }
}
