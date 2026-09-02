import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { initProject } from '../commands/init.js';
import { initTask } from '../commands/task/task.js';
import { workflowRelations } from '../commands/workflow/workflow-relations.js';
import { buildWorkflowRelationReport } from '../lib/workflow/workflow-relations.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('relation model reports owners, lifecycle roles, orphans, and cross-workstream conflicts', () => {
  const report = buildWorkflowRelationReport(
    [
      { id: 'task-a', status: 'in_progress' },
      { id: 'task-b', status: 'in_progress' },
    ],
    [
      {
        reference: 'memory:shared',
        type: 'working-note',
        kind: 'working',
        status: 'active',
        workstream: 'task-a',
        sourceRefs: ['task:task-a', 'task:task-b'],
      },
      {
        reference: 'memory:handoff',
        type: 'session-handoff',
        kind: 'episode',
        status: 'active',
        taskId: 'task-a',
        workstream: 'different-stream',
        session: 'session-a',
        sourceRefs: ['task:task-a'],
      },
      {
        reference: 'memory:orphan',
        type: 'working-note',
        kind: 'working',
        status: 'active',
        sourceRefs: ['task:missing-task'],
      },
    ],
  );

  assert.equal(report.version, 1);
  assert.equal(report.mode, 'report-only');
  assert.deepEqual(report.tasks[0], {
    task: 'task-a',
    workstream: 'task-a',
    phase: 'task-a:phase:current',
    status: 'in_progress',
  });
  assert.deepEqual(report.memory.find(({ reference }) => reference === 'memory:shared')?.owners, [
    'task:task-a',
    'task:task-b',
    'workstream:task-a',
  ]);
  assert.equal(
    report.memory.find(({ reference }) => reference === 'memory:handoff')?.lifecycleRole,
    'recovery-state',
  );
  assert.ok(report.conflicts.some(({ code }) => code === 'orphan-task-reference'));
  assert.ok(report.conflicts.some(({ code }) => code === 'cross-workstream-binding'));
});

test('workflow relation CLI emits the shared model without mutating project state', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-workflow-relations-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  initTask(
    runtime,
    { project, id: 'relation-task', objective: 'Inspect relations', acceptance: ['Report exists'] },
    capturedIo(),
  );
  const before = execFileSync('git', ['-C', project, 'status', '--porcelain']).toString();
  const io = capturedIo();

  const report = workflowRelations(runtime, project, { json: true }, io);

  assert.equal(report.tasks[0].task, 'relation-task');
  assert.equal(JSON.parse(io.logs[0]).mode, 'report-only');
  assert.equal(execFileSync('git', ['-C', project, 'status', '--porcelain']).toString(), before);

  const cli = capturedIo();
  assert.equal(runCli(['memory', 'relationships', project, '--json'], { runtime, io: cli }), 0);
  assert.equal(JSON.parse(cli.logs[0]).summary.tasks, 1);
});

test('workflow relation schema is packaged with the CLI contract', () => {
  const schema = JSON.parse(
    readFileSync(
      join(process.cwd(), 'template/agent-harness/schemas/workflow-relations.schema.json'),
      'utf8',
    ),
  );
  assert.equal(schema.$id, 'urn:agent-harness:schema:workflow-relations:v1');
});
