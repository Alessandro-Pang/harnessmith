export type ExpectedMemoryDecision = 'write' | 'no-write' | 'proposed' | 'blocked';
export type MemoryWriterAction =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'no-change'
  | 'proposed'
  | 'blocked';
export type MemoryStateTransition = 'created' | 'updated' | 'unchanged' | 'no-change' | 'blocked';
export type MemoryFailureCategory =
  | 'policy-mismatch'
  | 'state-mismatch'
  | 'evidence-missing'
  | 'verifier-failed'
  | 'infra-inconclusive'
  | 'qualitative-only'
  | 'evaluator-inconclusive';
export type MemoryVerificationOutcome = 'passed' | 'failed' | 'inconclusive';

/** A path-to-content-digest map captured independently before or after a trial. */
export interface MemoryFileState {
  files: Readonly<Record<string, string>>;
}

export interface MemoryWriterEvent {
  action: MemoryWriterAction;
  /** Stable machine-readable reason; `reason` is accepted for adapters that expose that name. */
  reasonCode?: string;
  reason?: string;
}

export interface MemoryVerificationInput {
  before: MemoryFileState;
  after: MemoryFileState;
  expectedDecision: ExpectedMemoryDecision;
  expectedAction?: MemoryWriterAction;
  actual: MemoryWriterEvent;
  /** State/verifier evidence is incomplete when this is explicitly false. */
  evidence?: { complete?: boolean };
  /** An external verifier can report a failure independently of the writer. */
  verifier?: { status?: 'passed' | 'failed' | 'inconclusive'; message?: string };
  /** Trials with only qualitative transcript evidence cannot establish persistence. */
  qualitativeOnly?: boolean;
  /** Infrastructure could not produce a trustworthy state observation. */
  infrastructureInconclusive?: boolean;
  /** Independent semantic state oracle for free-form persisted meaning. */
  semantic?: { status: 'passed' | 'failed' | 'inconclusive'; message?: string };
}

export interface MemoryVerificationResult {
  transition: MemoryStateTransition;
  outcome: MemoryVerificationOutcome;
  failureCategory: MemoryFailureCategory | null;
  actualDecision: 'write' | 'no-write' | 'proposed' | 'blocked';
  reasons: string[];
  stateChanged: boolean;
}

function sortedFiles(files: Readonly<Record<string, string>>): Array<[string, string]> {
  return Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
}

function equalState(before: MemoryFileState, after: MemoryFileState): boolean {
  const left = sortedFiles(before.files);
  const right = sortedFiles(after.files);
  return (
    left.length === right.length &&
    left.every(([path, digest], index) => {
      const pair = right[index];
      return pair?.[0] === path && pair[1] === digest;
    })
  );
}

function hasFiles(state: MemoryFileState): boolean {
  return Object.keys(state.files).length > 0;
}

export function classifyMemoryStateTransition(
  before: MemoryFileState,
  after: MemoryFileState,
  action: MemoryWriterAction,
): MemoryStateTransition {
  if (action === 'blocked') return 'blocked';
  const unchanged = equalState(before, after);
  if (unchanged) return action === 'unchanged' ? 'unchanged' : 'no-change';
  return !hasFiles(before) && hasFiles(after) ? 'created' : 'updated';
}

function actualDecision(action: MemoryWriterAction): MemoryVerificationResult['actualDecision'] {
  if (action === 'created' || action === 'updated') return 'write';
  if (action === 'proposed') return 'proposed';
  if (action === 'blocked') return 'blocked';
  return 'no-write';
}

function inconclusiveResult(
  input: MemoryVerificationInput,
  failureCategory: MemoryFailureCategory,
  reason: string,
): MemoryVerificationResult {
  return {
    transition: 'no-change',
    outcome: 'inconclusive',
    failureCategory,
    actualDecision: actualDecision(input.actual.action),
    reasons: [reason],
    stateChanged: false,
  };
}

function agreesWithObservedState(
  action: MemoryWriterAction,
  transition: MemoryStateTransition,
  stateChanged: boolean,
): boolean {
  if (action === 'blocked') return !stateChanged;
  if (action === 'created') return transition === 'created';
  if (action === 'updated') return transition === 'updated';
  if (action === 'unchanged') return transition === 'unchanged';
  if (action === 'no-change' || action === 'proposed') {
    return transition === 'no-change' || transition === 'unchanged';
  }
  return false;
}

