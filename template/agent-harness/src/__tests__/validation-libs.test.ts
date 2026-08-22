import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { routeDocumentation } from '../lib/docs-routing.js';
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

test('docs validation honors per-document review intervals', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, { docsRoot: join(root, 'docs') });
  mkdirSync(runtime.docsRoot);
  writeFileSync(
    join(runtime.docsRoot, 'manifest.yaml'),
    'entries:\n  guide:\n    path: guide.md\n',
  );
  writeFileSync(
    join(runtime.docsRoot, 'guide.md'),
    [
      '---',
      'title: Guide',
      'type: guide',
      'status: active',
      'updated: 2026-07-01',
      'review-interval-days: 30',
      '---',
    ].join('\n'),
  );

  const result = report();
  validateDocs(runtime, result);
  assert.equal(
    result.checks.some(
      ({ id, status, message }) =>
        id === 'docs-freshness' && status === 'warning' && message.includes('30-day interval'),
    ),
    true,
  );
});

test('docs validation follows reference links and balanced-parenthesis destinations', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, { docsRoot: join(root, 'docs') });
  mkdirSync(runtime.docsRoot);
  writeFileSync(join(runtime.docsRoot, 'manifest.yaml'), 'entries:\n  guide: { path: guide.md }\n');
  writeFileSync(join(runtime.docsRoot, 'target(1).txt'), 'target\n');
  writeFileSync(
    join(runtime.docsRoot, 'guide.md'),
    [
      '---',
      'title: Guide',
      'type: guide',
      'status: active',
      'updated: 2026-08-22',
      '---',
      '[inline](target(1).txt)',
      '[reference][target]',
      '',
      '[target]: target(1).txt',
    ].join('\n'),
  );

  const result = report();
  validateDocs(runtime, result);
  assert.equal(
    result.checks.some(({ id, status }) => id === 'docs-link' && status === 'failed'),
    false,
  );
});

test('docs validation checks missing reference-link destinations', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, { docsRoot: join(root, 'docs') });
  mkdirSync(runtime.docsRoot);
  writeFileSync(join(runtime.docsRoot, 'manifest.yaml'), 'entries:\n  guide: { path: guide.md }\n');
  writeFileSync(
    join(runtime.docsRoot, 'guide.md'),
    [
      '---',
      'title: Guide',
      'type: guide',
      'status: active',
      'updated: 2026-08-22',
      '---',
      '[reference][missing]',
      '',
      '[missing]: nowhere.md',
    ].join('\n'),
  );

  const result = report();
  validateDocs(runtime, result);
  assert.equal(
    result.checks.some(
      ({ id, status, message }) =>
        id === 'docs-link' && status === 'failed' && message.includes('nowhere.md'),
    ),
    true,
  );
});

test('docs validation ignores Markdown-looking links inside code spans', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, { docsRoot: join(root, 'docs') });
  mkdirSync(runtime.docsRoot);
  writeFileSync(join(runtime.docsRoot, 'manifest.yaml'), 'entries:\n  guide: { path: guide.md }\n');
  writeFileSync(
    join(runtime.docsRoot, 'guide.md'),
    [
      '---',
      'title: Guide',
      'type: guide',
      'status: active',
      'updated: 2026-08-22',
      '---',
      '`[example](not-a-real-file.md)`',
    ].join('\n'),
  );

  const result = report();
  validateDocs(runtime, result);
  assert.equal(
    result.checks.some(({ id, status }) => id === 'docs-link' && status === 'failed'),
    false,
  );
});

test('documentation routing rejects malformed and escaping manifest entries', () => {
  const root = temporaryRoot();
  const manifest = join(root, 'manifest.yaml');
  writeFileSync(manifest, 'entries: []\n');
  assert.throws(() => routeDocumentation(root, ['review']), /entries must be an object/);
  assert.throws(() => routeDocumentation(root, ['  ']), /routing term/);

  writeFileSync(manifest, 'entries:\n  invalid: []\n');
  assert.throws(() => routeDocumentation(root, ['review']), /entry invalid must be an object/);
  writeFileSync(manifest, 'entries:\n  invalid: { triggers: [review] }\n');
  assert.throws(() => routeDocumentation(root, ['review']), /has no valid path/);
  writeFileSync(manifest, 'entries:\n  invalid: { path: guide.md, triggers: review }\n');
  assert.throws(() => routeDocumentation(root, ['review']), /invalid triggers/);
  writeFileSync(manifest, 'entries:\n  invalid: { path: ../outside.md, triggers: [review] }\n');
  assert.throws(() => routeDocumentation(root, ['review']), /escapes docs root/);
});

test('documentation routing accepts an in-root filename that starts with two dots', () => {
  const root = temporaryRoot();
  writeFileSync(
    join(root, 'manifest.yaml'),
    'entries:\n  guide: { path: ..guide.md, triggers: [review] }\n',
  );
  writeFileSync(join(root, '..guide.md'), '# Guide\n');

  assert.deepEqual(
    routeDocumentation(root, ['review']).routes.map(({ path }) => path),
    [join(root, '..guide.md')],
  );
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

test('memory validation rejects additional high-confidence provider token formats', () => {
  const root = temporaryRoot();
  const base = [
    '---',
    'title: Secret',
    'description: Secret note',
    'type: evidence-manifest',
    'memory-kind: evidence',
    'status: complete',
    'owners: [test]',
    'created: 2026-08-21',
    'updated: 2026-08-21',
    'project: test',
    'tags: [test]',
    'scope: []',
    'source-refs: []',
    'source-of-truth: false',
    'schema-version: 1',
    '---',
  ];
  const npmCredential = ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
  const slackCredential = ['xoxb', '123456789012', '123456789012', 'abcdefghijklmnopqrstuvwx'].join(
    '-',
  );
  writeFileSync(join(root, 'npm.md'), [...base, npmCredential].join('\n'));
  writeFileSync(join(root, 'slack.md'), [...base, slackCredential].join('\n'));

  const io = capturedIo();
  assert.throws(() => validateMemoryRoot(root, io), /2 issue/);
  assert.equal(io.errors.filter((message) => /secret material/.test(message)).length, 2);
});

test('memory validation scans task JSON for high-confidence secret material', () => {
  const root = temporaryRoot();
  mkdirSync(join(root, 'working', 'task'), { recursive: true });
  writeFileSync(
    join(root, 'working', 'task', 'task.json'),
    JSON.stringify({ nextAction: `Bearer ${'B'.repeat(24)}` }),
  );

  const io = capturedIo();
  assert.throws(() => validateMemoryRoot(root, io), /1 issue/);
  assert.match(io.errors.join('\n'), /secret material.*task\.json/i);
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
    baselineDrift: {
      branch: false,
      head: false,
      dirty: false,
      currentBranch: null,
      currentHead: null,
      currentDirty: null,
    },
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
