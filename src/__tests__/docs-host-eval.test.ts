import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('Host Eval docs expose bounded execution and failure classes', () => {
  const documents = [read('docs/concepts/evidence-and-evaluation.md'), read('evals/README.md')];
  for (const content of documents) {
    for (const expected of [
      /behavior-failed/,
      /infra-inconclusive/,
      /evaluator-failed/,
      /15 分钟|15-minute/,
      /60 分钟|60-minute/,
      /重试一次|retry once/,
    ])
      assert.match(content, expected);
  }
  const capabilities = read('docs/capability-evidence.yaml');
  assert.match(capabilities, /id: bounded-host-eval-record-contract/);
  assert.match(capabilities, /evals\/run\.schema\.json/);
  assert.match(capabilities, /evals\/__tests__\/run-gate\.test\.ts/);
});

test('Host Eval docs expose dependency-scoped incremental selection', () => {
  const documents = [read('docs/concepts/evidence-and-evaluation.md'), read('evals/README.md')];
  for (const content of documents) {
    assert.match(content, /dependencySha256/);
    assert.match(content, /L1.*L2.*L3/s);
    assert.match(content, /unmapped-behavior-source/);
  }
  const capabilities = read('docs/capability-evidence.yaml');
  assert.match(capabilities, /id: incremental-host-eval-selection/);
  assert.match(capabilities, /scripts\/evaluation\/planning\/eval-planning\.ts/);
  assert.match(capabilities, /evals\/__tests__\/eval-planning\.test\.ts/);
});

test('Host Eval docs expose bounded parallel runner and circuit breaker', () => {
  const evaluation = read('docs/concepts/evidence-and-evaluation.md');
  const evalReadme = read('evals/README.md');
  const capabilities = read('docs/capability-evidence.yaml');

  for (const content of [evaluation, evalReadme]) {
    assert.match(content, /2.*3.*并行|2.*3.*parallel/is);
    assert.match(content, /circuit[- ]breaker/i);
    assert.match(content, /infra-blocked/);
  }
  assert.match(capabilities, /id: bounded-host-eval-runner/);
  assert.match(capabilities, /scripts\/evaluation\/planning\/eval-runner\.ts/);
  assert.match(capabilities, /evals\/__tests__\/eval-runner\.test\.ts/);
});

test('Host Eval docs expose release evidence state without counting infrastructure blocks', () => {
  const evaluation = read('docs/concepts/evidence-and-evaluation.md');
  const evalReadme = read('evals/README.md');
  const capabilities = read('docs/capability-evidence.yaml');

  for (const content of [evaluation, evalReadme]) {
    assert.match(content, /exact.*inherited.*infra-blocked/is);
    assert.match(content, /release state.*attestation/is);
    assert.match(content, /infra-blocked.*(?:不计入|never counts).*coverage/is);
  }
  assert.match(capabilities, /id: release-host-eval-evidence-state/);
  assert.match(capabilities, /scripts\/release\/release-evaluation-evidence\.ts/);
  assert.match(capabilities, /evals\/__tests__\/release-risk-integrity\.test\.ts/);
});
