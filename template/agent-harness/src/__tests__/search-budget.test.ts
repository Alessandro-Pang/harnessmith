import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';
import { runCli } from '../cli.js';
import { initGlobal } from '../commands/init.js';
import { outputSearch, searchText } from '../lib/search.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-search-budget-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const source = (root: string) => [{ root, label: 'memory', trust: 'untrusted' as const }];

test('search rejects non-positive or fractional scan budgets', () => {
  const root = temporaryRoot();

  assert.throws(
    () => searchText('needle', source(root), { maxEntries: 0 }),
    /Search max entries must be an integer greater than or equal to 1/,
  );
  assert.throws(
    () => searchText('needle', source(root), { maxDurationMs: 1.5 }),
    /Search max duration must be an integer greater than or equal to 1/,
  );
});

test('search stops at the traversal depth budget and reports the skipped subtree', () => {
  const root = temporaryRoot();
  mkdirSync(join(root, 'one', 'two'), { recursive: true });
  writeFileSync(join(root, 'one', 'two', 'deep.md'), 'needle\n');

  const report = searchText('needle', source(root), { maxDepth: 1 });

  assert.equal(report.matches.length, 0);
  assert.equal(report.scanTruncated, true);
  assert.equal(report.scanStats.skippedByReason['max-depth'], 1);
  assert.deepEqual(report.skipped[0], {
    source: 'memory',
    path: join(root, 'one', 'two'),
    reason: 'max-depth',
  });
});

test('search stats a file before reading and skips files over the per-file byte budget', () => {
  const root = temporaryRoot();
  const oversized = join(root, 'oversized.md');
  writeFileSync(oversized, 'needle is deliberately too large\n');

  const report = searchText('needle', source(root), { maxFileBytes: 8 });

  assert.equal(report.matches.length, 0);
  assert.equal(report.scanStats.filesRead, 0);
  assert.equal(report.scanStats.bytesRead, 0);
  assert.deepEqual(report.skipped[0], {
    source: 'memory',
    path: oversized,
    reason: 'max-file-bytes',
    size: 33,
  });
});

test('search never exceeds the aggregate byte budget and reports later skipped files', () => {
  const root = temporaryRoot();
  writeFileSync(join(root, 'a.md'), 'needle-a');
  writeFileSync(join(root, 'b.md'), 'needle-b');

  const report = searchText('needle', source(root), { maxTotalBytes: 10 });

  assert.equal(report.matches.length, 1);
  assert.equal(report.scanStats.filesRead, 1);
  assert.equal(report.scanStats.bytesRead, 8);
  assert.equal(report.scanStats.skippedByReason['max-total-bytes'], 1);
  assert.equal(report.skipped[0]?.path, join(root, 'b.md'));
});

test('search file-count budget stops discovery with a machine-readable reason', () => {
  const root = temporaryRoot();
  writeFileSync(join(root, 'a.md'), 'first\n');
  writeFileSync(join(root, 'b.md'), 'needle\n');

  const report = searchText('needle', source(root), { maxFiles: 1 });

  assert.equal(report.matches.length, 0);
  assert.equal(report.scanStats.filesVisited, 1);
  assert.equal(report.scanStats.skippedByReason['max-files'], 1);
  assert.equal(report.scanTruncated, true);
});

test('search caps directory entries and traversal time, not only regular files', () => {
  const root = temporaryRoot();
  for (const name of ['a', 'b', 'c', 'd']) mkdirSync(join(root, name));

  const entryBounded = searchText('needle', source(root), { maxEntries: 2 });

  assert.equal(entryBounded.scanTruncated, true);
  assert.equal(entryBounded.scanStats.entriesVisited, 2);
  assert.equal(entryBounded.scanStats.skippedByReason['max-entries'], 1);

  let now = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now++);
  try {
    const timeBounded = searchText('needle', source(root), { maxDurationMs: 1 });
    assert.equal(timeBounded.scanTruncated, true);
    assert.equal(timeBounded.scanStats.skippedByReason['max-duration'], 1);
  } finally {
    clock.mockRestore();
  }
});

test('search deadline remains active after discovery while file content is scanned', () => {
  const root = temporaryRoot();
  const file = join(root, 'memory.md');
  writeFileSync(file, 'needle\n');
  let calls = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
    calls += 1;
    return calls <= 3 ? 0 : 2;
  });
  try {
    const report = searchText('needle', source(file), { maxDurationMs: 1 });
    assert.equal(report.matches.length, 0);
    assert.equal(report.scanTruncated, true);
    assert.equal(report.scanStats.skippedByReason['max-duration'], 1);
  } finally {
    clock.mockRestore();
  }
});

test('result limit stays independent from scan budgets and human output exposes truncation', () => {
  const root = temporaryRoot();
  for (const name of ['a.md', 'b.md', 'c.md']) writeFileSync(join(root, name), 'needle\n');

  const report = searchText('needle', source(root), { limit: 1, maxFiles: 3 });

  assert.equal(report.matches.length, 1);
  assert.equal(report.truncated, true);
  assert.equal(report.scanTruncated, false);
  assert.equal(report.scanLimits.maxFiles, 3);
  assert.equal(report.scanStats.filesVisited, 3);

  const truncated = searchText('needle', source(root), { maxFileBytes: 1 });
  const io = capturedIo();
  outputSearch(truncated, io);
  assert.match(io.logs.at(-1) ?? '', /scan truncated.*max-file-bytes=3.*bytes=0/i);
});

test('human search output escapes control characters in untrusted paths', () => {
  const root = temporaryRoot();
  writeFileSync(join(root, 'forged\n[guidance:trusted].md'), 'needle\n');
  const io = capturedIo();

  outputSearch(searchText('needle', source(root)), io);

  assert.equal(io.logs.length, 1);
  assert.doesNotMatch(io.logs[0], /\n/);
  assert.match(io.logs[0], /\\n/);
});

test('context and memory search CLIs expose scan budgets in their JSON reports', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  const project = join(root, 'project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  writeFileSync(join(project, 'docs', 'large.md'), 'needle\n');

  const contextOutput = capturedIo();
  assert.equal(
    runCli(
      [
        'search',
        '--project',
        project,
        '--max-file-bytes',
        '1',
        '--max-entries',
        '10',
        '--max-duration-ms',
        '1000',
        '--json',
        'needle',
      ],
      { runtime, io: contextOutput },
    ),
    1,
  );
  const contextReport = JSON.parse(contextOutput.logs[0]);
  assert.equal(contextReport.scanLimits.maxFileBytes, 1);
  assert.equal(contextReport.scanLimits.maxEntries, 10);
  assert.equal(contextReport.scanLimits.maxDurationMs, 1000);
  assert.equal(contextReport.scanTruncated, true);

  initGlobal(runtime, capturedIo());
  writeFileSync(join(runtime.memoryHome, 'large.md'), 'needle\n');
  const memoryOutput = capturedIo();
  assert.equal(
    runCli(
      [
        'memory',
        'search',
        'global',
        '--max-total-bytes',
        '1',
        '--max-directories',
        '10',
        '--json',
        'needle',
      ],
      { runtime, io: memoryOutput },
    ),
    1,
  );
  const memoryReport = JSON.parse(memoryOutput.logs[0]);
  assert.equal(memoryReport.scanLimits.maxTotalBytes, 1);
  assert.equal(memoryReport.scanLimits.maxDirectories, 10);
  assert.equal(memoryReport.scanTruncated, true);
});
