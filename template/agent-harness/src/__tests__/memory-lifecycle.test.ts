import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import { onTestFinished, test } from 'vitest';
import { initGlobal } from '../commands/init.js';
import { memoryCheck } from '../commands/memory/memory.js';
import { archiveMemory, supersedeMemory } from '../commands/memory/memory-lifecycle.js';
import { memoryMaintenance } from '../commands/memory/memory-maintenance.js';
import { memoryMigrate } from '../commands/memory/memory-migration.js';
import { inputContentDigest } from '../lib/memory/memory-input.js';
import { memoryMaintenanceWarnings } from '../lib/memory/memory-maintenance.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function memoryDocument(title: string, body = ''): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} memory`,
    'type: session-handoff',
    'memory-kind: episode',
    'status: active',
    'owners: [test-owner]',
    'created: 2026-08-19',
    'updated: 2026-08-19',
    'project: test',
    'tags: [test]',
    'scope: []',
    'source-refs: []',
    'source-of-truth: false',
    'schema-version: 1',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

test('memory maintenance reports unindexed, expired, and closed candidates', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  writeFileSync(join(runtime.memoryHome, 'orphan.md'), memoryDocument('Orphan'));
  writeFileSync(
    join(runtime.memoryHome, 'expired.md'),
    memoryDocument('Expired')
      .replace('memory-kind: episode', 'memory-kind: working')
      .replace('schema-version: 1', 'expires: 2000-01-01\nschema-version: 1'),
  );
  writeFileSync(
    join(runtime.memoryHome, 'closed.md'),
    memoryDocument('Closed').replace('status: active', 'status: complete'),
  );
  const report = memoryMaintenance(runtime, 'global', { json: true }, capturedIo());
  assert.deepEqual(report.unindexed, ['expired.md', 'orphan.md']);
  assert.deepEqual(report.expiredWorking, ['expired.md']);
  assert.deepEqual(report.closed, ['closed.md']);
});

test('memory maintenance surfaces legacy, generic-action, and workstream inputs for review', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const inputDocument = (title: string, content: string) =>
    memoryDocument(title, `# 原始输入\n\n${content}`)
      .replace('type: session-handoff', 'type: user-input')
      .replace('memory-kind: episode', 'memory-kind: input')
      .replace(
        'schema-version: 1',
        [
          'input-source: chat',
          `content-digest: sha256:${inputContentDigest(`${content}\n`, 'chat', true)}`,
          'verbatim: true',
          'schema-version: 1',
        ].join('\n'),
      );
  writeFileSync(join(runtime.memoryHome, 'legacy-submit.md'), inputDocument('Submit', '提交'));
  writeFileSync(
    join(runtime.memoryHome, 'release-risk.md'),
    inputDocument('Release risk', 'Accept the release risk.').replace(
      'input-source: chat',
      [
        'input-schema-version: 2',
        'input-source: chat',
        'input-purpose: risk-decision',
        'retention: workstream',
        'workstream: release-0-7-1',
      ].join('\n'),
    ),
  );

  const report = memoryMaintenance(runtime, 'global', { json: true }, capturedIo());

  assert.equal(report.activeInputCount, 2);
  assert.deepEqual(report.legacyInputs, ['legacy-submit.md']);
  assert.deepEqual(report.genericActionInputs, ['legacy-submit.md']);
  assert.deepEqual(report.workstreamInputs, ['release-risk.md']);
  assert.deepEqual(memoryMaintenanceWarnings(report).slice(-3), [
    'legacy input: legacy-submit.md',
    'generic action input: legacy-submit.md',
    'active workstream input: release-risk.md',
  ]);
});

