import { join } from 'node:path';
import { routeDocumentation } from '../../../packages/harness/src/lib/documentation/docs-routing.js';
import type {
  MeasuredMetric,
  PromptRouteBenchmarkReport,
  PromptRouteCorpus,
} from './prompt-route-benchmark-types.js';

export interface CorpusEvaluation {
  cases: PromptRouteBenchmarkReport['cases'];
  actionTotal: number;
  actionCorrect: number;
  expectedTopics: number;
  recalledTopics: number;
  predictedAmbiguous: number;
  expectedAmbiguous: number;
  trueAmbiguous: number;
  forbiddenActions: number;
  adherent: number;
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function evaluateCorpus(
  corpus: PromptRouteCorpus,
  repositoryRoot: string,
): CorpusEvaluation {
  const docsRoot = join(repositoryRoot, 'template', 'agent-harness', 'docs');
  const counts = {
    actionTotal: 0,
    actionCorrect: 0,
    expectedTopics: 0,
    recalledTopics: 0,
    predictedAmbiguous: 0,
    expectedAmbiguous: 0,
    trueAmbiguous: 0,
    forbiddenActions: 0,
    adherent: 0,
  };
  const cases: PromptRouteBenchmarkReport['cases'] = corpus.cases.map((entry) => {
    const route = routeDocumentation(docsRoot, [entry.query]);
    const actual = {
      status: route.status,
      top1: route.top1?.name ?? null,
      topics: route.topics.map(({ name }) => name).sort(),
      ambiguity: [...route.ambiguity].sort(),
    };
    if (entry.expected.top1 !== null) {
      counts.actionTotal += 1;
      if (actual.top1 === entry.expected.top1) counts.actionCorrect += 1;
    }
    counts.expectedTopics += entry.expected.topics.length;
    counts.recalledTopics += entry.expected.topics.filter((topic) =>
      actual.topics.includes(topic),
    ).length;
    if (actual.status === 'ambiguous') counts.predictedAmbiguous += 1;
    if (entry.expected.status === 'ambiguous') counts.expectedAmbiguous += 1;
    if (actual.status === 'ambiguous' && entry.expected.status === 'ambiguous') {
      counts.trueAmbiguous += 1;
    }
    const forbidden = Boolean(
      actual.top1 && entry.expected.forbiddenPlaybooks.includes(actual.top1),
    );
    if (forbidden) counts.forbiddenActions += 1;
    const failures: string[] = [];
    if (actual.status !== entry.expected.status) failures.push('status-mismatch');
    if (actual.top1 !== entry.expected.top1) failures.push('top1-mismatch');
    if (!sameStrings(actual.topics, entry.expected.topics)) failures.push('topics-mismatch');
    if (forbidden) failures.push('forbidden-action-selected');
    if (failures.length === 0) counts.adherent += 1;
    return {
      id: entry.id,
      categories: entry.categories,
      expected: entry.expected,
      actual,
      failures,
    };
  });
  return { cases, ...counts };
}

function measured(
  numerator: number,
  denominator: number,
  threshold: number,
  direction: 'minimum' | 'maximum' = 'minimum',
): MeasuredMetric {
  const value = denominator === 0 ? 1 : numerator / denominator;
  return {
    status: 'measured',
    value,
    numerator,
    denominator,
    threshold,
    passed: direction === 'minimum' ? value >= threshold : value <= threshold,
  };
}

export function benchmarkMetrics(
  corpus: PromptRouteCorpus,
  evaluation: CorpusEvaluation,
): PromptRouteBenchmarkReport['metrics'] {
  const thresholds = corpus.thresholds;
  return {
    actionTop1Accuracy: measured(
      evaluation.actionCorrect,
      evaluation.actionTotal,
      thresholds.actionTop1Accuracy,
    ),
    topicRecall: measured(
      evaluation.recalledTopics,
      evaluation.expectedTopics,
      thresholds.topicRecall,
    ),
    ambiguityPrecision: measured(
      evaluation.trueAmbiguous,
      evaluation.predictedAmbiguous,
      thresholds.ambiguityPrecision,
    ),
    ambiguityRecall: measured(
      evaluation.trueAmbiguous,
      evaluation.expectedAmbiguous,
      thresholds.ambiguityRecall,
    ),
    ambiguityRate: measured(
      evaluation.predictedAmbiguous,
      corpus.cases.length,
      thresholds.ambiguityRateMaximum,
      'maximum',
    ),
    forbiddenActionCount: measured(
      evaluation.forbiddenActions,
      1,
      thresholds.forbiddenActionCount,
      'maximum',
    ),
    ruleAdherenceRate: measured(
      evaluation.adherent,
      corpus.cases.length,
      thresholds.ruleAdherenceRate,
    ),
    factVerification: {
      status: 'not-measured',
      reason:
        'Deterministic routing does not inspect project facts; evaluator or Host evidence is required.',
    },
    tokenCost: {
      status: 'not-measured',
      reason: 'No model token telemetry was provided; costs are never estimated.',
    },
    toolCallCost: {
      status: 'not-measured',
      reason: 'No evaluator or Host tool-call telemetry was provided; costs are never estimated.',
    },
  };
}
