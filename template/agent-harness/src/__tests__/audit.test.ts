import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { createHealthReport } from '../lib/health/health.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-audit-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return { root, runtime: harnessRuntime(root) };
}

function payload(root: string, name: string, value: Record<string, unknown>): string {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    traceId: 'trace-20260828-001',
    timestamp: '2026-08-28T05:00:00.000Z',
    operation: 'tool',
    action: 'filesystem.read',
    policyDecision: 'allowed',
    policyVersion: 'host-policy-v1',
    durationMs: 125,
    outcome: 'completed',
    artifactDigests: [`sha256:${'a'.repeat(64)}`],
    inputTokens: 120,
    outputTokens: 30,
    costUsd: 0.0042,
    ...overrides,
  };
}

test('audit record stores a bounded privacy-safe event without prompts or tool arguments', () => {
  const { root, runtime } = fixture();
  const input = payload(root, 'event.json', event());
  const io = capturedIo();

  assert.equal(runCli(['audit', 'record', '--payload-file', input, '--json'], { runtime, io }), 0);
  const result = JSON.parse(io.logs[0]);
  const records = readFileSync(result.path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(records, [
    {
      schemaVersion: 1,
      traceId: 'trace-20260828-001',
      timestamp: '2026-08-28T05:00:00.000Z',
      adapter: 'test',
      operation: 'tool',
      action: 'filesystem.read',
      policyDecision: 'allowed',
      policyVersion: 'host-policy-v1',
      durationMs: 125,
      outcome: 'completed',
      artifactDigests: [`sha256:${'a'.repeat(64)}`],
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.0042,
    },
  ]);
  assert.equal(readFileSync(input, 'utf8').includes('prompt'), false);
});

test('audit record rejects raw content fields and preserves the rejected payload', () => {
  const { root, runtime } = fixture();
  const input = payload(root, 'unsafe-event.json', {
    ...event(),
    prompt: 'secret user content',
  });

  assert.throws(
    () =>
      runCli(['audit', 'record', '--payload-file', input, '--consume-payload-file'], {
        runtime,
        io: capturedIo(),
      }),
    /unknown key: prompt/i,
  );
  assert.equal(existsSync(input), true);
  assert.equal(existsSync(join(runtime.installedHarness, 'state', 'audit')), false);
});

test('audit list filters by trace and summary aggregates outcomes, policy, cost, tokens, and latency', () => {
  const { root, runtime } = fixture();
  for (const [index, value] of [
    event(),
    event({
      traceId: 'trace-20260828-001',
      operation: 'policy',
      action: 'tool.permission',
      policyDecision: 'denied',
      durationMs: 25,
      outcome: 'blocked',
      artifactDigests: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }),
    event({
      traceId: 'trace-20260828-002',
      operation: 'lifecycle',
      action: 'session.handoff',
      policyDecision: 'not-applicable',
      durationMs: 50,
      outcome: 'failed',
      artifactDigests: [`sha256:${'b'.repeat(64)}`],
      errorCode: 'HANDOFF_REJECTED',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    }),
  ].entries()) {
    assert.equal(
      runCli(['audit', 'record', '--payload-file', payload(root, `event-${index}.json`, value)], {
        runtime,
        io: capturedIo(),
      }),
      0,
    );
  }

  const listed = capturedIo();
  assert.equal(
    runCli(['audit', 'list', '--trace-id', 'trace-20260828-001', '--json'], {
      runtime,
      io: listed,
    }),
    0,
  );
  assert.equal(JSON.parse(listed.logs[0]).events.length, 2);

  const summarized = capturedIo();
  assert.equal(runCli(['audit', 'summary', '--json'], { runtime, io: summarized }), 0);
  assert.deepEqual(JSON.parse(summarized.logs[0]), {
    version: 1,
    eventCount: 3,
    traceCount: 2,
    firstTimestamp: '2026-08-28T05:00:00.000Z',
    lastTimestamp: '2026-08-28T05:00:00.000Z',
    outcomes: { completed: 1, blocked: 1, failed: 1 },
    policyDecisions: { allowed: 1, denied: 1, 'not-applicable': 1 },
    operations: { lifecycle: 1, policy: 1, tool: 1 },
    durationMs: { total: 200, average: 66.667, maximum: 125, p95: 125 },
    tokens: { input: 130, output: 35 },
    costUsd: 0.0052,
  });
});

test('audit queries reject unbounded or non-canonical filters', () => {
  const { runtime } = fixture();
  assert.throws(
    () => runCli(['audit', 'list', '--trace-id', 'invalid trace'], { runtime, io: capturedIo() }),
    /traceId is invalid/i,
  );
  assert.throws(
    () => runCli(['audit', 'list', '--limit', '501'], { runtime, io: capturedIo() }),
    /limit must be an integer between 1 and 500/i,
  );
  assert.throws(
    () => runCli(['audit', 'summary', '--since', '2026-08-28'], { runtime, io: capturedIo() }),
    /canonical ISO-8601 UTC/i,
  );
});

test('audit storage rejects a symlinked state boundary', () => {
  const { root, runtime } = fixture();
  const outside = join(root, 'outside');
  const state = join(runtime.installedHarness, 'state');
  mkdirSync(runtime.installedHarness, { recursive: true });
  writeFileSync(join(root, 'sentinel'), 'unchanged\n');
  symlinkSync(outside, state, 'dir');
  const input = payload(root, 'event.json', event());

  assert.throws(
    () => runCli(['audit', 'record', '--payload-file', input], { runtime, io: capturedIo() }),
    /symbolic link|safe path/i,
  );
  assert.equal(existsSync(outside), false);
  assert.equal(dirname(state), runtime.installedHarness);
});

test('health treats absent audit state as inactive and reports valid audit state', () => {
  const { root, runtime } = fixture();
  const inactive = createHealthReport(runtime).checks.find(({ id }) => id === 'audit');
  assert.equal(inactive?.status, 'passed');
  assert.match(inactive?.message ?? '', /not configured/i);

  runCli(['audit', 'record', '--payload-file', payload(root, 'event.json', event())], {
    runtime,
    io: capturedIo(),
  });
  const active = createHealthReport(runtime).checks.find(({ id }) => id === 'audit');
  assert.equal(active?.status, 'passed');
  assert.match(active?.message ?? '', /1 event/i);
});

test('health fails closed when audit state is corrupt', () => {
  const { runtime } = fixture();
  const root = join(runtime.installedHarness, 'state', 'audit');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '2026-08-28.jsonl'), '{not-json}\n');

  const report = createHealthReport(runtime);
  const audit = report.checks.find(({ id }) => id === 'audit');
  assert.equal(audit?.status, 'failed');
  assert.match(audit?.message ?? '', /invalid audit event/i);
  assert.equal(report.healthy, false);
});

