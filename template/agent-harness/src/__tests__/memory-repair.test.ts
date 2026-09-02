import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { initProject } from '../commands/init.js';
import {
  applyMemoryRepair,
  diagnoseMemoryRepair,
  memoryRepair,
} from '../commands/memory/memory-repair.js';
import { memoryCoreBudget } from '../lib/memory/memory-core-budget.js';
import { compactCoreContent, digest } from '../lib/memory/memory-repair-contract.js';
import {
  cleanupRepairJournal,
  type RepairMarker,
  repairJournalPaths,
} from '../lib/memory/memory-repair-journal.js';
import { canonicalPath } from '../lib/filesystem/safe-path.js';
import { searchIndexPath, searchWithIndex } from '../lib/search/search-index.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  return { root, project, runtime, memoryRoot: join(project, '.agent-docs') };
}

test('repair diagnosis is read-only and separates partial initialization from derived cache repair', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-plan-');
  const readme = join(memoryRoot, 'README.md');
  rmSync(readme);
  const unknown = join(memoryRoot, 'unknown.txt');
  writeFileSync(unknown, 'user-owned\n');
  const before = JSON.stringify({ entries: readdirSync(memoryRoot).sort() });

  const report = diagnoseMemoryRepair(runtime, project, capturedIo());

  assert.equal(report.mode, 'diagnose-only');
  assert.equal(report.mutation.status, 'unchanged');
  assert.deepEqual(
    report.proposals.map(({ action }) => action),
    ['initialize-missing-memory', 'rebuild-derived-index'],
  );
  assert.deepEqual(report.proposals[0].affectedPaths, [canonicalPath(readme)]);
  assert.equal(report.proposals[0].authority, 'managed-memory-template');
  assert.equal(report.proposals[0].backup.required, false);
  assert.equal(readFileSync(unknown, 'utf8'), 'user-owned\n');
  assert.equal(JSON.stringify({ entries: readdirSync(memoryRoot).sort() }), before);
  assert.equal(existsSync(readme), false);

  assert.throws(
    () =>
      applyMemoryRepair(runtime, project, report.proposals[0].proposalId, capturedIo(), {
        beforeVerify: () => {
          throw new Error('injected initialization verifier failure');
        },
      }),
    /injected initialization verifier failure/,
  );
  assert.equal(existsSync(readme), false);
  const unindexed = join(memoryRoot, 'working', 'unindexed.md');
  mkdirSync(join(memoryRoot, 'working'), { recursive: true });
  assert.throws(
    () =>
      applyMemoryRepair(runtime, project, report.proposals[0].proposalId, capturedIo(), {
        beforeVerify: () =>
          writeFileSync(
            unindexed,
            '---\ntitle: Unindexed\ndescription: Repair verifier fixture\ntype: working-note\nmemory-kind: working\nstatus: active\nowners: [test-owner]\ncreated: 2026-09-01\nupdated: 2026-09-01\nexpires: 2026-09-30\nproject: project\ntags: [repair]\nscope: []\nsource-refs: []\nsource-of-truth: false\nschema-version: 1\n---\n\n# Unindexed\n',
          ),
      }),
    /unindexed memories/i,
  );
  rmSync(unindexed);
  const applied = applyMemoryRepair(runtime, project, report.proposals[0].proposalId, capturedIo());
  assert.ok('verification' in applied);
  assert.equal(applied.verification.status, 'passed');
  assert.equal(existsSync(readme), true);
  assert.equal(readFileSync(unknown, 'utf8'), 'user-owned\n');
});

test('repair CLI defaults to diagnosis and requires proposal plus confirmation for mutation', () => {
  const { project, runtime } = fixture('harness-memory-repair-cli-');
  const output = capturedIo();
  assert.equal(runCli(['memory', 'repair', project, '--json'], { runtime, io: output }), 0);
  assert.equal(JSON.parse(output.logs[0]).mode, 'diagnose-only');
  assert.throws(
    () => runCli(['memory', 'repair', project, '--yes', '--json'], { runtime, io: capturedIo() }),
    /requires both --proposal.*--yes/i,
  );
});

test('repair command renders bounded human-readable diagnosis and apply results', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-output-');
  rmSync(join(memoryRoot, 'README.md'));
  const diagnosisOutput = capturedIo();

  const diagnosis = memoryRepair(runtime, project, {}, diagnosisOutput);

  assert.equal(diagnosis.mode, 'diagnose-only');
  assert.match(diagnosisOutput.logs.join('\n'), /initialize-missing-memory/);
  assert.match(diagnosisOutput.logs.join('\n'), /target .*README\.md/);
  assert.match(diagnosisOutput.logs.join('\n'), /verifier harness memory check/);
  const proposal = diagnosis.proposals.find(({ action }) => action === 'initialize-missing-memory');
  assert.ok(proposal);
  const applyOutput = capturedIo();

  const applied = memoryRepair(
    runtime,
    project,
    { proposal: proposal.proposalId, yes: true },
    applyOutput,
  );

  assert.ok('verification' in applied);
  assert.equal(applied.verification.status, 'passed');
  assert.deepEqual(applyOutput.logs, ['initialize-missing-memory: passed']);
});

