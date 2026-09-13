import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyMemoryFixtureSeeds,
  projectMemoryFixtures,
} from '../../scripts/evaluation/memory/memory-fixture-seed.js';
import {
  calculateMemoryMetrics,
  type MemoryMetricRecord,
} from '../../scripts/evaluation/memory/memory-metrics.js';
import {
  readMemoryEvaluationRecords,
  recoveryActionForFailure,
  summarizeMemoryEvaluation,
} from '../../scripts/evaluation/memory/memory-report.js';
import { verifyMemoryState } from '../../scripts/evaluation/memory/memory-state-verifier.js';

const files = (value: Record<string, string>) => ({ files: value });

export function coverMemoryState(): void {
  const input = {
    before: files({}),
    after: files({}),
    expectedDecision: 'no-write' as const,
    actual: { action: 'no-change' as const },
  };
  assert.equal(verifyMemoryState(input).outcome, 'passed');
  assert.equal(
    verifyMemoryState({
      ...input,
      expectedDecision: 'write',
      actual: { action: 'created', reasonCode: 'typed-create-ready' },
      after: files({ 'profile.md': 'digest-1' }),
    }).transition,
    'created',
  );
  assert.equal(
    verifyMemoryState({
      ...input,
      expectedDecision: 'write',
      expectedAction: 'created',
      actual: { action: 'updated' },
      after: files({ 'profile.md': 'digest-1' }),
    }).failureCategory,
    'policy-mismatch',
  );
  assert.equal(
    verifyMemoryState({
      ...input,
      before: files({ 'profile.md': 'digest-1' }),
      after: files({ 'profile.md': 'digest-2' }),
      actual: { action: 'updated', reasonCode: 'typed-update' },
    }).failureCategory,
    'policy-mismatch',
  );
  assert.equal(
    verifyMemoryState({ ...input, expectedDecision: 'blocked', actual: { action: 'blocked' } })
      .transition,
    'blocked',
  );
  assert.equal(
    verifyMemoryState({ ...input, evidence: { complete: false } }).failureCategory,
    'evidence-missing',
  );
  assert.equal(
    verifyMemoryState({ ...input, qualitativeOnly: true }).failureCategory,
    'qualitative-only',
  );
  assert.equal(
    verifyMemoryState({ ...input, infrastructureInconclusive: true }).failureCategory,
    'infra-inconclusive',
  );
  assert.equal(
    verifyMemoryState({
      ...input,
      verifier: { status: 'inconclusive', message: 'timeout' },
    }).failureCategory,
    'infra-inconclusive',
  );
  assert.equal(
    verifyMemoryState({ ...input, verifier: { status: 'failed', message: 'boom' } })
      .failureCategory,
    'verifier-failed',
  );
  assert.equal(
    verifyMemoryState({
      ...input,
      semantic: { status: 'inconclusive', message: 'unclear' },
    }).failureCategory,
    'evaluator-inconclusive',
  );
  assert.equal(
    verifyMemoryState({ ...input, semantic: { status: 'failed', message: 'wrong' } })
      .failureCategory,
    'state-mismatch',
  );
  assert.equal(
    verifyMemoryState({
      ...input,
      expectedDecision: 'write',
      actual: { action: 'created' },
      before: files({ 'profile.md': 'digest-1' }),
      after: files({ 'profile.md': 'digest-1' }),
    }).failureCategory,
    'state-mismatch',
  );
  assert.equal(
    verifyMemoryState({
      ...input,
      expectedDecision: 'proposed',
      actual: { action: 'proposed' },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryState({
      ...input,
      expectedDecision: 'no-write',
      actual: { action: 'unchanged' },
      before: files({ 'profile.md': 'a' }),
      after: files({ 'profile.md': 'a' }),
    }).transition,
    'unchanged',
  );
}

export function coverMemoryFixtures(): void {
  const home = mkdtempSync(join(tmpdir(), 'harness-scripts-c8-'));
  try {
    const repo = join(home, 'repo');
    const tempDir = join(home, 'tmp');
    mkdirSync(repo);
    mkdirSync(join(repo, '.agent-docs'), { recursive: true });
    writeFileSync(join(repo, '.agent-docs', 'README.md'), 'seed\n');
    const run = () => ({ stdout: '{"reference":"memory:inputs/eval.md"}' });
    applyMemoryFixtureSeeds({
      globalMemory: 'empty',
      projectMemory: 'empty',
      context: { repo, tempDir },
      run,
    });
    applyMemoryFixtureSeeds({
      globalMemory: 'seeded',
      projectMemory: 'experience-ready',
      context: { repo, tempDir },
      run,
    });
    for (const name of projectMemoryFixtures) {
      applyMemoryFixtureSeeds({
        globalMemory: 'empty',
        projectMemory: name,
        context: { repo, tempDir },
        run,
      });
    }
    assert.throws(
      () =>
        applyMemoryFixtureSeeds({
          globalMemory: 'missing',
          projectMemory: 'empty',
          context: { repo, tempDir },
          run,
        }),
      /Unknown global memory fixture/,
    );
    assert.throws(
      () =>
        applyMemoryFixtureSeeds({
          globalMemory: 'empty',
          projectMemory: 'no-such-fixture',
          context: { repo, tempDir },
          run,
        }),
      /Unknown project memory fixture/,
    );
    assert.throws(
      () =>
        applyMemoryFixtureSeeds({
          globalMemory: 'empty',
          projectMemory: 'closable-input',
          context: { repo, tempDir },
          run: () => ({ stdout: '{"ok":true}' }),
        }),
      /Seed step did not return a memory reference/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function coverMemoryReport(): void {
  const record = (overrides: Partial<MemoryMetricRecord>): MemoryMetricRecord => ({
    expectedDecision: 'write',
    actualDecision: 'write',
    outcome: 'passed',
    transition: 'created',
    ...overrides,
  });
  const metrics = calculateMemoryMetrics([
    record({}),
    record({
      expectedDecision: 'write',
      actualDecision: 'no-write',
      outcome: 'failed',
      transition: 'no-change',
    }),
    record({ expectedDecision: 'no-write', actualDecision: 'no-write', transition: 'no-change' }),
    record({
      expectedDecision: 'no-write',
      actualDecision: 'write',
      outcome: 'failed',
      transition: 'updated',
      criticalForbidden: true,
    }),
    record({
      expectedDecision: 'write',
      actualDecision: 'write',
      outcome: 'inconclusive',
      transition: 'blocked',
    }),
    record({
      idempotency: { expectedUnchanged: true, actualUnchanged: true },
      transition: 'unchanged',
    }),
    record({
      idempotency: { expectedUnchanged: true, actualUnchanged: false },
      transition: 'updated',
      outcome: 'failed',
      failureCategory: 'state-mismatch',
    }),
    record({ expectedDecision: 'proposed', actualDecision: 'proposed', transition: 'no-change' }),
    record({ outcome: 'evaluator-inconclusive' }),
    record({ outcome: 'infra-inconclusive' }),
  ]);
  assert.equal(metrics.criticalForbiddenCount, 1);
  assert.equal(calculateMemoryMetrics([record({ outcome: 'inconclusive' })]).write.precision, null);
  assert.equal(summarizeMemoryEvaluation([]).gate, 'not-evaluated');
  assert.equal(summarizeMemoryEvaluation([record({})]).gate, 'passed');
  assert.equal(
    summarizeMemoryEvaluation([record({ outcome: 'failed', failureCategory: 'policy-mismatch' })])
      .gate,
    'blocked',
  );
  assert.equal(summarizeMemoryEvaluation([record({ outcome: 'failed' })]).gate, 'blocked');
  assert.equal(
    summarizeMemoryEvaluation([record({ outcome: 'passed', failureCategory: 'state-mismatch' })])
      .gate,
    'blocked',
  );
  assert.equal(
    summarizeMemoryEvaluation([record({ outcome: 'inconclusive' })]).gate,
    'inconclusive',
  );
  assert.equal(recoveryActionForFailure('evidence-missing'), 'repair-state-capture-before-rerun');

  const home = mkdtempSync(join(tmpdir(), 'harness-memory-report-'));
  try {
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
    assert.throws(
      () => readMemoryEvaluationRecords(join(home, 'runs')),
      /Invalid memory evaluation/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
