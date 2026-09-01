import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { memoryMaintenance } from '../commands/memory-maintenance.js';
import { memoryMaintenanceReport } from '../lib/memory-maintenance.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-maintenance-report-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  return { root, runtime, memoryRoot: runtime.memoryHome };
}

function projectFixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-maintenance-project-report-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  return { project, runtime, memoryRoot: join(project, '.agent-docs') };
}

function memoryDocument(
  title: string,
  {
    status = 'active',
    kind = 'episode',
    documentType = 'session-handoff',
    sourceRefs = '[]',
    extra = '',
    body = '',
  }: {
    status?: string;
    kind?: string;
    documentType?: string;
    sourceRefs?: string;
    extra?: string;
    body?: string;
  } = {},
): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} memory`,
    `type: ${documentType}`,
    `memory-kind: ${kind}`,
    `status: ${status}`,
    'owners: [test-owner]',
    'created: 2026-08-19',
    'updated: 2026-08-19',
    'project: test',
    'tags: [test]',
    'scope: []',
    `source-refs: ${sourceRefs}`,
    'source-of-truth: false',
    extra,
    'schema-version: 1',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

test('maintenance emits typed candidates with reasons, evidence, actions, risks, and eligibility coverage', () => {
  const { memoryRoot } = fixture();
  writeFileSync(
    join(memoryRoot, 'duplicate-a.md'),
    memoryDocument('Duplicate', { body: 'See memory:missing-source.' }),
  );
  writeFileSync(join(memoryRoot, 'duplicate-b.md'), memoryDocument('Duplicate'));
  writeFileSync(
    join(memoryRoot, 'expired.md'),
    memoryDocument('Expired', { kind: 'working', extra: 'expires: 2000-01-01' }),
  );
  writeFileSync(
    join(memoryRoot, 'superseded.md'),
    memoryDocument('Superseded', {
      status: 'superseded',
      extra: 'superseded-by: memory:replacement',
    }),
  );
  writeFileSync(join(memoryRoot, 'replacement.md'), memoryDocument('Replacement'));
  writeFileSync(
    join(memoryRoot, 'cycle-a.md'),
    memoryDocument('Cycle A', {
      status: 'superseded',
      extra: 'superseded-by: memory:cycle-b',
    }),
  );
  writeFileSync(
    join(memoryRoot, 'cycle-b.md'),
    memoryDocument('Cycle B', {
      status: 'superseded',
      extra: 'superseded-by: memory:cycle-a',
    }),
  );
  const core = join(memoryRoot, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}${'\n'.repeat(170)}`);

  const report = memoryMaintenanceReport(memoryRoot, '2026-09-01');

  assert.equal(report.version, 2);
  assert.equal(report.mode, 'report-only');
  assert.equal(report.mutation.status, 'unchanged');
  assert.equal(report.summary.result, 'proposed');
  assert.ok(report.candidates.length > 0);
  assert.ok(
    [
      'duplicate',
      'stale',
      'contradicted',
      'expired',
      'unindexed',
      'broken-reference',
      'cycle',
      'budget',
    ].every((category) => report.candidates.some((candidate) => candidate.category === category)),
  );
  for (const candidate of report.candidates) {
    assert.ok(candidate.reasonCode);
    assert.ok(candidate.evidence.length > 0);
    assert.ok(candidate.suggestedAction);
    assert.ok(['low', 'medium', 'high'].includes(candidate.risk));
    assert.equal(candidate.eligibility.status, 'not-evaluated');
  }
  assert.deepEqual(report.eligibility, {
    status: 'not-evaluated',
    evaluated: 0,
    notEvaluated: report.candidates.length,
    total: report.candidates.length,
    coverage: 0,
    reasonCode: 'maintenance-eligibility-input-unavailable',
  });
  assert.equal(report.summary.byCategory['broken-reference'], 1);
});

test('missing evidence for a durable finding is inconclusive instead of a strong negative', () => {
  const { project, runtime, memoryRoot } = projectFixture();
  writeFileSync(
    join(memoryRoot, 'finding.md'),
    memoryDocument('Durable finding', {
      kind: 'distilled',
      documentType: 'distilled-memory',
      sourceRefs: '[docs/missing-contract.md]',
    }),
  );

  const report = memoryMaintenance(runtime, project, { json: true }, capturedIo());
  const source = report.candidates.find(
    (candidate) => candidate.reasonCode === 'source-evidence-missing',
  );

  assert.equal(source?.category, 'fact-source');
  assert.equal(source?.outcome, 'inconclusive');
  assert.equal(source?.risk, 'high');
  assert.equal(report.summary.result, 'inconclusive');
});

test('a clean root distinguishes none from unchanged mutation and not-evaluated eligibility', () => {
  const { memoryRoot } = fixture();

  const report = memoryMaintenanceReport(memoryRoot, '2026-09-01');

  assert.equal(report.summary.result, 'none');
  assert.equal(report.summary.totalCandidates, 0);
  assert.equal(report.mutation.status, 'unchanged');
  assert.equal(report.execution.status, 'succeeded');
  assert.equal(report.scan.status, 'complete');
  assert.equal(report.eligibility.status, 'not-evaluated');
});

test('maintenance reports broken references without mutating the root', () => {
  const { runtime, memoryRoot } = fixture();
  const path = join(memoryRoot, 'broken.md');
  writeFileSync(path, memoryDocument('Broken', { body: 'See memory:does-not-exist.' }));
  const before = readFileSync(path, 'utf8');
  const io = capturedIo();

  const report = memoryMaintenance(runtime, 'global', { json: true }, io);

  assert.equal(
    report.candidates.some((candidate) => candidate.category === 'broken-reference'),
    true,
  );
  assert.equal(JSON.parse(io.logs.at(-1) ?? '{}').mode, 'report-only');
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('maintenance keeps a hard core budget breach as an actionable report candidate', () => {
  const { runtime, memoryRoot } = fixture();
  const core = join(memoryRoot, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}${'\n'.repeat(250)}`);
  const io = capturedIo();

  const report = memoryMaintenance(runtime, 'global', { json: true }, io);

  assert.equal(report.coreBudget.status, 'hard-limit');
  assert.equal(
    report.candidates.some(
      (candidate) => candidate.category === 'budget' && candidate.risk === 'high',
    ),
    true,
  );
  assert.equal(report.execution.status, 'succeeded');
});

test('JSON maintenance preserves an execution failure instead of masking it', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-maintenance-failure-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  const project = join(root, 'missing-project');
  mkdirSync(project, { recursive: true });
  const io = capturedIo();

  assert.throws(() => memoryMaintenance(runtime, project, { json: true }, io), /memory/i);
  assert.deepEqual(JSON.parse(io.logs[0]), {
    version: 2,
    mode: 'report-only',
    summary: { result: 'inconclusive' },
    scan: { status: 'inconclusive', reasonCode: 'scan-failed' },
    execution: { status: 'failed', reasonCode: 'maintenance-execution-failed' },
    mutation: { status: 'unchanged', reasonCode: 'report-only' },
  });
});
