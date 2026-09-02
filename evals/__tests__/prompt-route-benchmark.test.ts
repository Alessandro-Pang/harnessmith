import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  comparePromptRouteBenchmarks,
  repositoryRoot,
  runPromptRouteBenchmark,
} from '../../scripts/benchmarks/prompt-route/prompt-route-benchmark-lib.js';

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