test('repair applies one exact index proposal and independently verifies the rebuilt cache', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-index-');
  const sources = [
    {
      root: memoryRoot,
      label: 'memory',
      trust: 'untrusted' as const,
      excludeDirectories: ['_archive', 'host-evals'],
    },
  ];
  searchWithIndex(runtime, 'memory', sources, { refreshIndex: true });
  const index = searchIndexPath(runtime, sources);
  writeFileSync(index, '{broken');
  const unknown = join(memoryRoot, 'unknown.txt');
  writeFileSync(unknown, 'preserve me\n');
  const proposal = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'rebuild-derived-index',
  );
  assert.ok(proposal);

  const result = applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo());

  assert.equal(result.action, 'rebuild-derived-index');
  assert.equal(result.verification.status, 'passed');
  assert.equal(readFileSync(unknown, 'utf8'), 'preserve me\n');
  assert.doesNotThrow(() => searchWithIndex(runtime, 'memory', sources, { mode: 'fulltext' }));
  assert.throws(
    () => applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo()),
    /proposal.*changed/i,
  );
});

test('core repair compacts only canonical index labels and rolls back injected verifier failure', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-core-');
  const core = join(memoryRoot, 'core.md');
  const original = readFileSync(core, 'utf8');
  const entries: string[] = [];
  for (let index = 0; index < 90; index += 1) {
    const name = `working/repair-${index}`;
    mkdirSync(join(memoryRoot, 'working'), { recursive: true });
    writeFileSync(
      join(memoryRoot, `${name}.md`),
      `---\ntitle: Repair ${index}\ndescription: Repair fixture\ntype: working-note\nmemory-kind: working\nstatus: active\nowners: [test-owner]\ncreated: 2026-09-01\nupdated: 2026-09-01\nexpires: 2026-09-30\nproject: project\ntags: [repair]\nscope: []\nsource-refs: []\nsource-of-truth: false\nschema-version: 1\n---\n\n# Repair ${index}\n`,
    );
    entries.push(`- ${'bounded label '.repeat(18)}；memory:${name}`);
  }
  writeFileSync(
    core,
    original.replace('- <何时读取、能回答什么；创建后补充 memory 引用>', entries.join('\n')),
  );
  assert.notEqual(memoryCoreBudget(readFileSync(core, 'utf8')).status, 'ok');
  const proposal = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'compact-core-index',
  );
  assert.ok(proposal);
  const oversized = readFileSync(core, 'utf8');

  assert.throws(
    () =>
      applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo(), {
        beforeVerify: () => {
          throw new Error('injected verifier failure');
        },
      }),
    /injected verifier failure/,
  );
  assert.equal(readFileSync(core, 'utf8'), oversized);

  const result = applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo());
  assert.equal(result.verification.status, 'passed');
  assert.equal(memoryCoreBudget(readFileSync(core, 'utf8')).status, 'ok');
  assert.match(readFileSync(core, 'utf8'), /- memory:working\/repair-0/);
});

test('repair clears only an exact owned orphan marker and retains unverified markers', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-orphan-');
  const root = canonicalPath(memoryRoot);
  const target = join(root, 'core.md');
  const original = readFileSync(target, 'utf8');
  const proposalId = `sha256:${'a'.repeat(64)}`;
  const journal = repairJournalPaths(runtime, proposalId);
  mkdirSync(journal.root, { recursive: true });
  writeFileSync(journal.backup, original, { mode: 0o600 });
  writeFileSync(
    journal.marker,
    `${JSON.stringify({
      version: 1,
      owner: runtime.owner,
      proposalId,
      action: 'compact-core-index',
      stage: 'prepared',
      root,
      target,
      backup: journal.backup,
      beforeDigest: digest(original),
      afterDigest: digest(compactCoreContent(original)),
      mode: 0o644,
      createdAt: '2026-09-01T00:00:00.000Z',
    })}\n`,
  );
  const unknown = join(journal.root, 'unknown.json');
  writeFileSync(unknown, '{"owner":"somebody-else"}\n');
  const ownerlessBackup = join(journal.root, `${'c'.repeat(64)}.backup`);
  writeFileSync(ownerlessBackup, 'ownerless\n');
  assert.throws(() => repairJournalPaths(runtime, 'invalid'), /invalid repair proposal id/i);
  const report = diagnoseMemoryRepair(runtime, project, capturedIo());
  const cleanup = report.proposals.find(({ action }) => action === 'clear-orphan-repair-marker');
  assert.ok(cleanup);
  assert.ok(
    report.unresolved.some(
      ({ fault, reasonCode }) =>
        fault === 'repair-transaction' && reasonCode === 'REPAIR_MARKER_IDENTITY_UNVERIFIED',
    ),
  );
  assert.ok(
    report.unresolved.some(
      ({ fault, reasonCode }) =>
        fault === 'repair-transaction' && reasonCode === 'OWNERLESS_REPAIR_BACKUP_RETAINED',
    ),
  );

  const result = applyMemoryRepair(runtime, project, cleanup.proposalId, capturedIo());

  assert.equal(result.verification.status, 'passed');
  assert.equal(existsSync(journal.marker), false);
  assert.equal(existsSync(journal.backup), false);
  assert.equal(readFileSync(target, 'utf8'), original);
  assert.equal(readFileSync(unknown, 'utf8'), '{"owner":"somebody-else"}\n');
  assert.equal(readFileSync(ownerlessBackup, 'utf8'), 'ownerless\n');
});

