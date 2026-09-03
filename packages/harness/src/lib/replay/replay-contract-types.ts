export type ReplayDecision = 'execute' | 'skip-duplicate' | 'new-payload-required';
export type ReplayResult = 'ready' | 'verified' | 'inconclusive';

interface ReplayPayloadIdentity {
  path: string;
  digest: string;
}

interface ReplayOutput {
  observed: boolean;
  action?: string;
  path?: string;
  reference?: string;
}

export interface ReplayContractInput {
  version: 1;
  kind: 'new-mutation' | 'identical-replay';
  signalId: string;
  previousSignalId?: string;
  previousAttempt?: 'started' | 'failed' | 'succeeded';
  payload: ReplayPayloadIdentity;
  previousPayload?: ReplayPayloadIdentity;
  commandExact: boolean;
  output: ReplayOutput;
  persistedState: {
    path: string;
    reference: string;
    generation: number;
    previousGeneration: number;
    beforeDigest: string;
    afterDigest: string;
    beforeWorkspaceDigest: string;
    afterWorkspaceDigest: string;
  };
  verifier: {
    command: string;
    exitCode: number;
    candidateDigest: string;
    currentCandidateDigest: string;
    workspaceDigest: string;
  };
}

export interface ReplayContractReport {
  version: 1;
  schema: 'urn:agent-harness:schema:replay-report:v1';
  mode: 'verify-only';
  sourceOfTruth: false;
  result: ReplayResult;
  decision: ReplayDecision;
  reasonCode:
    | 'new-mutation-ready'
    | 'new-mutation-reuses-payload'
    | 'new-mutation-command-inexact'
    | 'failed-attempt-frozen'
    | 'incomplete-attempt-frozen'
    | 'duplicate-signal-state-proven'
    | 'identical-replay-state-proven'
    | 'replay-proof-incomplete';
  checks: {
    payloadIdentity: boolean;
    commandIdentity: boolean;
    persistedState: boolean;
    generationIdentity: boolean;
    verifierBinding: boolean;
    outputCompatibility: boolean;
  };
}
