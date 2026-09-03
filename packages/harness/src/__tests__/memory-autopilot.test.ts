import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { initGlobal } from '../commands/init.js';
import * as memoryAutopilot from '../commands/memory/memory-autopilot.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('Harness memory autopilot captures input and handoff with indexed documents', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-autopilot-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const nested = join(project, 'packages', 'feature');
  mkdirSync(nested, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);

  const input = capturedIo();
  assert.equal(
    runCli(
      [
        'memory',
        'capture-input',
        nested,
        '--title',
        'Autopilot preference',
        '--content',
        'Keep routine memory updates unobtrusive.',
        '--source',
        'chat',
        '--mode',
        'verbatim',
        '--purpose',
        'explicit-retain',
        '--retention',
        'durable',
        '--json',
      ],
      { runtime, io: input },
    ),
    0,
  );
  const inputResult = JSON.parse(input.logs[0]);
  assert.equal(inputResult.kind, 'input');
  assert.equal(existsSync(inputResult.path), true);
  assert.match(readFileSync(inputResult.path, 'utf8'), /^project: project$/m);

  const handoffArguments = [
    'memory',
    'handoff',
    project,
    '--session',
    '20260825-memory-autopilot',
    '--title',
    'Memory autopilot iteration',
    '--objective',
    'Implement low-noise memory capture.',
    '--completed',
    'Typed input capture is available.',
    '--decisions',
    'Use typed replacement snapshots.',
    '--open',
    'Profile reconciliation remains.',
    '--next',
    'Continue with profile reconciliation.',
    '--reason',
    'phase',
    '--json',
  ];
  const handoff = capturedIo();
  assert.equal(runCli(handoffArguments, { runtime, io: handoff }), 0);
  const handoffResult = JSON.parse(handoff.logs[0]);
  assert.equal(handoffResult.kind, 'episode');
  assert.equal(existsSync(handoffResult.path), true);

  const priorReference = 'memory:sessions/2000/01/02/20260825-memory-autopilot';
  const priorDayPath = join(project, '.agent-docs', `${priorReference.slice('memory:'.length)}.md`);
  mkdirSync(dirname(priorDayPath), { recursive: true });
  renameSync(handoffResult.path, priorDayPath);
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    readFileSync(corePath, 'utf8').replace(handoffResult.reference, priorReference),
  );

  const compactedArguments = [
    'memory',
    'handoff',
    project,
    '--session',
    '20260825-memory-autopilot',
    '--title',
    'Memory autopilot iteration',
    '--objective',
    'Finish low-noise memory capture.',
    '--completed',
    'Input capture and profile reconciliation are available.',
    '--open',
    'Run the full verification suite.',
    '--next',
    'Run preflight.',
    '--reason',
    'compaction',
    '--json',
  ];
  const updatedHandoff = capturedIo();
  assert.equal(runCli(compactedArguments, { runtime, io: updatedHandoff }), 0);
  const updatedResult = JSON.parse(updatedHandoff.logs[0]);
  assert.equal(updatedResult.action, 'updated');
  assert.equal(realpathSync.native(updatedResult.path), realpathSync.native(priorDayPath));
  const snapshot = readFileSync(priorDayPath, 'utf8');
  assert.match(snapshot, /^checkpoint-reason: compaction$/m);
  assert.match(snapshot, /Input capture and profile reconciliation are available/);
  assert.match(snapshot, /# 未解决事项\n\nRun the full verification suite/);
  assert.match(snapshot, /# 关键决策\n\nUse typed replacement snapshots/);

  const repeatedHandoff = capturedIo();
  assert.equal(runCli(compactedArguments, { runtime, io: repeatedHandoff }), 0);
  assert.equal(JSON.parse(repeatedHandoff.logs[0]).action, 'unchanged');
  assert.equal(runCli(['memory', 'check', project, '--indexed'], { runtime, io: capturedIo() }), 0);
});

