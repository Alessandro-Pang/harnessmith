import {
  buildRecordAssertions,
  buildRecordEvidence,
  buildRecordExecution,
} from './finalization-record-parts.mjs';

/** @param {import('./finalization-types.mjs').FinalizationRecordInput} input */
export function createScenarioRecord(input) {
  const { runId, scenarioId, host, invocation, fingerprint, outcome, assessment } = input;
  const evidenceIds = ['redacted-transcript', 'filesystem-diff', 'observations', 'assessment'];
  return {
    schemaVersion: 6,
    recordType: 'host-evaluation',
    runId,
    scenarioId,
    host: {
      adapter: host,
      product: 'Codex CLI',
      version: invocation.version,
      model: invocation.model,
      modelVersion: invocation.modelVersion,
    },
    subject: {
      packageVersion: fingerprint.packageVersion,
      harnessVersion: fingerprint.harnessVersion,
      packageArtifactSha256: fingerprint.packageArtifactSha256,
      scenarioSha256: fingerprint.scenarios[scenarioId],
      dependencySha256: fingerprint.scenarioDependencies[scenarioId],
      rulesSha256: fingerprint.rulesSha256,
    },
    ...buildRecordExecution(input),
    ...buildRecordAssertions(input, evidenceIds),
    verdict: {
      outcome,
      evaluator: 'Harnessmith Codex L3 matrix evaluator',
      summary: assessment.trim(),
      evidenceRefs: evidenceIds,
    },
    evidence: buildRecordEvidence(input),
    notes: `Disposable run root: ${input.runRoot}; transcript sanitizedBytes=${input.transcriptState.sanitizedBytes}, truncated=${input.transcriptState.truncated}; observations evidenceComplete=${input.evidenceComplete}.`,
  };
}

/**
 * @param {{ record: ReturnType<typeof createScenarioRecord>, context: import('./finalization-types.mjs').FinalizationContext, assessment: string, outcome: string, termination: string, originalRunRecordBytes: number, originalRunRecordSha256: string }} input
 */
export function compactScenarioRecord({
  record,
  context,
  assessment,
  outcome,
  termination,
  originalRunRecordBytes,
  originalRunRecordSha256,
}) {
  const { rawToolActionDescriptors, rawChangedPaths, digest, observationArtifact } = context;
  const { content: _transcriptContent, ...transcriptMetadata } = context.transcriptState;
  const { content: _diffContent, ...diffMetadata } = context.diffState;
  const observationsText = `${JSON.stringify(
    {
      evidenceComplete: false,
      reason: 'run record exceeded the 8 MiB schema budget before compaction',
      originalRunRecordBytes,
      originalRunRecordSha256,
      toolActions: observationArtifact.artifactBounds.toolActions,
      changedPaths: observationArtifact.artifactBounds.changedPaths,
      transcript: transcriptMetadata,
      diff: diffMetadata,
    },
    null,
    2,
  )}\n`;
  record.toolActions = record.toolActions.slice(0, 128).map((action, index) => ({
    ...action,
    sequence: index + 1,
  }));
  const summarizedChangedPaths = rawChangedPaths.length
    ? [
        `[${rawChangedPaths.length} changed paths omitted; sha256=${digest(JSON.stringify(rawChangedPaths))}]`,
      ]
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
  for (const [id, sha256] of [
    ['observations', digest(observationsText)],
    ['assessment', digest(assessment)],
  ]) {
    const evidence = record.evidence.find((item) => item.id === id);
    if (evidence) evidence.sha256 = sha256;
  }
  const transcriptEvidence = record.evidence.find((item) => item.id === 'redacted-transcript');
  if (transcriptEvidence) {
    transcriptEvidence.description =
      'Sanitized bounded real-host transcript; run-record evidence was compacted and is inconclusive.';
  }
  record.notes = `${record.notes} Original run.json bytes=${originalRunRecordBytes}, sha256=${originalRunRecordSha256}; compacted before validation.`;
  return { observationsText, record, originalToolActionCount: rawToolActionDescriptors.length };
}
