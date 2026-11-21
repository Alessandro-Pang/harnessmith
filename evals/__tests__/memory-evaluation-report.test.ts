import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  readMemoryEvaluationRecords,
  recoveryActionForFailure,
  summarizeMemoryEvaluation,
} from '../../scripts/evaluation/memory/memory-report.js';

test('memory report separates behavior, verifier, and infrastructure failures', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'passed',
      transition: 'created',
    },
    {
      expectedDecision: 'no-write',
      actualDecision: 'write',
      outcome: 'failed',
      transition: 'updated',
      failureCategory: 'policy-mismatch',
      criticalForbidden: true,
    },
    {
      expectedDecision: 'write',
      actualDecision: 'no-write',
      outcome: 'inconclusive',
      transition: 'no-change',
      failureCategory: 'evidence-missing',
    },
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'failed',
      transition: 'created',
      failureCategory: 'verifier-failed',
    },
  ]);
  assert.equal(report.metrics.criticalForbiddenCount, 1);
  assert.deepEqual(report.failuresByCategory, {
    'policy-mismatch': 1,
    'evidence-missing': 1,
    'verifier-failed': 1,
  });
  assert.equal(report.gate, 'blocked');
  assert.equal(report.rerunPolicy.automaticPromptRetuning, false);
  assert.equal(report.rerunPolicy.automaticRegexRetuning, false);
  assert.equal(report.rerunPolicy.behaviorRerunRequiresNewHypothesis, true);
});

test('recovery action prevents prompt and regex changes for evaluator failures', () => {
  assert.equal(recoveryActionForFailure('policy-mismatch'), 'inspect-scenario-and-model-behavior');
  assert.equal(recoveryActionForFailure('state-mismatch'), 'inspect-writer-and-state-verifier');
  assert.equal(
    recoveryActionForFailure('verifier-failed'),
    'repair-or-reproduce-independent-verifier',
  );
  assert.equal(recoveryActionForFailure('infra-inconclusive'), 'rerun-infrastructure-only');
  assert.equal(recoveryActionForFailure('qualitative-only'), 'report-only-no-release-gate');
  assert.equal(recoveryActionForFailure('evidence-missing'), 'repair-state-capture-before-rerun');
});

test('the gate distinguishes an empty evaluation from a clean passing one', () => {
  assert.equal(summarizeMemoryEvaluation([]).gate, 'not-evaluated');
  assert.equal(
    summarizeMemoryEvaluation([
      {
        expectedDecision: 'write',
        actualDecision: 'write',
        outcome: 'passed',
        transition: 'created',
      },
    ]).gate,
    'passed',
  );
});

test('forbidden state changes remain critical even when the writer omitted typed output', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'no-write',
      actualDecision: 'no-write',
      outcome: 'failed',
      transition: 'updated',
      criticalForbidden: true,
      failureCategory: 'state-mismatch',
    },
  ]);
  assert.equal(report.metrics.criticalForbiddenCount, 1);
  assert.equal(report.gate, 'blocked');
});

test('infrastructure inconclusive trials never satisfy the release gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'no-write',
      outcome: 'infra-inconclusive',
      transition: 'no-change',
      failureCategory: 'infra-inconclusive',
    },
  ]);
  assert.equal(report.metrics.conclusiveCount, 0);
  assert.equal(report.metrics.inconclusiveCount, 1);
  assert.equal(report.gate, 'inconclusive');
});

test('evaluator-inconclusive scenarios stay out of behavior metrics and block a complete gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'passed',
      transition: 'created',
    },
    {
      expectedDecision: 'blocked',
      actualDecision: 'no-write',
      outcome: 'evaluator-inconclusive',
      transition: 'no-change',
      failureCategory: 'evaluator-inconclusive',
    },
  ]);
  assert.equal(report.metrics.conclusiveCount, 1);
  assert.equal(report.metrics.inconclusiveCount, 1);
  assert.equal(report.gate, 'inconclusive');
  assert.deepEqual(report.failuresByCategory, { 'evaluator-inconclusive': 1 });
  assert.deepEqual(report.nextActions, ['repair-evaluation-fixture-before-rerun']);
});

test('failed records without a failure category cannot pass the release gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'no-write',
      outcome: 'evaluator-failed',
      transition: 'no-change',
    },
  ]);
  assert.equal(report.gate, 'blocked');
  assert.equal(report.uncategorizedFailureCount, 1);
  assert.deepEqual(report.nextActions, ['repair-evaluation-fixture-before-rerun']);
});

test('generic failed outcome without category cannot disappear from the gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'failed',
      transition: 'created',
    },
  ]);
  assert.equal(report.gate, 'blocked');
});

test('unknown runtime outcomes cannot enter a passing report', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'unknown' as 'passed',
      transition: 'created',
    },
  ]);
  assert.notEqual(report.gate, 'passed');
});

test('passed records carrying failure evidence cannot pass the gate', () => {
  const report = summarizeMemoryEvaluation([
    {
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'passed',
      transition: 'created',
      failureCategory: 'evidence-missing',
    },
  ]);
  assert.notEqual(report.gate, 'passed');
});

test('memory evaluation records load only schema-valid nested run.json files', () => {
  const home = mkdtempSync(join(tmpdir(), 'harness-memory-report-'));
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, 'not-a-dir'), 'x');
  assert.throws(() => readMemoryEvaluationRecords(join(home, 'not-a-dir')), /not a directory/);

  const nested = join(home, 'runs', 'one');
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(nested, 'run.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      recordType: 'memory-evaluation',
      runId: 'run-1',
      scenarioId: 'explicit-profile',
      trial: 1,
      host: {
        adapter: 'codex',
        product: 'codex',
        version: '1',
        model: 'test',
        modelVersion: '1',
      },
      subject: { packageVersion: '0.9.0', packageArtifactSha256: 'a'.repeat(64) },
      startedAt: '2026-09-06T00:00:00.000Z',
      finishedAt: '2026-09-06T00:00:01.000Z',
      expectedDecision: 'write',
      actualDecision: {
        decision: 'write',
        action: 'created',
        writer: 'reconcile-profile',
        reasonCode: 'typed-create-ready',
      },
      transition: 'created',
      initialState: { digest: 'b'.repeat(64), changedPaths: [] },
      finalState: { digest: 'c'.repeat(64), changedPaths: ['profile.md'] },
      verifier: {
        command: 'harness memory check global --json',
        exitCode: 0,
        passed: true,
        artifactRef: 'local:verifier.json',
        sha256: 'd'.repeat(64),
      },
      outcome: 'passed',
      failureCategory: null,
      idempotency: { expectedUnchanged: true, actualUnchanged: true },
    })}\n`,
  );
  const loaded = readMemoryEvaluationRecords(join(home, 'runs'));
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.actualDecision, 'write');

  writeFileSync(join(nested, 'broken.json'), '{}\n');
  writeFileSync(join(home, 'runs', 'run.json'), '{"schemaVersion":2}\n');
  assert.throws(() => readMemoryEvaluationRecords(join(home, 'runs')), /Invalid memory evaluation/);
});
