import { join } from 'node:path';
import { classifyCodexScenarioHostFailures } from './eval-codex-support.mjs';

/** Finalize bounded artifacts and emit one schema-validated Host Eval record. */
export function finalizeScenario(context) {
  const {
    everyTurnCompleted, evaluatorErrors, treeErrors, passValues, forbiddenValues, semanticReviewResult,
    turnResults, scenarioId, host, scenario, details, sanitizeAndBoundArtifact,
    recordDir, write, scenarioSignal, model, nodeBin, repository, checked, candidate, runRoot,
    transcript, diffArtifact, digest, fileDigest, changedPaths, rawToolActionDescriptors, rawChangedPaths,
    transcriptState, diffState, observationArtifact, runId, invocation, startedAt, finishedAt,
    attempt, scenarioBudgetMs, matrixBudgetMs, result, jsonEvents, turnAgentMessages,
  } = context;
  let evidenceComplete = context.evidenceComplete;
  let observationsText = context.observationsText;
  const { content: _transcriptContent, ...transcriptMetadata } = transcriptState;
  const { content: _diffContent, ...diffMetadata } = diffState;

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
}
