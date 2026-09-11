export const captureEligibilityValues = {
  evaluation: ['complete', 'not-run'],
  candidateKind: ['input', 'experience', 'finding', 'handoff', 'profile'],
  retention: ['workstream', 'durable'],
  typedWriter: [
    'capture-input',
    'capture-experience',
    'capture-finding',
    'handoff',
    'reconcile-profile',
    'none',
  ],
  source: ['verified', 'missing', 'inferred'],
  sensitiveData: ['none', 'redacted', 'unredacted'],
  existingMatch: ['none', 'same', 'source-update'],
} as const;

type CaptureEligibilityValues = typeof captureEligibilityValues;
type ValueOf<K extends keyof CaptureEligibilityValues> = CaptureEligibilityValues[K][number];

export interface CaptureEligibilityInput {
  evaluation: ValueOf<'evaluation'>;
  candidateKind: ValueOf<'candidateKind'>;
  retention: ValueOf<'retention'>;
  taskReadOnly: boolean;
  highValue: boolean;
  rootInitialized: boolean;
  typedWriter: ValueOf<'typedWriter'>;
  authorized: boolean;
  source: ValueOf<'source'>;
  containsSecret: boolean;
  sensitiveData: ValueOf<'sensitiveData'>;
  cheaplyRecoverable: boolean;
  oneShotAuthorization: boolean;
  authoritativeDuplicate: boolean;
  existingMatch: ValueOf<'existingMatch'>;
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
  for (const [key, allowed] of Object.entries(captureEligibilityValues)) {
    const value = input[key as keyof CaptureEligibilityValues];
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`Invalid capture ${key}: ${String(value)}`);
    }
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
  const expectedWriters: Record<ValueOf<'candidateKind'>, ValueOf<'typedWriter'>> = {
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