test('memory maintenance reports duplicate active titles and supersession cycles', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  writeFileSync(join(runtime.memoryHome, 'duplicate-a.md'), memoryDocument('Duplicate'));
  writeFileSync(join(runtime.memoryHome, 'duplicate-b.md'), memoryDocument('Duplicate'));
  writeFileSync(join(runtime.memoryHome, 'another-a.md'), memoryDocument('Another'));
  writeFileSync(join(runtime.memoryHome, 'another-b.md'), memoryDocument('Another'));
  writeFileSync(
    join(runtime.memoryHome, 'cycle-a.md'),
    memoryDocument('Cycle A')
      .replace('status: active', 'status: superseded')
      .replace('schema-version: 1', 'superseded-by: memory:cycle-b\nschema-version: 1'),
  );
  writeFileSync(
    join(runtime.memoryHome, 'cycle-b.md'),
    memoryDocument('Cycle B')
      .replace('status: active', 'status: superseded')
      .replace('schema-version: 1', 'superseded-by: memory:cycle-a\nschema-version: 1'),
  );

  const io = capturedIo();
  const report = memoryMaintenance(runtime, 'global', { json: false }, io);

  assert.deepEqual(report.duplicateTitles, [
    { title: 'Another', paths: ['another-a.md', 'another-b.md'] },
    { title: 'Duplicate', paths: ['duplicate-a.md', 'duplicate-b.md'] },
  ]);
  assert.deepEqual(report.supersessionCycles, [['cycle-a.md', 'cycle-b.md', 'cycle-a.md']]);
  assert.deepEqual(memoryMaintenanceWarnings(report), [
    'archive candidate: cycle-a.md',
    'archive candidate: cycle-b.md',
    'duplicate title: Another (another-a.md, another-b.md)',
    'duplicate title: Duplicate (duplicate-a.md, duplicate-b.md)',
    'supersession cycle: cycle-a.md -> cycle-b.md -> cycle-a.md',
    'duplicate purpose: Another (another-a.md, another-b.md)',
    'duplicate purpose: Duplicate (duplicate-a.md, duplicate-b.md)',
  ]);
  assert.match(io.logs.join('\n'), /Duplicate active titles: 2/);
  assert.match(io.logs.join('\n'), /Supersession cycles: 1/);
});

test('memory mutations reject concurrent writers through the shared root lock', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  writeFileSync(join(runtime.memoryHome, 'source.md'), memoryDocument('Source'));
  writeFileSync(join(runtime.memoryHome, 'replacement.md'), memoryDocument('Replacement'));
  const release = lockfile.lockSync(runtime.memoryHome, { realpath: false });
  onTestFinished(() => release());

  assert.throws(
    () => supersedeMemory(runtime, 'global', 'source', 'replacement', capturedIo()),
    /memory is being updated/i,
  );
  assert.match(readFileSync(join(runtime.memoryHome, 'source.md'), 'utf8'), /status: active/);
});

test('memory migration is proposal-only by default and preserves replaced legacy metadata', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'legacy.md');
  writeFileSync(
    source,
    memoryDocument('Legacy')
      .replace('memory-kind: episode\n', '')
      .replace('status: active', 'status: Draft for Maintainer Review')
      .replace('schema-version: 1', 'schema-version: 0'),
  );
  const before = readFileSync(source, 'utf8');

  const report = memoryMigrate(
    runtime,
    'global',
    'legacy',
    JSON.stringify({ 'memory-kind': 'evidence', status: 'complete' }),
    {},
    capturedIo(),
  );

  assert.equal(report.mode, 'proposal-only');
  assert.equal(report.ready, true);
  assert.equal(report.proposedUpdates['legacy-status'], 'Draft for Maintainer Review');
  assert.equal(report.proposedUpdates['legacy-schema-version'], 0);
  assert.equal(Object.hasOwn(report.proposedUpdates, 'fact-class'), false);
  assert.equal(Object.hasOwn(report.proposedUpdates, 'document-purpose'), false);
  assert.equal(readFileSync(source, 'utf8'), before);

  const applied = memoryMigrate(
    runtime,
    'global',
    'legacy',
    JSON.stringify({ 'memory-kind': 'evidence', status: 'complete' }),
    { apply: true },
    capturedIo(),
  );
  assert.equal(applied.mode, 'applied');
  assert.match(readFileSync(source, 'utf8'), /legacy-status: Draft for Maintainer Review/);
  assert.doesNotMatch(readFileSync(source, 'utf8'), /^fact-class:/m);
  assert.doesNotMatch(readFileSync(source, 'utf8'), /^document-purpose:/m);
  memoryCheck(runtime, 'global', capturedIo());
});

