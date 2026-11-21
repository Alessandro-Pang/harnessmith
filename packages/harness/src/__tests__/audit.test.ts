import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { buildAuditIndex } from '../lib/audit/audit-accounting.js';
import { createHealthReport } from '../lib/health/health.js';
import { capturedIo, elementAt, harnessRuntime } from './helpers/harness.js';

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

function storedEvent(overrides: Record<string, unknown> = {}) {
  return { ...event(), schemaVersion: 1, adapter: 'test', ...overrides };
}

function omit(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _removed, ...rest } = value;
  return rest;
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
  const result = JSON.parse(elementAt(io.logs, 0));
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

test('audit record appends to an existing daily file without replacing it', () => {
  const { root, runtime } = fixture();
  const first = payload(root, 'first-event.json', event());
  const second = payload(root, 'second-event.json', event({ traceId: 'trace-20260828-002' }));

  runCli(['audit', 'record', '--payload-file', first], { runtime, io: capturedIo() });
  const auditPath = join(runtime.stateRoot, 'audit', '2026-08-28.jsonl');
  const inode = statSync(auditPath).ino;
  runCli(['audit', 'record', '--payload-file', second], { runtime, io: capturedIo() });

  assert.equal(statSync(auditPath).ino, inode);
  assert.equal(readFileSync(auditPath, 'utf8').trim().split('\n').length, 2);
});

test('audit record maintains an atomic accounting index instead of rescanning history', () => {
  const { root, runtime } = fixture();
  const first = payload(root, 'first-event.json', event());
  const second = payload(root, 'second-event.json', event({ traceId: 'trace-20260828-002' }));

  runCli(['audit', 'record', '--payload-file', first], { runtime, io: capturedIo() });
  runCli(['audit', 'record', '--payload-file', second], { runtime, io: capturedIo() });

  const index = JSON.parse(
    readFileSync(join(runtime.stateRoot, 'audit', '.index.json'), 'utf8'),
  ) as { version: number; eventCount: number; totalBytes: number; files: Record<string, unknown> };
  assert.equal(index.version, 1);
  assert.equal(index.eventCount, 2);
  assert.equal(Object.keys(index.files).length, 1);
  assert.equal(
    index.totalBytes,
    statSync(join(runtime.stateRoot, 'audit', '2026-08-28.jsonl')).size,
  );
});

