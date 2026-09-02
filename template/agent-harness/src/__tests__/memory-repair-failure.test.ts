import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { applyMemoryRepair, diagnoseMemoryRepair } from '../commands/memory/memory-repair.js';
import { repairJournalPaths } from '../lib/memory/memory-repair-journal.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('repair never masks rollback failure and retains changed target plus exact recovery paths', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'harness-memory-repair-failure-'));
  onTestFinished(() => rmSync(fixture, { recursive: true, force: true }));
  const project = join(fixture, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(fixture);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const core = join(memoryRoot, 'core.md');
  const original = readFileSync(core, 'utf8');
  const entries: string[] = [];
  mkdirSync(join(memoryRoot, 'working'), { recursive: true });
  for (let index = 0; index < 70; index += 1) {
    const name = `working/failure-${index}`;
    writeFileSync(
      join(memoryRoot, `${name}.md`),
      `---\ntitle: Failure ${index}\ndescription: Repair failure fixture\ntype: working-note\nmemory-kind: working\nstatus: active\nowners: [test-owner]\ncreated: 2026-09-01\nupdated: 2026-09-01\nexpires: 2026-09-30\nproject: project\ntags: [repair]\nscope: []\nsource-refs: []\nsource-of-truth: false\nschema-version: 1\n---\n\n# Failure ${index}\n`,
    );
    entries.push(`- ${'long label '.repeat(36)}；memory:${name}`);
  }
  writeFileSync(
    core,
    original.replace('- <何时读取、能回答什么；创建后补充 memory 引用>', entries.join('\n')),
  );
  const proposal = diagnoseMemoryRepair(runtime, project, capturedIo()).proposals.find(
    ({ action }) => action === 'compact-core-index',
  );
  assert.ok(proposal);
  const journal = repairJournalPaths(runtime, proposal.proposalId);

  assert.throws(
    () =>
      applyMemoryRepair(runtime, project, proposal.proposalId, capturedIo(), {
        beforeVerify: () => {
          writeFileSync(core, 'concurrent user edit\n');
          throw new Error('injected concurrent change');
        },
      }),
    /rollback was incomplete.*recovery marker/is,
  );

  assert.equal(readFileSync(core, 'utf8'), 'concurrent user edit\n');
  assert.equal(existsSync(journal.marker), true);
  assert.equal(existsSync(journal.backup), true);
  const followup = diagnoseMemoryRepair(runtime, project, capturedIo());
  assert.ok(
    followup.unresolved.some(
      ({ fault, reasonCode }) =>
        fault === 'repair-transaction' && reasonCode === 'REPAIR_TARGET_CHANGED',
    ),
  );
  assert.equal(
    followup.proposals.some(({ action }) => action === 'restore-interrupted-core-repair'),
    false,
  );
});