test('memory migration reclassifies legacy input summaries without breaking their digest', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'legacy-input.md');
  const summary = 'User accepted the release-scoped risk and authorized the current release.';
  writeFileSync(
    source,
    memoryDocument('Legacy input', `# 原始输入\n\n${summary}`)
      .replace('type: session-handoff', 'type: user-input')
      .replace('memory-kind: episode', 'memory-kind: input')
      .replace(
        'schema-version: 1',
        [
          'input-source: chat',
          `content-digest: sha256:${inputContentDigest(`${summary}\n`, 'chat', true)}`,
          'verbatim: true',
          'schema-version: 1',
        ].join('\n'),
      ),
  );
  const before = readFileSync(source, 'utf8');
  const updates = JSON.stringify({
    'input-schema-version': 2,
    'input-purpose': 'risk-decision',
    retention: 'workstream',
    workstream: 'release-0-7-1',
    verbatim: false,
  });

  const proposal = memoryMigrate(runtime, 'global', 'legacy-input', updates, {}, capturedIo());
  assert.equal(proposal.ready, true);
  assert.equal(readFileSync(source, 'utf8'), before);

  memoryMigrate(runtime, 'global', 'legacy-input', updates, { apply: true }, capturedIo());
  const migrated = readFileSync(source, 'utf8');
  assert.match(migrated, /^verbatim: false$/m);
  assert.match(migrated, /^# 可靠摘要$/m);
  assert.doesNotMatch(migrated, /^# 原始输入$/m);
  assert.match(
    migrated,
    new RegExp(`^content-digest: sha256:${inputContentDigest(summary, 'chat', false)}$`, 'm'),
  );
  memoryCheck(runtime, 'global', capturedIo());
});

test('memory migration refuses incomplete proposals and participates in the root lock', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'legacy.md');
  writeFileSync(source, memoryDocument('Legacy').replace('memory-kind: episode\n', ''));

  const incomplete = memoryMigrate(runtime, 'global', 'legacy', '{}', {}, capturedIo());
  assert.equal(incomplete.ready, false);
  assert.equal(
    incomplete.issues.some((issue) => issue.includes('memory-kind')),
    true,
  );
  assert.throws(
    () => memoryMigrate(runtime, 'global', 'legacy', '{}', { apply: true }, capturedIo()),
    /not ready/i,
  );

  const release = lockfile.lockSync(runtime.memoryHome, { realpath: false });
  onTestFinished(() => release());
  assert.throws(
    () =>
      memoryMigrate(
        runtime,
        'global',
        'legacy',
        JSON.stringify({ 'memory-kind': 'episode' }),
        { apply: true },
        capturedIo(),
      ),
    /memory is being updated/i,
  );
  assert.doesNotMatch(readFileSync(source, 'utf8'), /legacy-schema-version/);
});

test('memory migration validates root references before apply and preserves the source on failure', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'legacy.md');
  writeFileSync(source, memoryDocument('Legacy'));
  const before = readFileSync(source, 'utf8');
  const updates = JSON.stringify({ 'derived-from': 'memory:missing' });

  const proposal = memoryMigrate(runtime, 'global', 'legacy', updates, {}, capturedIo());
  assert.equal(proposal.ready, false);
  assert.equal(
    proposal.issues.some((issue) => /Broken memory reference/.test(issue)),
    true,
  );
  assert.throws(
    () => memoryMigrate(runtime, 'global', 'legacy', updates, { apply: true }, capturedIo()),
    /not ready/i,
  );
  assert.equal(readFileSync(source, 'utf8'), before);
});