function agreesWithExpectedDecision(
  expected: ExpectedMemoryDecision,
  predicted: MemoryVerificationResult['actualDecision'],
  transition: MemoryStateTransition,
): boolean {
  if (expected === 'write') {
    return predicted === 'write' && (transition === 'created' || transition === 'updated');
  }
  if (expected === 'no-write') {
    return predicted === 'no-write' && (transition === 'no-change' || transition === 'unchanged');
  }
  if (expected === 'proposed') {
    return predicted === 'proposed' && (transition === 'no-change' || transition === 'unchanged');
  }
  return predicted === 'blocked' && transition === 'blocked';
}

function earlyMemoryResult(input: MemoryVerificationInput): MemoryVerificationResult | null {
  if (input.qualitativeOnly)
    return inconclusiveResult(
      input,
      'qualitative-only',
      'qualitative evidence cannot establish durable Memory state',
    );
  if (input.infrastructureInconclusive)
    return inconclusiveResult(
      input,
      'infra-inconclusive',
      'infrastructure did not produce a trustworthy state observation',
    );
  if (input.evidence?.complete === false)
    return inconclusiveResult(
      input,
      'evidence-missing',
      'before/after state evidence is incomplete',
    );
  if (input.verifier?.status === 'inconclusive')
    return inconclusiveResult(
      input,
      'infra-inconclusive',
      input.verifier.message ?? 'independent verifier was inconclusive',
    );
  return null;
}

/** Verify a typed writer result against independently captured file state. */
export function verifyMemoryState(input: MemoryVerificationInput): MemoryVerificationResult {
  const early = earlyMemoryResult(input);
  if (early) return early;
  if (input.verifier?.status === 'failed') {
    return {
      transition: 'no-change',
      outcome: 'failed',
      failureCategory: 'verifier-failed',
      actualDecision: actualDecision(input.actual.action),
      reasons: [input.verifier.message ?? 'independent verifier failed'],
      stateChanged: false,
    };
  }

  if (input.semantic?.status === 'inconclusive') {
    return inconclusiveResult(
      input,
      'evaluator-inconclusive',
      input.semantic.message ?? 'independent semantic state oracle is inconclusive',
    );
  }
  if (input.semantic?.status === 'failed') {
    return {
      transition: 'no-change',
      outcome: 'failed',
      failureCategory: 'state-mismatch',
      actualDecision: actualDecision(input.actual.action),
      reasons: [input.semantic.message ?? 'independent semantic state oracle failed'],
      stateChanged: false,
    };
  }

  const unchanged = equalState(input.before, input.after);
  const stateChanged = !unchanged;
  const transition = classifyMemoryStateTransition(input.before, input.after, input.actual.action);
  const predicted = actualDecision(input.actual.action);
  const expectedAction = input.expectedAction;
  if (expectedAction && input.actual.action !== expectedAction) {
    return {
      transition,
      outcome: 'failed',
      failureCategory: 'policy-mismatch',
      actualDecision: predicted,
      reasons: [`expected writer action ${expectedAction} but observed ${input.actual.action}`],
      stateChanged,
    };
  }
  if (!agreesWithObservedState(input.actual.action, transition, stateChanged)) {
    return {
      transition,
      outcome: 'failed',
      failureCategory: 'state-mismatch',
      actualDecision: predicted,
      reasons: [
        `writer action ${input.actual.action} contradicts observed ${transition} transition`,
      ],
      stateChanged,
    };
  }
  if (!agreesWithExpectedDecision(input.expectedDecision, predicted, transition)) {
    return {
      transition,
      outcome: 'failed',
      failureCategory: 'policy-mismatch',
      actualDecision: predicted,
      reasons: [`expected ${input.expectedDecision} but observed ${predicted}/${transition}`],
      stateChanged,
    };
  }
  return {
    transition,
    outcome: 'passed',
    failureCategory: null,
    actualDecision: predicted,
    reasons: [],
    stateChanged,
  };
}
