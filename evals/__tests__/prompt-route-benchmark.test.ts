import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  benchmarkMetrics,
  evaluateCorpus,
} from '../../scripts/benchmarks/prompt-route/prompt-route-benchmark-evaluate.js';
import {
  comparePromptRouteBenchmarks,
  repositoryRoot,
  runPromptRouteBenchmark,
} from '../../scripts/benchmarks/prompt-route/prompt-route-benchmark-lib.js';
import type { PromptRouteCorpus } from '../../scripts/benchmarks/prompt-route/prompt-route-benchmark-types.js';

test('prompt route benchmark is versioned, reproducible, and passes deterministic thresholds', () => {
  const first = runPromptRouteBenchmark();
  const second = runPromptRouteBenchmark();

  assert.deepEqual(second, first);
  assert.equal(first.version, 1);
  assert.equal(first.result, 'passed');
  assert.match(first.corpusDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.inputDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.rulesFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.candidateDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.metrics.actionTop1Accuracy.value, 1);
  assert.equal(first.metrics.topicRecall.value, 1);
  assert.equal(first.metrics.forbiddenActionCount.value, 0);
  assert.equal(first.layers.deterministicRouter.status, 'measured');
  assert.equal(first.layers.mockEvaluator.status, 'not-provided');
  assert.equal(first.layers.evaluator.status, 'not-provided');
  assert.equal(first.layers.realHost.status, 'not-provided');
  assert.equal(first.metrics.factVerification.status, 'not-measured');
  assert.equal(first.metrics.tokenCost.status, 'not-measured');
  assert.equal(first.metrics.toolCallCost.status, 'not-measured');
  assert.equal(first.hostProof, false);
});

test('the corpus covers bilingual routing risks and keeps false-positive and false-negative samples auditable', () => {
  const corpus = JSON.parse(
    readFileSync(join(repositoryRoot, 'evals', 'prompt-route-corpus.v1.json'), 'utf8'),
  );
  const categories = new Set<string>(
    corpus.cases.flatMap((entry: { categories: string[] }) => entry.categories),
  );
  for (const required of [
    'zh',
    'en',
    'negation',
    'quotation',
    'example',
    'long',
    'high-loss-signal',
    'false-positive-guard',
    'false-negative-guard',
  ]) {
    assert.ok(categories.has(required), required);
  }
});

test('baseline comparison requires identical inputs and reports metric deltas', () => {
  const candidate = runPromptRouteBenchmark();
  const baseline = { ...candidate, candidateDigest: `sha256:${'f'.repeat(64)}` };
  const comparison = comparePromptRouteBenchmarks(candidate, baseline);
  assert.equal(comparison.sameInput, true);
  assert.equal(comparison.baselineCandidateDigest, baseline.candidateDigest);
  assert.notEqual(comparison.baselineCandidateDigest, comparison.candidateDigest);
  assert.deepEqual(new Set(Object.values(comparison.metricDeltas)), new Set([0]));

  assert.throws(
    () =>
      comparePromptRouteBenchmarks(candidate, {
        ...baseline,
        inputDigest: `sha256:${'0'.repeat(64)}`,
      }),
    /same corpus inputs/i,
  );
});

test('benchmark metrics do not pass when a metric has no denominator', () => {
  const corpus = {
    cases: [],
    thresholds: {
      actionTop1Accuracy: 1,
      topicRecall: 1,
      ambiguityPrecision: 1,
      ambiguityRecall: 1,
      ambiguityRateMaximum: 0.25,
      forbiddenActionCount: 0,
      ruleAdherenceRate: 1,
    },
  } as unknown as PromptRouteCorpus;
  const metrics = benchmarkMetrics(corpus, {
    cases: [],
    actionTotal: 0,
    actionCorrect: 0,
    expectedTopics: 0,
    recalledTopics: 0,
    predictedAmbiguous: 0,
    expectedAmbiguous: 0,
    trueAmbiguous: 0,
    forbiddenActions: 0,
    adherent: 0,
    reasoningModeExtras: 0,
  });

  assert.equal(metrics.actionTop1Accuracy.denominator, 0);
  assert.equal(metrics.actionTop1Accuracy.passed, false);
  assert.equal(metrics.topicRecall.passed, false);
});

test('missing expected reasoning modes are treated as an empty set and count extras', () => {
  const corpus = {
    cases: [
      {
        id: 'decision-without-expected-modes',
        categories: ['reasoning'],
        query: '请分析并比较这三个方案，结合长期副作用和继续调查的成本给出建议。',
        expected: {
          status: 'matched',
          top1: 'research-and-design',
          topics: [],
          forbiddenPlaybooks: [],
        },
      },
    ],
  } as unknown as PromptRouteCorpus;
  const evaluation = evaluateCorpus(corpus, repositoryRoot);

  assert.equal(evaluation.reasoningModeExtras, 1);
  assert.ok(evaluation.cases[0]?.failures.includes('reasoning-modes-mismatch'));
});
