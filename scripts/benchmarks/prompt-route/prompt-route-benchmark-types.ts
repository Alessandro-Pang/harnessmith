type RouteStatus = 'matched' | 'unmatched' | 'ambiguous';

interface PromptRouteCorpusCase {
  id: string;
  categories: string[];
  query: string;
  expected: {
    status: RouteStatus;
    top1: string | null;
    topics: string[];
    reasoningModes?: string[];
    forbiddenPlaybooks: string[];
  };
}

export interface PromptRouteCorpus {
  schemaVersion: 1;
  description: string;
  thresholds: {
    actionTop1Accuracy: number;
    topicRecall: number;
    ambiguityPrecision: number;
    ambiguityRecall: number;
    ambiguityRateMaximum: number;
    forbiddenActionCount: number;
    ruleAdherenceRate: number;
  };
  cases: PromptRouteCorpusCase[];
}

export interface MeasuredMetric {
  status: 'measured';
  value: number;
  numerator: number;
  denominator: number;
  threshold: number;
  passed: boolean;
}

interface UnmeasuredMetric {
  status: 'not-measured';
  reason: string;
}

export interface PromptRouteBenchmarkReport {
  version: 1;
  schema: 'urn:harnessmith:prompt-route-benchmark:v1';
  result: 'passed' | 'failed';
  sourceOfTruth: false;
  hostProof: false;
  corpusDigest: string;
  inputDigest: string;
  rulesFingerprint: string;
  candidateDigest: string;
  provenance: {
    runner: 'scripts/benchmarks/prompt-route/prompt-route-benchmark.ts';
    corpus: 'evals/prompt-route-corpus.v1.json';
    layer: 'deterministic-router';
  };
  layers: {
    deterministicRouter: { status: 'measured'; cases: number };
    mockEvaluator: { status: 'not-provided' };
    evaluator: { status: 'not-provided' };
    realHost: { status: 'not-provided' };
  };
  metrics: {
    actionTop1Accuracy: MeasuredMetric;
    topicRecall: MeasuredMetric;
    ambiguityPrecision: MeasuredMetric;
    ambiguityRecall: MeasuredMetric;
    ambiguityRate: MeasuredMetric;
    forbiddenActionCount: MeasuredMetric;
    ruleAdherenceRate: MeasuredMetric;
    reasoningModeExtraCount: MeasuredMetric;
    factVerification: UnmeasuredMetric;
    tokenCost: UnmeasuredMetric;
    toolCallCost: UnmeasuredMetric;
  };
  auditSamples: {
    falsePositiveGuards: string[];
    falseNegativeGuards: string[];
  };
  cases: Array<{
    id: string;
    categories: string[];
    expected: PromptRouteCorpusCase['expected'];
    actual: {
      status: RouteStatus;
      top1: string | null;
      topics: string[];
      reasoningModes: string[];
      ambiguity: string[];
    };
    failures: string[];
  }>;
}

export interface PromptRouteBenchmarkComparison {
  version: 1;
  sameInput: true;
  baselineCandidateDigest: string;
  candidateDigest: string;
  metricDeltas: Record<string, number>;
}
