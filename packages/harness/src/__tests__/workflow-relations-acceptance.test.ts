import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { initTask } from '../commands/task/task.js';
import { verifyAcceptance } from '../commands/task/task-verification.js';
import { renderHandoff } from '../lib/memory/memory-handoff.js';
import { assertAcceptanceEvidenceRole } from '../lib/workflow/workflow-relations.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('a Handoff recovery snapshot cannot satisfy file acceptance evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-handoff-evidence-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const task = initTask(
    runtime,
    { project, id: 'handoff-evidence', objective: 'Reject recovery state', acceptance: ['Proof'] },
    capturedIo(),
  );
  const memoryRoot = join(project, '.agent-docs');
  const handoff = join(memoryRoot, 'sessions', '2026', '09', '01', 'evidence-handoff.md');
  mkdirSync(dirname(handoff), { recursive: true });
  writeFileSync(
    handoff,
    renderHandoff(
      runtime,
      {
        session: 'evidence-handoff',
        title: 'Handoff evidence',
        objective: 'Resume this task.',
        completed: 'Captured recovery state.',
        next: 'Continue implementation.',
        reason: 'phase',
      },
      { sessionId: 'evidence-handoff', sessionBase: 'evidence-handoff', generation: 1 },
      memoryRoot,
      '2026-09-01',
      '2026-09-01',
    ),
  );

  assert.throws(
    () => assertAcceptanceEvidenceRole(project, handoff),
    /handoff.*recovery.*acceptance evidence/i,
  );
  assert.throws(
    () =>
      verifyAcceptance(
        {
          project,
          id: task.id,
          criterion: 'criterion-1',
          type: 'file',
          file: handoff,
        },
        capturedIo(),
      ),
    /handoff.*recovery.*acceptance evidence/i,
  );
});
