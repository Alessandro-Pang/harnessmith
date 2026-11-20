import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { applyMemoryRepair, diagnoseMemoryRepair } from '../commands/memory/memory-repair.js';
import { canonicalPath } from '../lib/filesystem/safe-path.js';
import { digest } from '../lib/memory/memory-repair-contract.js';
import { repairJournalPaths } from '../lib/memory/memory-repair-journal.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

type RepairOptions = NonNullable<Parameters<typeof applyMemoryRepair>[4]> & {
  beforeRevalidate?: () => void;
};

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  return { project, runtime, memoryRoot: join(project, '.agent-docs') };
}

function oversizedCore(memoryRoot: string): string {
  const core = join(memoryRoot, 'core.md');
  const original = readFileSync(core, 'utf8');
  const entries: string[] = [];
  mkdirSync(join(memoryRoot, 'working'), { recursive: true });
  for (let index = 0; index < 70; index += 1) {
    const name = `working/identity-${index}`;
    writeFileSync(
      join(memoryRoot, `${name}.md`),
      `---\ntitle: Identity ${index}\ndescription: Repair identity fixture\ntype: working-note\nmemory-kind: working\nstatus: active\nowners: [test-owner]\ncreated: 2026-09-01\nupdated: 2026-09-01\nexpires: 2026-09-30\nproject: project\ntags: [repair]\nscope: []\nsource-refs: []\nsource-of-truth: false\nschema-version: 1\n---\n\n# Identity ${index}\n`,
    );
    entries.push(`- ${'identity label '.repeat(24)}；memory:${name}`);
  }
  const content = original.replace(
    '- <何时读取、能回答什么；创建后补充 memory 引用>',
    entries.join('\n'),
  );
  writeFileSync(core, content);
  return content;
}

function interruptedRepair(runtime: ReturnType<typeof harnessRuntime>, memoryRoot: string) {
  const root = canonicalPath(memoryRoot);
  const target = join(root, 'core.md');
  const original = readFileSync(target, 'utf8');
  const mutated = original.replace('# Project Memory Index', '# Project Memory Index\n');
  const mode = statSync(target).mode & 0o777;
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
      mode,
      createdAt: '2026-09-01T00:00:00.000Z',
    })}\n`,
  );
  return { journal, mutated, original, target };
}

test('core repair revalidates the complete proposal identity after acquiring both locks', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-core-identity-');
  const core = join(memoryRoot, 'core.md');
  const oversized = oversizedCore(memoryRoot);
  const proposal = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'compact-core-index',
  );
  assert.ok(proposal);
  const journal = repairJournalPaths(runtime, proposal.proposalId);
  const drifted = oversized.replace('identity label', 'user changed label');
  const options: RepairOptions = {
    beforeRevalidate: () => {
      writeFileSync(core, drifted);
      chmodSync(core, 0o640);
    },
  };

  assert.throws(
    () => applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo(), options),
    /proposal changed/i,
  );
  assert.equal(readFileSync(core, 'utf8'), drifted);
  assert.equal(statSync(core).mode & 0o777, 0o640);
  assert.equal(existsSync(journal.marker), false);
  assert.equal(existsSync(journal.backup), false);
});

test('interrupted recovery refuses target drift inside the locks and preserves all evidence', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-target-identity-');
  const { journal, target } = interruptedRepair(runtime, memoryRoot);
  const proposal = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'restore-interrupted-core-repair',
  );
  assert.ok(proposal);
  const options: RepairOptions = {
    beforeRevalidate: () => {
      writeFileSync(target, 'legitimate user edit after diagnosis\n');
      chmodSync(target, 0o640);
    },
  };

  assert.throws(
    () => applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo(), options),
    /proposal changed|target changed/i,
  );
  assert.equal(readFileSync(target, 'utf8'), 'legitimate user edit after diagnosis\n');
  assert.equal(statSync(target).mode & 0o777, 0o640);
  assert.equal(existsSync(journal.marker), true);
  assert.equal(existsSync(journal.backup), true);
});

test('interrupted recovery refuses backup drift inside the locks without changing the target', () => {
  const { project, runtime, memoryRoot } = fixture('harness-memory-repair-backup-identity-');
  const { journal, mutated, target } = interruptedRepair(runtime, memoryRoot);
  const proposal = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'restore-interrupted-core-repair',
  );
  assert.ok(proposal);
  const options: RepairOptions = {
    beforeRevalidate: () => writeFileSync(journal.backup, 'changed after diagnosis\n'),
  };

  assert.throws(
    () => applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo(), options),
    /proposal changed|backup.*changed/i,
  );
  assert.equal(readFileSync(target, 'utf8'), mutated);
  assert.equal(readFileSync(journal.backup, 'utf8'), 'changed after diagnosis\n');
  assert.equal(existsSync(journal.marker), true);
});