test('Harness memory autopilot reconciles explicit profile signals in place', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-profile-autopilot-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());

  for (const conclusion of [
    'Prefer quiet memory capture.',
    'Prefer automatic quiet memory capture.',
  ]) {
    assert.equal(
      runCli(
        [
          'memory',
          'reconcile-profile',
          '--key',
          'collaboration.memory-autopilot',
          '--conclusion',
          conclusion,
          '--evidence',
          'explicit',
          '--confidence',
          'high',
          '--json',
        ],
        { runtime, io: capturedIo() },
      ),
      0,
    );
  }

  const profilePath = join(runtime.memoryHome, 'profile.md');
  const profile = readFileSync(profilePath, 'utf8');
  assert.equal(profile.match(/collaboration\.memory-autopilot/g)?.length, 1);
  assert.match(profile, /Prefer automatic quiet memory capture/);
  assert.throws(
    () =>
      runCli(
        [
          'memory',
          'reconcile-profile',
          '--key',
          'collaboration.speculation',
          '--conclusion',
          'Maybe prefers speculative changes.',
          '--evidence',
          'observed',
          '--confidence',
          'low',
        ],
        { runtime, io: capturedIo() },
      ),
    /requires explicit evidence with high confidence/,
  );
  assert.doesNotMatch(readFileSync(profilePath, 'utf8'), /speculation/);
  assert.equal(
    runCli(['memory', 'check', 'global', '--indexed'], { runtime, io: capturedIo() }),
    0,
  );
});

test('Handoff snapshots preserve recovery fields unless an update explicitly clears them', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-handoff-reconcile-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);

  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'stable-host-thread-123',
      title: 'Recoverable workstream',
      objective: 'Keep the current work recoverable.',
      completed: 'Implemented the first phase.',
      facts: 'The repository uses pnpm.',
      decisions: 'Keep writes local and atomic.',
      verification: 'Focused tests passed: 12/12.',
      open: 'The host evaluation is pending.',
      next: 'Run the host evaluation.',
      reason: 'phase',
      scope: ['packages/harness/src'],
      sourceRefs: ['docs/architecture.md'],
    },
    capturedIo(),
  );

  memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'stable-host-thread-123',
      title: 'Recoverable workstream',
      objective: 'Keep the current work recoverable.',
      completed: 'Implemented the second phase.',
      next: 'Run the full verification suite.',
      reason: 'multi-task',
      clearFacts: true,
      clearOpen: true,
    },
    capturedIo(),
  );

  const snapshot = readFileSync(created.path, 'utf8');
  assert.doesNotMatch(snapshot, /# 已确认事实|The repository uses pnpm/);
  assert.doesNotMatch(snapshot, /# 未解决事项|The host evaluation is pending/);
  assert.match(snapshot, /# 关键决策\n\nKeep writes local and atomic/);
  assert.match(snapshot, /# 验证证据\n\nFocused tests passed: 12\/12/);
  assert.match(snapshot, /scope:\n {2}- packages\/harness\/src/);
  assert.match(snapshot, /source-refs:\n {2}- docs\/architecture\.md/);
});

test('Handoff updates preserve blocked lifecycle until explicitly resumed', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-handoff-blocked-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  const base = {
    session: 'blocked-workstream',
    title: 'Blocked workstream',
    objective: 'Preserve lifecycle state.',
    completed: 'Captured the current blocker.',
    next: 'Wait for the dependency.',
    reason: 'phase' as const,
  };
  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...base, status: 'blocked' },
    capturedIo(),
  );

  memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...base, completed: 'Added recovery context.' },
    capturedIo(),
  );
  assert.match(readFileSync(created.path, 'utf8'), /^status: blocked$/m);

  memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...base, completed: 'The dependency arrived.', status: 'active' },
    capturedIo(),
  );
  assert.match(readFileSync(created.path, 'utf8'), /^status: active$/m);
});

