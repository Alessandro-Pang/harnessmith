import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { memoryCheck } from '../commands/memory.js';
import {
  memoryCoreBudget,
  memoryCoreHardByteLimit,
  memoryCoreMaxEntryBytes,
  memoryCoreSoftByteLimit,
} from '../lib/memory-core-budget.js';
import { memoryMaintenanceReport, memoryMaintenanceWarnings } from '../lib/memory-maintenance.js';
import { writeValidated } from '../lib/memory-write.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-core-budget-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const corePath = join(memoryRoot, 'core.md');
  return { project, runtime, memoryRoot, corePath };
}

test('core budget reports UTF-8 bytes, logical lines, and soft/hard status', () => {
  const { memoryRoot, corePath } = fixture();
  const fresh = readFileSync(corePath, 'utf8');
  const report = memoryCoreBudget(fresh);
  assert.equal(report.status, 'ok');
  assert.equal(report.bytes, Buffer.byteLength(fresh));
  assert.ok(report.lines > 0);

  const cjk = `${fresh}${'界'.repeat(Math.ceil(memoryCoreSoftByteLimit / 3))}`;
  assert.equal(memoryCoreBudget(cjk).status, 'soft-limit');
  const hard = `${fresh}${'界'.repeat(Math.ceil(memoryCoreHardByteLimit / 3))}`;
  assert.equal(memoryCoreBudget(hard).status, 'hard-limit');
  const compressible = `${'- Detailed entry '.repeat(2)}memory:working/large-entry\n${'界'.repeat(
    Math.ceil(memoryCoreSoftByteLimit / 3),
  )}`;
  const compressibleReport = memoryCoreBudget(compressible);
  assert.equal(compressibleReport.status, 'soft-limit');
  assert.deepEqual(compressibleReport.compressionCandidates, ['memory:working/large-entry']);
  const crlf = fresh.replaceAll('\n', '\r\n');
  assert.equal(memoryCoreBudget(crlf).lines, report.lines);
  assert.equal(memoryCoreBudget(crlf).bytes, Buffer.byteLength(crlf));

  const maintenance = memoryMaintenanceReport(memoryRoot, '2026-08-31');
  assert.deepEqual(maintenance.coreBudget, report);
  assert.deepEqual(memoryMaintenanceWarnings({ ...maintenance, coreBudget: compressibleReport }), [
    `core context budget: soft-limit (${compressibleReport.lines} lines, ${compressibleReport.bytes} bytes)`,
    'core compression candidate: memory:working/large-entry',
  ]);
});

test('memory check rejects external hard-limit edits and a validated shrink restores the core', () => {
  const { project, runtime, memoryRoot, corePath } = fixture();
  const original = readFileSync(corePath, 'utf8');
  const oversized = `${original}${'界'.repeat(Math.ceil(memoryCoreHardByteLimit / 3))}`;
  writeFileSync(corePath, oversized);
  const invalid = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, invalid), /issue/i);
  assert.match(invalid.errors.join('\n'), /core.*hard.*budget/i);

  writeValidated(memoryRoot, [{ path: corePath, content: original }], capturedIo(), {
    rootKind: 'project',
  });
  assert.equal(readFileSync(corePath, 'utf8'), original);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
});

test('core entries require one short canonical pointer with no duplicate references', () => {
  const { project, runtime, corePath } = fixture();
  const original = readFileSync(corePath, 'utf8');
  const cases = [
    '- Missing pointer',
    '- Two pointers；memory:working/a；memory:working/b',
    `- ${'x'.repeat(memoryCoreMaxEntryBytes)}；memory:working/a`,
    '- First；memory:working/a\n- Duplicate；memory:working/a',
  ];
  for (const entry of cases) {
    writeFileSync(
      corePath,
      original.replace('- <何时读取、能回答什么；创建后补充 memory 引用>', entry),
    );
    const io = capturedIo();
    assert.throws(() => memoryCheck(runtime, project, io), /issue/i);
    assert.match(io.errors.join('\n'), /core.*(?:pointer|entry|duplicate)/i);
  }
});

test('failed candidate validation rolls core bytes back atomically', () => {
  const { memoryRoot, corePath } = fixture();
  const original = readFileSync(corePath, 'utf8');
  const invalid = `${original}${'x'.repeat(memoryCoreHardByteLimit)}`;
  assert.throws(
    () =>
      writeValidated(memoryRoot, [{ path: corePath, content: invalid }], capturedIo(), {
        rootKind: 'project',
      }),
    /issue/i,
  );
  assert.equal(readFileSync(corePath, 'utf8'), original);
});