test('memory migration can repair one legacy document while another remains invalid', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  for (const name of ['first', 'second']) {
    writeFileSync(
      join(runtime.memoryHome, `${name}.md`),
      memoryDocument(name).replace('memory-kind: episode\n', ''),
    );
  }

  const applied = memoryMigrate(
    runtime,
    'global',
    'first',
    JSON.stringify({ 'memory-kind': 'episode' }),
    { apply: true },
    capturedIo(),
  );
  assert.equal(applied.ready, true);
  assert.match(readFileSync(join(runtime.memoryHome, 'first.md'), 'utf8'), /memory-kind: episode/);
  assert.throws(() => memoryCheck(runtime, 'global', capturedIo()), /issue/);
});

test('memory archive participates in the shared root lock', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'closed.md');
  writeFileSync(source, memoryDocument('Closed').replace('status: active', 'status: complete'));
  const release = lockfile.lockSync(runtime.memoryHome, { realpath: false });
  onTestFinished(() => release());

  assert.throws(
    () => archiveMemory(runtime, 'global', 'closed', {}, capturedIo()),
    /memory is being updated/i,
  );
  assert.equal(existsSync(source), true);
  assert.equal(existsSync(join(runtime.memoryHome, '_archive')), false);
});

test('memory supersede and archive maintain links and move only closed documents', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const current = join(runtime.memoryHome, 'current.md');
  const previous = join(runtime.memoryHome, 'previous.md');
  writeFileSync(current, memoryDocument('Current'));
  writeFileSync(previous, memoryDocument('Previous'));

  supersedeMemory(runtime, 'global', 'previous', 'current', capturedIo());
  assert.match(readFileSync(previous, 'utf8'), /status: superseded/);
  assert.match(readFileSync(previous, 'utf8'), /superseded-by: memory:current/);
  const archived = archiveMemory(runtime, 'global', 'previous', {}, capturedIo());
  assert.equal(existsSync(previous), false);
  assert.equal(existsSync(archived), true);
  assert.match(readFileSync(archived, 'utf8'), /status: archived/);
  assert.throws(
    () => archiveMemory(runtime, 'global', 'current', {}, capturedIo()),
    /active memory requires --force/,
  );
  memoryCheck(runtime, 'global', capturedIo());
});

test('memory archive rejects inbound references from archived documents', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'closed.md');
  writeFileSync(source, memoryDocument('Closed').replace('status: active', 'status: complete'));
  const archivedReference = join(runtime.memoryHome, '_archive', '2026', '01', 'reference.md');
  mkdirSync(dirname(archivedReference), { recursive: true });
  writeFileSync(
    archivedReference,
    memoryDocument('Archived reference', 'See memory:closed').replace(
      'status: active',
      'status: archived',
    ),
  );
  memoryCheck(runtime, 'global', capturedIo());

  assert.throws(
    () => archiveMemory(runtime, 'global', 'closed', {}, capturedIo()),
    /memory is still referenced/i,
  );
  assert.equal(existsSync(source), true);
  memoryCheck(runtime, 'global', capturedIo());
});

test('memory archive matches complete reference tokens instead of path prefixes', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'closed.md');
  writeFileSync(source, memoryDocument('Closed').replace('status: active', 'status: complete'));
  writeFileSync(join(runtime.memoryHome, 'closed-longer.md'), memoryDocument('Closed longer'));
  writeFileSync(
    join(runtime.memoryHome, 'reference.md'),
    memoryDocument('Reference', 'See memory:closed-longer'),
  );

  const archived = archiveMemory(runtime, 'global', 'closed', {}, capturedIo());
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(archived), true);
  memoryCheck(runtime, 'global', capturedIo());
});