test('Closing a handoff completes the document and the same base continues in a new generation', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-handoff-close-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  const base = {
    title: 'Prefix-safe handoff',
    objective: 'Test exact lifecycle updates.',
    completed: 'Created an active snapshot.',
    next: 'Close the snapshot.',
    reason: 'phase' as const,
  };
  const first = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...base, session: 'thread-1' },
    capturedIo(),
  );
  const second = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...base, session: 'thread-10' },
    capturedIo(),
  );

  const result = memoryAutopilot.closeHandoff(
    runtime,
    project,
    { session: 'thread-1', outcome: 'cancelled', json: true },
    capturedIo(),
  );

  assert.equal(result.action, 'updated');
  const completed = readFileSync(first.path, 'utf8');
  assert.match(completed, /^status: complete$/m);
  assert.match(completed, /# 下一步\n\nClose the snapshot\./);
  assert.match(readFileSync(second.path, 'utf8'), /^status: active$/m);
  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  assert.doesNotMatch(core, new RegExp(`${first.reference}(?:\\s|$)`));
  assert.match(core, new RegExp(`${second.reference}(?:\\s|$)`));
  assert.equal(runCli(['memory', 'check', project, '--indexed'], { runtime, io: capturedIo() }), 0);
  const completedFirst = readFileSync(first.path, 'utf8');
  const continued = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      ...base,
      session: 'thread-1',
      completed: 'Started the next task in the same host thread.',
      next: 'Continue the new task.',
    },
    capturedIo(),
  );
  assert.equal(continued.action, 'created');
  assert.notEqual(continued.path, first.path);
  assert.equal(basename(continued.path), 'thread-1--g2.md');
  const generationTwo = readFileSync(continued.path, 'utf8');
  assert.match(generationTwo, /^session-id: thread-1--g2$/m);
  assert.match(generationTwo, /^session-base: thread-1$/m);
  assert.match(generationTwo, /^handoff-generation: 2$/m);
  assert.equal(readFileSync(first.path, 'utf8'), completedFirst);

  const updated = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      ...base,
      session: 'thread-1',
      completed: 'Updated only the latest active generation.',
      next: 'Close the latest generation.',
    },
    capturedIo(),
  );
  assert.equal(updated.action, 'updated');
  assert.equal(updated.path, continued.path);
  assert.match(readFileSync(updated.path, 'utf8'), /Updated only the latest active generation/);

  const closedLatest = memoryAutopilot.closeHandoff(
    runtime,
    project,
    { session: 'thread-1', outcome: 'cancelled' },
    capturedIo(),
  );
  assert.equal(closedLatest.path, continued.path);
  assert.match(readFileSync(continued.path, 'utf8'), /^status: complete$/m);
  const third = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      ...base,
      session: 'thread-1',
      completed: 'Started the third episode.',
      next: 'Continue the third episode.',
    },
    capturedIo(),
  );
  assert.equal(basename(third.path), 'thread-1--g3.md');
  assert.match(readFileSync(third.path, 'utf8'), /^handoff-generation: 3$/m);
  assert.equal(runCli(['memory', 'check', project, '--indexed'], { runtime, io: capturedIo() }), 0);
});

test('Handoff session lookup rejects filename and metadata collisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-handoff-session-collision-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  const options = {
    session: 'host-thread-collision',
    title: 'Stable host thread',
    objective: 'Reuse one host-backed session id.',
    completed: 'Captured the first phase.',
    next: 'Continue the workstream.',
    reason: 'phase' as const,
  };
  const created = memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  writeFileSync(
    created.path,
    readFileSync(created.path, 'utf8').replace(
      'session-id: host-thread-collision',
      'session-id: different-host-thread',
    ),
  );

  assert.throws(
    () => memoryAutopilot.captureHandoff(runtime, project, options, capturedIo()),
    /Handoff filename collision/,
  );
});