test('health rejects tampered audit events that add raw content', () => {
  const { runtime } = fixture();
  const root = join(runtime.installedHarness, 'state', 'audit');
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, '2026-08-28.jsonl'),
    `${JSON.stringify({ ...event(), schemaVersion: 1, adapter: 'test', prompt: 'raw content' })}\n`,
  );

  const audit = createHealthReport(runtime).checks.find(({ id }) => id === 'audit');
  assert.equal(audit?.status, 'failed');
  assert.match(audit?.message ?? '', /unknown key: prompt/i);
});

test('audit maintenance reports retention candidates and archive is proposal-first', () => {
  const { root, runtime } = fixture();
  const oldEvent = event({ timestamp: '2026-01-01T00:00:00.000Z' });
  runCli(['audit', 'record', '--payload-file', payload(root, 'old.json', oldEvent)], {
    runtime,
    io: capturedIo(),
  });

  const maintenance = capturedIo();
  assert.equal(
    runCli(['audit', 'maintain', '--max-age-days', '30', '--json'], {
      runtime,
      io: maintenance,
    }),
    1,
  );
  const report = JSON.parse(maintenance.logs[0]);
  assert.equal(report.version, 1);
  assert.deepEqual(report.staleFiles, ['2026-01-01.jsonl']);
  assert.equal(report.withinBudget, true);

  const proposal = capturedIo();
  assert.equal(
    runCli(['audit', 'archive', '--before', '2026-02-01', '--json'], {
      runtime,
      io: proposal,
    }),
    0,
  );
  assert.equal(JSON.parse(proposal.logs[0]).action, 'proposed');
  assert.equal(
    existsSync(join(runtime.installedHarness, 'state', 'audit', '2026-01-01.jsonl')),
    true,
  );

  const applied = capturedIo();
  assert.equal(
    runCli(['audit', 'archive', '--before', '2026-02-01', '--apply', '--json'], {
      runtime,
      io: applied,
    }),
    0,
  );
  assert.deepEqual(JSON.parse(applied.logs[0]).archivedFiles, ['2026-01-01.jsonl']);
  assert.equal(
    existsSync(join(runtime.installedHarness, 'state', 'audit', '2026-01-01.jsonl')),
    false,
  );
  assert.equal(
    existsSync(join(runtime.installedHarness, 'state', 'audit', 'archive', '2026-01-01.jsonl')),
    true,
  );
  const summary = capturedIo();
  runCli(['audit', 'summary', '--json'], { runtime, io: summary });
  assert.equal(JSON.parse(summary.logs[0]).eventCount, 0);
});
