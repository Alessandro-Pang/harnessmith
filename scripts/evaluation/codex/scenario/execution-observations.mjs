import { sanitizeAndBoundArtifact } from '../eval-codex-support.mjs';

/**
 * @param {import('../support/types.mjs').ObservationArtifact} artifact
 * @param {import('../support/types.mjs').ArtifactState} state
 */
function compactObservations(artifact, state) {
  return {
    note: artifact.note,
    detailedEvidenceOmitted: {
      reason: 'observations exceeded the evidence budget',
      sanitizedBytes: state.sanitizedBytes,
      fullSanitizedSha256: state.fullSanitizedSha256,
    },
    codexThreadId: artifact.codexThreadId,
    forcedCompactionConfig: artifact.forcedCompactionConfig,
    nativeCompactionObserved: artifact.nativeCompactionObserved,
    jsonlDiagnostics: artifact.jsonlDiagnostics,
    artifactBounds: artifact.artifactBounds,
    fixturePaths: artifact.fixturePaths,
    treeDeltas: artifact.treeDeltas,
    treeErrors: artifact.treeErrors,
    boundaryViolations: artifact.boundaryViolations,
    installCapture: artifact.installCapture,
    idempotency: artifact.idempotency ?? null,
    memoryPayloadInvocations: artifact.memoryPayloadInvocations ?? [],
    assertionResults: artifact.assertionResults,
    evaluatorErrors: artifact.evaluatorErrors,
    turns: artifact.turns.map(
      ({
        label,
        kind,
        hostProcess,
        completion,
        verifier,
        handoffEvidence,
        memoryPayloadEvidence,
      }) => ({
        label,
        kind,
        hostProcess,
        completion,
        verifier,
        handoffEvidence,
        memoryPayloadEvidence,
      }),
    ),
  };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-artifacts.mjs').createRunArtifacts>} artifacts
 */
export function createBoundedObservations(context, artifacts) {
  const artifact = artifacts.observationArtifact;
  let raw = `${JSON.stringify(artifact, null, 2)}\n`;
  let state = sanitizeAndBoundArtifact(raw, 7 * 1024 * 1024);
  if (state.truncated) {
    artifacts.evidenceComplete = false;
    raw = `${JSON.stringify(compactObservations(artifact, state), null, 2)}\n`;
    state = sanitizeAndBoundArtifact(raw, 7 * 1024 * 1024);
  }
  let observationsText = state.content;
  try {
    JSON.parse(observationsText);
  } catch (error) {
    artifacts.evidenceComplete = false;
    context.evaluatorErrors.push(`sanitized observations were not valid JSON: ${String(error)}`);
    observationsText = errorObservation(
      'sanitized observations were not valid JSON',
      state.fullSanitizedSha256,
      context.evaluatorErrors,
    );
  }
  if (Buffer.byteLength(observationsText) >= 8 * 1024 * 1024) {
    artifacts.evidenceComplete = false;
    context.evaluatorErrors.push('observations artifact reached the 8 MiB hard limit');
    observationsText = errorObservation(
      'observations artifact exceeded hard limit',
      state.fullSanitizedSha256,
      context.evaluatorErrors,
    );
  }
  return observationsText;
}

/**
 * @param {string} error
 * @param {string} sha256
 * @param {string[]} evaluatorErrors
 */
function errorObservation(error, sha256, evaluatorErrors) {
  return `${JSON.stringify(
    {
      evidenceComplete: false,
      error,
      rawSanitizedSha256: sha256,
      evaluatorErrors: [...new Set(evaluatorErrors)],
    },
    null,
    2,
  )}\n`;
}
