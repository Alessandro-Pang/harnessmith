import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initTask, taskStatus, updateAcceptance } from '../commands/task.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function projectFixture(): { project: string; runtime: ReturnType<typeof harnessRuntime> } {
  const root = mkdtempSync(join(tmpdir(), 'harness-task-record-boundary-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { project: root, runtime: harnessRuntime(root) };
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