test('repair retains owned journals when exact path or backup digest verification fails', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-unverified-journal-');
  const root = canonicalPath(memoryRoot);
  const target = join(root, 'core.md');
  const original = readFileSync(target, 'utf8');
  const createMarker = (identity: string, overrides: Record<string, unknown> = {}) => {
    const proposalId = `sha256:${identity.repeat(64)}`;
    const journal = repairJournalPaths(runtime, proposalId);
    mkdirSync(journal.root, { recursive: true });
    writeFileSync(journal.backup, original, { mode: 0o600 });
    writeFileSync(
      journal.marker,
      `${JSON.stringify({
        version: 1,
        owner: runtime.owner,
        proposalId,
        action: 'compact-core-index',
        stage: 'prepared',
        root,
        target,
        backup: journal.backup,
        beforeDigest: digest(original),
        afterDigest: digest(compactCoreContent(original)),
        mode: 0o644,
        createdAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
      })}\n`,
    );
    return journal;
  };
  const wrongTarget = createMarker('d', { target: join(root, 'README.md') });
  const changedBackup = createMarker('e');
  writeFileSync(changedBackup.backup, 'changed backup\n');

  const report = diagnoseMemoryRepair(runtime, project, capturedIo());

  assert.equal(
    report.unresolved.filter(({ reasonCode }) => reasonCode === 'REPAIR_MARKER_CONTENT_UNVERIFIED')
      .length,
    2,
  );
  assert.equal(existsSync(wrongTarget.marker), true);
  assert.equal(existsSync(wrongTarget.backup), true);
  assert.equal(existsSync(changedBackup.marker), true);
  assert.equal(existsSync(changedBackup.backup), true);
});

test('repair journal cleanup refuses changed recovery evidence', () => {
  const { runtime, memoryRoot } = fixture('harness-memory-repair-cleanup-evidence-');
  const root = canonicalPath(memoryRoot);
  const target = join(root, 'core.md');
  const original = readFileSync(target, 'utf8');
  const proposalId = `sha256:${'f'.repeat(64)}`;
  const journal = repairJournalPaths(runtime, proposalId);
  mkdirSync(journal.root, { recursive: true });
  const marker: RepairMarker = {
    version: 1,
    owner: runtime.owner,
    proposalId,
    action: 'compact-core-index',
    stage: 'prepared',
    root,
    target,
    backup: journal.backup,
    beforeDigest: digest(original),
    afterDigest: digest(compactCoreContent(original)),
    mode: 0o644,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  writeFileSync(journal.backup, 'changed backup\n', { mode: 0o600 });
  writeFileSync(journal.marker, `${JSON.stringify(marker)}\n`);
  assert.throws(() => cleanupRepairJournal(marker), /backup changed/i);
  writeFileSync(journal.backup, original, { mode: 0o600 });
  writeFileSync(journal.marker, `${JSON.stringify({ ...marker, stage: 'mutated' })}\n`);

  assert.throws(() => cleanupRepairJournal(marker), /marker changed/i);
  assert.equal(existsSync(journal.marker), true);
  assert.equal(existsSync(journal.backup), true);
});

test('repair restores an interrupted core mutation only when marker, backup, and target digests match', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-restore-');
  const root = canonicalPath(memoryRoot);
  const target = join(root, 'core.md');
  const original = readFileSync(target, 'utf8');
  const mutated = original.replace('# Project Memory Index', '# Project Memory Index\n');
  writeFileSync(target, mutated);
  const proposalId = `sha256:${'b'.repeat(64)}`;
  const journal = repairJournalPaths(runtime, proposalId);
  mkdirSync(journal.root, { recursive: true });
  writeFileSync(journal.backup, original, { mode: 0o600 });
  writeFileSync(
    journal.marker,
    `${JSON.stringify({
      version: 1,
      owner: runtime.owner,
      proposalId,
      action: 'compact-core-index',
      stage: 'mutated',
      root,
      target,
      backup: journal.backup,
      beforeDigest: digest(original),
      afterDigest: digest(mutated),
      mode: 0o644,
      createdAt: '2026-09-01T00:00:00.000Z',
    })}\n`,
  );
  const recovery = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'restore-interrupted-core-repair',
  );
  assert.ok(recovery);

  const result = applyMemoryRepair(runtime, project, recovery.proposalId, capturedIo());

  assert.equal(result.verification.status, 'passed');
  assert.equal(readFileSync(target, 'utf8'), original);
  assert.equal(existsSync(journal.marker), false);
  assert.equal(existsSync(journal.backup), false);
});
