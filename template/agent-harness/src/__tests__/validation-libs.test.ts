import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { validateDocs } from '../lib/docs-validation.js';
import { memoryDocumentPath } from '../lib/memory-path.js';
import { metadataReferences, validateMemoryRoot } from '../lib/memory-validation.js';
import { outputTask } from '../lib/task-output.js';
import type { TaskSummary, ValidationReport } from '../types.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-validation-libs-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function report(): ValidationReport {
  return {
    version: 1,
    checks: [],
    summary: { passed: 0, warning: 0, failed: 0 },
    valid: true,
  };
}

test('docs validation reports missing, malformed, escaping, broken, and unrouted content', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, { docsRoot: join(root, 'docs') });
  const missing = report();
  validateDocs(runtime, missing);
  assert.equal(missing.checks[0]?.id, 'docs-manifest');

  mkdirSync(runtime.docsRoot);
  writeFileSync(join(runtime.docsRoot, 'manifest.yaml'), 'entries: [invalid\n');
  const malformed = report();
  validateDocs(runtime, malformed);
  assert.match(malformed.checks[0]?.message ?? '', /Invalid YAML/);

  writeFileSync(
    join(runtime.docsRoot, 'manifest.yaml'),
    'entries:\n  empty: {}\n  escape: { path: ../outside.md }\n  missing: { path: missing.md }\n',
  );
  writeFileSync(
    join(runtime.docsRoot, 'orphan.md'),
    '---\ntitle: Old\ntype: guide\nstatus: active\nupdated: 2020-01-01\n---\n[missing](nowhere.md)\n',
  );
  writeFileSync(join(runtime.docsRoot, 'bad.md'), '---\nvalue: [\n---\n');
  const invalid = report();
  validateDocs(runtime, invalid);
  const messages = invalid.checks.map(({ message }) => message).join('\n');
  assert.match(messages, /Route has no path/);
  assert.match(messages, /Route escapes docs root/);
  assert.match(messages, /Broken route/);
  assert.match(messages, /Document is not routed/);
  assert.match(messages, /Not reviewed/);
  assert.match(messages, /Broken relative link/);
  assert.match(messages, /Invalid frontmatter/);
});

test('memory validation rejects malformed lifecycle metadata and escaping references', () => {
  const root = temporaryRoot();
  writeFileSync(join(root, 'broken.md'), '---\nvalue: [\n---\n');
  writeFileSync(
    join(root, 'working.md'),
    [
      '---',
      'title: Working',
      'description: Working note',
      'type: working-memory',
      'memory-kind: working',
      'status: active',
      'owners: [test]',
      'created: 2026-08-20',
      'updated: 2026-08-19',
      'project: test',
      'tags: [test]',
      'scope: []',
      'source-refs: []',
      'source-of-truth: false',
      'expires: invalid',
      'derived-from: memory:../outside',
      'schema-version: 1',
      '---',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'metadata.md'),
    [
      '---',
      'title: Metadata',
      'description: Invalid metadata',
      'type: memory',
      'memory-kind: unknown',
      'status: unknown',
      'owners: [test]',
      'created: 2026-08-19',
      'updated: 2026-08-19',
      'project: test',
      'tags: [test]',
      'scope: []',
      'source-refs: []',
      'source-of-truth: true',
      'schema-version: 1',
      '---',
    ].join('\n'),
  );
  const io = capturedIo();
  assert.throws(() => validateMemoryRoot(root, io), /issue/);
  const errors = io.errors.join('\n');
  assert.match(errors, /Invalid memory frontmatter/);
  assert.match(errors, /updated date precedes created date/);
  assert.match(errors, /Invalid expires date/);
  assert.match(errors, /reference escapes root/);
  assert.match(errors, /Invalid memory kind/);
  assert.match(errors, /Invalid memory status/);
  assert.match(errors, /source-of-truth/);
  assert.deepEqual(
    metadataReferences(new Map([['derived-from', ['memory:source', 1, 'external']]])),
    ['memory:source'],
  );
});

test('memory document paths reject roots, escapes, and missing files', () => {
  const root = temporaryRoot();
  assert.throws(() => memoryDocumentPath(root, ''), /Invalid memory document path/);
  assert.throws(() => memoryDocumentPath(root, '../outside'), /escapes root/);
  assert.throws(() => memoryDocumentPath(root, 'missing'), /does not exist/);
});

test('task output renders JSON, lists, details, and acceptance criteria', () => {
  const task: TaskSummary = {
    id: 'task-1',
    objective: 'Validate output',
    status: 'in_progress',
    updated: '2026-08-19T00:00:00.000Z',
    nextAction: '',
    acceptance: [{ id: 'a1', description: 'Pass', status: 'pending', evidence: [] }],
    lastCheckpoint: null,
  };
  const json = capturedIo();
  outputTask(task, true, json);
  assert.equal(JSON.parse(json.logs[0]).id, task.id);

  const list = capturedIo();
  outputTask([task], false, list);
  assert.match(list.logs[0], /task-1 \| in_progress/);

  const detail = capturedIo();
  outputTask(task, false, detail);
  assert.match(detail.logs.join('\n'), /Next: none/);
  assert.match(detail.logs.join('\n'), /a1 \| pending \| Pass/);
});
