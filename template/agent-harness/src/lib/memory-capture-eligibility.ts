type CaptureCandidateKind = 'input' | 'experience' | 'finding' | 'handoff' | 'profile';
type CaptureRetention = 'workstream' | 'durable';
type CaptureTypedWriter =
  | 'capture-input'
  | 'capture-experience'
  | 'capture-finding'
  | 'handoff'
  | 'reconcile-profile'
  | 'none';

export interface CaptureEligibilityInput {
  evaluation: 'complete' | 'not-run';
  candidateKind: CaptureCandidateKind;
  retention: CaptureRetention;
  taskReadOnly: boolean;
  highValue: boolean;
  rootInitialized: boolean;
  typedWriter: CaptureTypedWriter;
  authorized: boolean;
  source: 'verified' | 'missing' | 'inferred';
  containsSecret: boolean;
  sensitiveData: 'none' | 'redacted' | 'unredacted';
  cheaplyRecoverable: boolean;
  oneShotAuthorization: boolean;
  authoritativeDuplicate: boolean;
  existingMatch: 'none' | 'same' | 'source-update';
}

type CaptureEligibilityStatus = 'unchanged' | 'proposed' | 'blocked' | 'not-evaluated';
type CaptureEligibilityReasonCode =
  | 'evaluation-not-run'
  | 'secret-detected'
  | 'unredacted-sensitive-data'
  | 'one-shot-authorization'
  | 'cheaply-recoverable-current-state'
  | 'authoritative-fact-duplicate'
  | 'value-threshold-not-met'
  | 'source-missing'
  | 'source-inferred-only'
  | 'authorization-missing'
  | 'semantic-duplicate'
  | 'memory-root-uninitialized'
  | 'typed-writer-unavailable'
  | 'typed-writer-mismatch'
  | 'typed-source-update-ready'
  | 'typed-create-ready';

export interface CaptureEligibilityResult {
  version: 1;
  status: CaptureEligibilityStatus;
  eligible: boolean;
  reasonCode: CaptureEligibilityReasonCode;
}

function result(
  status: CaptureEligibilityStatus,
  eligible: boolean,
  reasonCode: CaptureEligibilityReasonCode,
): CaptureEligibilityResult {
  return { version: 1, status, eligible, reasonCode };
}

function assertInput(input: CaptureEligibilityInput): void {
  if (!['complete', 'not-run'].includes(input.evaluation)) {
    throw new Error(`Invalid capture evaluation state: ${String(input.evaluation)}`);
  }
  if (!['input', 'experience', 'finding', 'handoff', 'profile'].includes(input.candidateKind)) {
    throw new Error(`Invalid capture candidate kind: ${String(input.candidateKind)}`);
  }
  if (!['workstream', 'durable'].includes(input.retention)) {
    throw new Error(`Invalid capture retention: ${String(input.retention)}`);
  }
  if (
    ![
      'capture-input',
      'capture-experience',
      'capture-finding',
      'handoff',
      'reconcile-profile',
      'none',
    ].includes(input.typedWriter)
  ) {
    throw new Error(`Invalid capture typed writer: ${String(input.typedWriter)}`);
  }
  if (!['verified', 'missing', 'inferred'].includes(input.source)) {
    throw new Error(`Invalid capture source state: ${String(input.source)}`);
  }
  if (!['none', 'redacted', 'unredacted'].includes(input.sensitiveData)) {
    throw new Error(`Invalid capture sensitive data state: ${String(input.sensitiveData)}`);
  }
  if (!['none', 'same', 'source-update'].includes(input.existingMatch)) {
    throw new Error(`Invalid capture existing match: ${String(input.existingMatch)}`);
  }
}

export function evaluateCaptureEligibility(
  input: CaptureEligibilityInput,
): CaptureEligibilityResult {
  assertInput(input);
  if (input.evaluation === 'not-run') {
    return result('not-evaluated', false, 'evaluation-not-run');
  }
  if (input.containsSecret) return result('blocked', false, 'secret-detected');
  if (input.sensitiveData === 'unredacted') {
    return result('blocked', false, 'unredacted-sensitive-data');
  }
  if (input.oneShotAuthorization) return result('unchanged', false, 'one-shot-authorization');
  if (input.retention === 'durable' && input.cheaplyRecoverable) {
    return result('unchanged', false, 'cheaply-recoverable-current-state');
  }
  if (input.retention === 'durable' && input.authoritativeDuplicate) {
    return result('unchanged', false, 'authoritative-fact-duplicate');
  }
  if (!input.highValue) return result('unchanged', false, 'value-threshold-not-met');
  if (input.source === 'missing') return result('blocked', false, 'source-missing');
  if (input.source === 'inferred') return result('blocked', false, 'source-inferred-only');
  if (!input.authorized) return result('blocked', false, 'authorization-missing');
  if (input.existingMatch === 'same') return result('unchanged', false, 'semantic-duplicate');
  if (!input.rootInitialized) {
    return result('proposed', false, 'memory-root-uninitialized');
  }
  if (input.typedWriter === 'none') return result('proposed', false, 'typed-writer-unavailable');
  const expectedWriters: Record<CaptureCandidateKind, CaptureTypedWriter> = {
    input: 'capture-input',
    experience: 'capture-experience',
    finding: 'capture-finding',
    handoff: 'handoff',
    profile: 'reconcile-profile',
  };
  if (input.typedWriter !== expectedWriters[input.candidateKind]) {
    return result('proposed', false, 'typed-writer-mismatch');
  }
  if (input.existingMatch === 'source-update') {
    return result('proposed', true, 'typed-source-update-ready');
  }
  return result('proposed', true, 'typed-create-ready');
}
