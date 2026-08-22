import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { closeTask, initTask, taskStatus, updateAcceptance } from '../commands/task.js';
import { verifyAcceptance } from '../commands/task-verification.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function projectFixture(): { project: string; runtime: ReturnType<typeof harnessRuntime> } {
  const root = mkdtempSync(join(tmpdir(), 'harness-task-record-boundary-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { project: root, runtime: harnessRuntime(root) };
}

function verifyTest(project: string, id: string) {
  return verifyAcceptance(
    {
      project,
      id,
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      scope: ['.gitignore'],
    },
    capturedIo(),
  );
}

test('external evidence scans decoded JSON values before persistence', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'escaped-secret', objective: 'Reject escaped secrets', acceptance: ['Proof'] },
    capturedIo(),
  );
  const decodedSecret = ['gh', 'p_', 'A'.repeat(24)].join('');
  const encodedEvidence =
    '{"type":"observation","tool":"human","result":"\\u0067hp_AAAAAAAAAAAAAAAAAAAAAAAA"}';

  assert.throws(
    () =>
      updateAcceptance(
        {
          project,
          id: 'escaped-secret',
          criterion: 'criterion-1',
          status: 'inconclusive',
          evidence: [encodedEvidence],
        },
        capturedIo(),
      ),
    /secret material/i,
  );
  const taskPath = join(project, '.agent-docs', 'working', 'escaped-secret', 'task.json');
  assert.equal(readFileSync(taskPath, 'utf8').includes(decodedSecret), false);
});

test('legacy tasks reject duplicate acceptance identifiers that cannot be addressed safely', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    {
      project,
      id: 'legacy-duplicate-criteria',
      objective: 'Reject ambiguous criteria',
      acceptance: ['First', 'Second'],
    },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', created.id, 'task.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        ...created,
        schemaVersion: 1,
        acceptance: created.acceptance.map((criterion) => ({
          ...criterion,
          id: 'duplicate',
          evidence: [],
        })),
      },
      null,
      2,
    )}\n`,
  );

  assert.throws(
    () => taskStatus({ project, id: created.id }, capturedIo()),
    /duplicate acceptance criterion id: duplicate/i,
  );
});

test('task records accept a project-root alias and normalize it to the active root', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-task-root-alias-'));
  onTestFinished(() => rmSync(sandbox, { recursive: true, force: true }));
  const project = join(sandbox, 'project');
  const alias = join(sandbox, 'project-alias');
  mkdirSync(project);
  symlinkSync(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const created = initTask(
    harnessRuntime(sandbox),
    { project, id: 'root-alias', objective: 'Resume through an alias', acceptance: ['Proof'] },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', created.id, 'task.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.projectRoot = alias;
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);

  const loaded = taskStatus({ project, id: created.id }, capturedIo());
  if (Array.isArray(loaded)) throw new Error('Expected one task');
  assert.equal(loaded.projectRoot, realpathSync.native(project));
});

test('task records reject a project root copied from another directory', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-task-root-copy-'));
  onTestFinished(() => rmSync(sandbox, { recursive: true, force: true }));
  const project = join(sandbox, 'project');
  const copiedRoot = join(sandbox, 'copied-project');
  mkdirSync(project);
  mkdirSync(copiedRoot);
  const created = initTask(
    harnessRuntime(sandbox),
    { project, id: 'copied-root', objective: 'Reject copied roots', acceptance: ['Proof'] },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', created.id, 'task.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.projectRoot = copiedRoot;
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);

  assert.throws(
    () => taskStatus({ project, id: created.id }, capturedIo()),
    /projectRoot .* does not match/i,
  );
});

test('mechanical evidence accepts a cwd alias for the same project root', () => {
  const { project, runtime } = projectFixture();
  const alias = `${project}-alias`;
  onTestFinished(() => rmSync(alias, { recursive: true, force: true }));
  symlinkSync(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  initTask(
    runtime,
    { project, id: 'cwd-alias', objective: 'Accept equivalent cwd', acceptance: ['Proof'] },
    capturedIo(),
  );
  const verified = verifyTest(project, 'cwd-alias');
  const path = join(project, '.agent-docs', 'working', verified.id, 'task.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.acceptance[0].evidence[0].cwd = alias;
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);

  assert.equal(
    closeTask({ project, id: verified.id, summary: 'Equivalent proof' }).status,
    'complete',
  );
});

test('mechanical evidence rejects a cwd copied from another directory', () => {
  const { project, runtime } = projectFixture();
  const copiedRoot = `${project}-copy`;
  onTestFinished(() => rmSync(copiedRoot, { recursive: true, force: true }));
  mkdirSync(copiedRoot);
  initTask(
    runtime,
    { project, id: 'cwd-copy', objective: 'Reject copied cwd', acceptance: ['Proof'] },
    capturedIo(),
  );
  const verified = verifyTest(project, 'cwd-copy');
  const path = join(project, '.agent-docs', 'working', verified.id, 'task.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.acceptance[0].evidence[0].cwd = copiedRoot;
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);

  assert.throws(
    () => closeTask({ project, id: verified.id, summary: 'Copied proof' }),
    /stale or non-passing evidence/i,
  );
});
