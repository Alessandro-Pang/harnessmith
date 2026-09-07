import type { HostProcessCapture } from './eval-codex-transport.js';

export type ReasoningScenario = {
  id: string;
  prompt: string;
  mode: string;
  activation: 'explicit' | 'inferred' | 'none';
  requiredArtifacts: string[];
  fixture: { facts: Record<string, unknown>; output: Record<string, unknown> };
};

export type ReasoningAttempt = { signal: AbortSignal; deadlineMs: number };

export type ReasoningCommandTrace = Array<{
  command: string;
  exitCode: number | null;
  output: string;
}>;

export type ReasoningResult = {
  id: string;
  outcome:
    | 'passed'
    | 'behavior-failed'
    | 'infra-inconclusive'
    | 'evaluator-failed'
    | 'evaluator-inconclusive';
  evidence: {
    routeJson: boolean;
    modeHit: boolean;
    activationMatched: boolean;
    reasoningSectionRead: boolean;
    requiredArtifacts: string[];
    missingArtifacts: string[];
    hostCompleted: boolean;
    routeRawQueryMatched: boolean;
    routeCommandSucceeded: boolean;
    sectionReadBeforeResult: boolean;
    independentFixtureOracle: boolean;
    semanticReview: 'pending' | 'not-applicable' | 'passed' | 'failed';
    commandTrace: ReasoningCommandTrace;
    semanticReviewRequest?: {
      criterionId: string;
      criterion: string;
      task: string;
      evidenceRefs: string[];
    };
  };
  error?: string;
};

export type ReasoningObservation = {
  started: HostProcessCapture;
  commandTrace: ReasoningCommandTrace;
  routeReport?: Record<string, unknown>;
  modes: Array<Record<string, unknown>>;
  routeIndex: number;
  sectionIndex: number;
  resultIndex: number;
  routeRawQueryMatched: boolean;
  routeCommandSucceeded: boolean;
  reasoningSectionRead: boolean;
  sectionReadBeforeResult: boolean;
  resultArtifact: Record<string, unknown>;
  observedArtifacts: string[];
  missingArtifacts: string[];
  independentFixtureOracle: boolean;
};