test('audit record rebuilds stale accounting metadata before appending', () => {
  const { root, runtime } = fixture();
  const first = payload(root, 'first-event.json', event());
  const second = payload(root, 'second-event.json', event({ traceId: 'trace-20260828-002' }));

  runCli(['audit', 'record', '--payload-file', first], { runtime, io: capturedIo() });
  const indexPath = join(runtime.stateRoot, 'audit', '.index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(indexPath, JSON.stringify({ ...index, eventCount: 0 }));

  runCli(['audit', 'record', '--payload-file', second], { runtime, io: capturedIo() });

  const repaired = JSON.parse(readFileSync(indexPath, 'utf8')) as { eventCount: number };
  assert.equal(repaired.eventCount, 2);
});

test('audit record rebuilds malformed accounting metadata before appending', () => {
  const { root, runtime } = fixture();
  const first = payload(root, 'first-event.json', event());
  const second = payload(root, 'second-event.json', event({ traceId: 'trace-20260828-002' }));

  runCli(['audit', 'record', '--payload-file', first], { runtime, io: capturedIo() });
  writeFileSync(join(runtime.stateRoot, 'audit', '.index.json'), '{');
  runCli(['audit', 'record', '--payload-file', second], { runtime, io: capturedIo() });

  const repaired = JSON.parse(
    readFileSync(join(runtime.stateRoot, 'audit', '.index.json'), 'utf8'),
  ) as { eventCount: number };
  assert.equal(repaired.eventCount, 2);
});

test('audit append recovers only a verifiable prefix after a torn final record', () => {
  const { root, runtime } = fixture();
  const auditRoot = join(runtime.stateRoot, 'audit');
  mkdirSync(auditRoot, { recursive: true });
  const auditPath = join(auditRoot, '2026-08-28.jsonl');
  writeFileSync(auditPath, `${JSON.stringify(storedEvent())}\n{"traceId":"torn`);
  const second = payload(root, 'second-event.json', event({ traceId: 'trace-20260828-002' }));

  runCli(['audit', 'record', '--payload-file', second], { runtime, io: capturedIo() });

  const records = readFileSync(auditPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  assert.equal(elementAt(records, 0).traceId, 'trace-20260828-001');
  assert.equal(elementAt(records, 1).traceId, 'trace-20260828-002');
});

test('audit append fails closed when no complete record survives a torn file', () => {
  const { root, runtime } = fixture();
  const auditRoot = join(runtime.stateRoot, 'audit');
  mkdirSync(auditRoot, { recursive: true });
  writeFileSync(join(auditRoot, '2026-08-28.jsonl'), '{"traceId":"torn');
  const second = payload(root, 'second-event.json', event({ traceId: 'trace-20260828-002' }));

  assert.throws(
    () => runCli(['audit', 'record', '--payload-file', second], { runtime, io: capturedIo() }),
    /contains no complete record/i,
  );
});

test('audit index rebuild fails closed on an unterminated record', () => {
  const { runtime } = fixture();
  const auditRoot = join(runtime.stateRoot, 'audit');
  mkdirSync(auditRoot, { recursive: true });
  const auditPath = join(auditRoot, '2026-08-28.jsonl');
  writeFileSync(auditPath, '{"traceId":"torn');

  assert.throws(
    () =>
      buildAuditIndex(
        runtime,
        () => [auditPath],
        () => ({}),
      ),
    /incomplete final record/i,
  );
});

test('audit readers fail closed when the final record is not newline-delimited', () => {
  const { runtime } = fixture();
  const auditRoot = join(runtime.stateRoot, 'audit');
  mkdirSync(auditRoot, { recursive: true });
  writeFileSync(
    join(auditRoot, '2026-08-28.jsonl'),
    `${JSON.stringify(storedEvent())}\n{"traceId":"torn`,
  );

  const report = createHealthReport(runtime);
  const audit = report.checks.find(({ id }) => id === 'audit');
  assert.equal(audit?.status, 'failed');
  assert.match(audit?.message ?? '', /incomplete final record/i);
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
  assert.equal(existsSync(join(runtime.stateRoot, 'audit')), false);
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
  assert.equal(JSON.parse(elementAt(listed.logs, 0)).events.length, 2);

  const summarized = capturedIo();
  assert.equal(runCli(['audit', 'summary', '--json'], { runtime, io: summarized }), 0);
  assert.deepEqual(JSON.parse(elementAt(summarized.logs, 0)), {
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
  const state = runtime.stateRoot;
  mkdirSync(runtime.harnessHome, { recursive: true });
  writeFileSync(join(root, 'sentinel'), 'unchanged\n');
  symlinkSync(outside, state, 'dir');
  const input = payload(root, 'event.json', event());

  assert.throws(
    () => runCli(['audit', 'record', '--payload-file', input], { runtime, io: capturedIo() }),
    /symbolic link|safe path/i,
  );
  assert.equal(existsSync(outside), false);
  assert.equal(dirname(state), runtime.harnessHome);
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
  const root = join(runtime.stateRoot, 'audit');
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
  const root = join(runtime.stateRoot, 'audit');
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, '2026-08-28.jsonl'),
    `${JSON.stringify({ ...event(), schemaVersion: 1, adapter: 'test', prompt: 'raw content' })}\n`,
  );

  const audit = createHealthReport(runtime).checks.find(({ id }) => id === 'audit');
  assert.equal(audit?.status, 'failed');
  assert.match(audit?.message ?? '', /unknown key: prompt/i);
});

test('health rejects stored audit events whose required fields are missing or mistyped', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['omits traceId', omit(storedEvent(), 'traceId'), /missing key: traceId/i],
    ['omits durationMs', omit(storedEvent(), 'durationMs'), /missing key: durationMs/i],
    ['omits policyVersion', omit(storedEvent(), 'policyVersion'), /missing key: policyVersion/i],
    ['nullifies traceId', storedEvent({ traceId: null }), /traceId is invalid/i],
    ['numbers the action', storedEvent({ action: 42 }), /action is invalid/i],
    ['nullifies the adapter', storedEvent({ adapter: null }), /adapter is invalid/i],
    ['nullifies durationMs', storedEvent({ durationMs: null }), /durationMs is invalid/i],
  ];

  for (const [label, stored, expected] of cases) {
    const { runtime } = fixture();
    const root = join(runtime.stateRoot, 'audit');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '2026-08-28.jsonl'), `${JSON.stringify(stored)}\n`);

    const audit = createHealthReport(runtime).checks.find(({ id }) => id === 'audit');
    assert.equal(audit?.status, 'failed', label);
    assert.match(audit?.message ?? '', expected, label);
  }
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
  const report = JSON.parse(elementAt(maintenance.logs, 0));
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
  assert.equal(JSON.parse(elementAt(proposal.logs, 0)).action, 'proposed');
  assert.equal(existsSync(join(runtime.stateRoot, 'audit', '2026-01-01.jsonl')), true);

  const applied = capturedIo();
  assert.equal(
    runCli(['audit', 'archive', '--before', '2026-02-01', '--apply', '--json'], {
      runtime,
      io: applied,
    }),
    0,
  );
  assert.deepEqual(JSON.parse(elementAt(applied.logs, 0)).archivedFiles, ['2026-01-01.jsonl']);
  assert.equal(existsSync(join(runtime.stateRoot, 'audit', '2026-01-01.jsonl')), false);
  assert.equal(existsSync(join(runtime.stateRoot, 'audit', 'archive', '2026-01-01.jsonl')), true);
  const summary = capturedIo();
  runCli(['audit', 'summary', '--json'], { runtime, io: summary });
  assert.equal(JSON.parse(elementAt(summary.logs, 0)).eventCount, 0);
});

test('audit archive refuses a non-directory archive root and existing destinations', () => {
  const { root, runtime } = fixture();
  runCli(
    [
      'audit',
      'record',
      '--payload-file',
      payload(root, 'old.json', event({ timestamp: '2026-01-01T00:00:00.000Z' })),
    ],
    { runtime, io: capturedIo() },
  );
  const archiveRoot = join(runtime.stateRoot, 'audit', 'archive');
  writeFileSync(archiveRoot, '');
  assert.throws(
    () =>
      runCli(['audit', 'archive', '--before', '2026-02-01', '--apply', '--json'], {
        runtime,
        io: capturedIo(),
      }),
    /regular non-symlink directory/,
  );

  rmSync(archiveRoot);
  mkdirSync(archiveRoot, { recursive: true });
  writeFileSync(join(archiveRoot, '2026-01-01.jsonl'), '');
  assert.throws(
    () =>
      runCli(['audit', 'archive', '--before', '2026-02-01', '--apply', '--json'], {
        runtime,
        io: capturedIo(),
      }),
    /Audit archive destination exists/,
  );
  assert.equal(existsSync(join(runtime.stateRoot, 'audit', '2026-01-01.jsonl')), true);
});
