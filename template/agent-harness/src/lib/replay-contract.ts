import type {
  ReplayContractInput,
  ReplayContractReport,
  ReplayDecision,
  ReplayResult,
} from './replay-contract-types.js';

export type { ReplayContractInput, ReplayContractReport } from './replay-contract-types.js';

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function nonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || /\r|\n/u.test(value)) {
    throw new Error(`Replay contract ${field} must be one non-empty line`);
  }
}

function digest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !digestPattern.test(value)) {
    throw new Error(`Replay contract ${field} must be a sha256 digest`);
  }
}

function exactKeys(value: object, allowed: string[], field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new Error(`Replay contract ${field} has unknown key: ${unknown[0]}`);
}

function assertInput(input: ReplayContractInput): void {
  if (!input || typeof input !== 'object' || input.version !== 1) {
    throw new Error('Replay contract requires version 1 input');
  }
  exactKeys(
    input,
    [
      'version',
      'kind',
      'signalId',
      'previousSignalId',
      'previousAttempt',
      'payload',
      'previousPayload',
      'commandExact',
      'output',
      'persistedState',
      'verifier',
    ],
    'input',
  );
  if (!['new-mutation', 'identical-replay'].includes(input.kind)) {
    throw new Error(`Invalid replay contract kind: ${String(input.kind)}`);
  }
  nonEmpty(input.signalId, 'signalId');
  nonEmpty(input.payload?.path, 'payload.path');
  digest(input.payload?.digest, 'payload.digest');
  exactKeys(input.payload, ['path', 'digest'], 'payload');
  if (input.previousPayload) {
    exactKeys(input.previousPayload, ['path', 'digest'], 'previousPayload');
    nonEmpty(input.previousPayload.path, 'previousPayload.path');
    digest(input.previousPayload.digest, 'previousPayload.digest');
  }
  if (input.previousSignalId !== undefined) nonEmpty(input.previousSignalId, 'previousSignalId');
  if (
    input.previousAttempt !== undefined &&
    !['started', 'failed', 'succeeded'].includes(input.previousAttempt)
  ) {
    throw new Error(`Invalid replay previousAttempt: ${String(input.previousAttempt)}`);
  }
  nonEmpty(input.persistedState?.path, 'persistedState.path');
  nonEmpty(input.persistedState?.reference, 'persistedState.reference');
  exactKeys(
    input.persistedState,
    [
      'path',
      'reference',
      'generation',
      'previousGeneration',
      'beforeDigest',
      'afterDigest',
      'beforeWorkspaceDigest',
      'afterWorkspaceDigest',
    ],
    'persistedState',
  );
  if (
    !Number.isSafeInteger(input.persistedState.generation) ||
    input.persistedState.generation < 1 ||
    !Number.isSafeInteger(input.persistedState.previousGeneration) ||
    input.persistedState.previousGeneration < 1
  ) {
    throw new Error('Replay contract generations must be positive safe integers');
  }
  for (const field of [
    'beforeDigest',
    'afterDigest',
    'beforeWorkspaceDigest',
    'afterWorkspaceDigest',
  ] as const) {
    digest(input.persistedState?.[field], `persistedState.${field}`);
  }
  nonEmpty(input.verifier?.command, 'verifier.command');
  exactKeys(
    input.verifier,
    ['command', 'exitCode', 'candidateDigest', 'currentCandidateDigest', 'workspaceDigest'],
    'verifier',
  );
  for (const field of ['candidateDigest', 'currentCandidateDigest', 'workspaceDigest'] as const) {
    digest(input.verifier?.[field], `verifier.${field}`);
  }
  if (!Number.isInteger(input.verifier.exitCode) || input.verifier.exitCode < 0) {
    throw new Error('Replay contract verifier.exitCode must be a non-negative integer');
  }
  if (typeof input.commandExact !== 'boolean' || typeof input.output?.observed !== 'boolean') {
    throw new Error('Replay contract commandExact and output.observed must be boolean');
  }
  exactKeys(input.output, ['observed', 'action', 'path', 'reference'], 'output');
}

function report(
  result: ReplayResult,
  decision: ReplayDecision,
  reasonCode: ReplayContractReport['reasonCode'],
  checks: ReplayContractReport['checks'],
): ReplayContractReport {
  return {
    version: 1,
    schema: 'urn:agent-harness:schema:replay-report:v1',
    mode: 'verify-only',
    sourceOfTruth: false,
    result,
    decision,
    reasonCode,
    checks,
  };
}

export function evaluateReplayContract(input: ReplayContractInput): ReplayContractReport {
  assertInput(input);
  const payloadIdentity = Boolean(
    input.previousPayload &&
      input.payload.path === input.previousPayload.path &&
      input.payload.digest === input.previousPayload.digest,
  );
  const persistedState =
    input.persistedState.beforeDigest === input.persistedState.afterDigest &&
    input.persistedState.beforeWorkspaceDigest === input.persistedState.afterWorkspaceDigest;
  const generationIdentity =
    input.kind === 'new-mutation' ||
    input.persistedState.generation === input.persistedState.previousGeneration;
  const verifierBinding =
    input.verifier.exitCode === 0 &&
    input.verifier.candidateDigest === input.verifier.currentCandidateDigest &&
    input.verifier.workspaceDigest === input.persistedState.afterWorkspaceDigest;
  const outputCompatibility = input.output.observed
    ? input.output.action === 'unchanged' &&
      input.output.path === input.persistedState.path &&
      input.output.reference === input.persistedState.reference
    : true;
  const checks = {
    payloadIdentity,
    commandIdentity: input.commandExact,
    persistedState,
    generationIdentity,
    verifierBinding,
    outputCompatibility,
  };

  if (input.previousAttempt === 'failed') {
    return report('inconclusive', 'new-payload-required', 'failed-attempt-frozen', checks);
  }
  if (input.previousAttempt === 'started') {
    return report('inconclusive', 'new-payload-required', 'incomplete-attempt-frozen', checks);
  }
  if (input.kind === 'new-mutation') {
    if (input.previousPayload) {
      return report('inconclusive', 'new-payload-required', 'new-mutation-reuses-payload', checks);
    }
    if (!input.commandExact) {
      return report('inconclusive', 'new-payload-required', 'new-mutation-command-inexact', checks);
    }
    return report('ready', 'execute', 'new-mutation-ready', {
      ...checks,
      payloadIdentity: true,
    });
  }
  if (
    !payloadIdentity ||
    !input.commandExact ||
    !persistedState ||
    !generationIdentity ||
    !verifierBinding ||
    !outputCompatibility
  ) {
    return report('inconclusive', 'new-payload-required', 'replay-proof-incomplete', checks);
  }
  return report(
    'verified',
    'skip-duplicate',
    input.previousSignalId === input.signalId
      ? 'duplicate-signal-state-proven'
      : 'identical-replay-state-proven',
    checks,
  );
}
