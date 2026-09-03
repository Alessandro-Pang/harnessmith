import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { root, project, runtime: harnessRuntime(root) };
}

test('capture-input reads untrusted text from a file without marking a summary as verbatim', () => {
  const { root, project, runtime } = fixture('harness-memory-input-file-');
  const contentFile = join(root, 'input.txt');
  const marker = join(root, 'must-not-run');
  const content = `literal "quotes" and $(touch ${marker}) and \`id\``;
  writeFileSync(contentFile, content);
  const io = capturedIo();

  assert.equal(
    runCli(
      [
        'memory',
        'capture-input',
        project,
        '--title',
        'Safe payload',
        '--content-file',
        contentFile,
        '--source',
        'chat',
        '--mode',
        'summary',
        '--purpose',
        'acceptance',
        '--retention',
        'durable',
        '--json',
      ],
      { runtime, io },
    ),
    0,
  );

  const result = JSON.parse(io.logs[0]);
  const stored = readFileSync(result.path, 'utf8');
  assert.match(stored, /^verbatim: false$/m);
  assert.match(stored, /# 可靠摘要/);
  assert.ok(stored.includes(content));
  assert.equal(existsSync(marker), false);
});

test('capture-input requires an explicit mode, purpose, and retention policy', () => {
  const { project, runtime } = fixture('harness-memory-input-policy-');
  const missingPolicy = capturedIo();

  assert.throws(
    () =>
      runCli(
        [
          'memory',
          'capture-input',
          project,
          '--title',
          'Ambiguous input',
          '--content',
          'Keep this input.',
          '--source',
          'chat',
        ],
        { runtime, io: missingPolicy },
      ),
    /mode|required/i,
  );

  const missingWorkstream = capturedIo();
  assert.throws(
    () =>
      runCli(
        [
          'memory',
          'capture-input',
          project,
          '--title',
          'Scoped acceptance',
          '--content',
          'Only change the memory input lifecycle.',
          '--source',
          'chat',
          '--mode',
          'verbatim',
          '--purpose',
          'acceptance',
          '--retention',
          'workstream',
        ],
        { runtime, io: missingWorkstream },
      ),
    /workstream.*required/i,
  );
});

test('capture-input stores typed policy metadata and close-input consumes it from core', () => {
  const { project, runtime } = fixture('harness-memory-input-close-');
  const createdIo = capturedIo();

  assert.equal(
    runCli(
      [
        'memory',
        'capture-input',
        project,
        '--title',
        'Release risk decision',
        '--content',
        'Accept the host evaluation risk for this release.',
        '--source',
        'chat',
        '--mode',
        'verbatim',
        '--purpose',
        'risk-decision',
        '--retention',
        'workstream',
        '--workstream',
        'release-0-7-1',
        '--json',
      ],
      { runtime, io: createdIo },
    ),
    0,
  );
  const created = JSON.parse(createdIo.logs[0]);
  const input = readFileSync(created.path, 'utf8');
  assert.match(input, /^input-schema-version: 2$/m);
  assert.match(input, /^document-purpose-schema-version: 1$/m);
  assert.match(input, /^input-purpose: risk-decision$/m);
  assert.match(input, /^retention: workstream$/m);
  assert.match(input, /^workstream: release-0-7-1$/m);
  assert.match(input, /^verbatim: true$/m);

  const closedIo = capturedIo();
  assert.equal(
    runCli(
      [
        'memory',
        'close-input',
        project,
        created.reference,
        '--reason',
        'workstream-complete',
        '--evidence-ref',
        'release:0.7.1',
        '--json',
      ],
      { runtime, io: closedIo },
    ),
    0,
  );
  const closed = readFileSync(created.path, 'utf8');
  assert.match(closed, /^status: complete$/m);
  assert.match(closed, /^close-reason: workstream-complete$/m);
  assert.match(closed, /^consumed-by: release:0\.7\.1$/m);
  assert.doesNotMatch(
    readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8'),
    new RegExp(created.reference),
  );
});

test('handoff preserves omitted recovery fields, clears them explicitly, and closes cleanly', () => {
  const { project, runtime } = fixture('harness-memory-handoff-contract-');
  const base = [
    'memory',
    'handoff',
    project,
    '--session',
    'stable-workstream',
    '--title',
    'Stable workstream',
    '--objective',
    'Finish the change.',
    '--completed',
    'Stage one passed.',
    '--next',
    'Implement stage two.',
    '--reason',
    'phase',
    '--json',
  ];
  const created = capturedIo();
  assert.equal(
    runCli(
      [
        ...base,
        '--facts',
        'The public contract is stable.',
        '--decisions',
        'Keep replacement snapshots.',
        '--verification',
        'Focused tests passed.',
        '--open',
        'Full verification remains.',
        '--scope',
        'packages/cli/src/feature.ts',
        '--source-ref',
        'docs/contract.md',
        '--status',
        'blocked',
      ],
      { runtime, io: created },
    ),
    0,
  );
  const handoffPath = JSON.parse(created.logs[0]).path;

  const updated = capturedIo();
  assert.equal(
    runCli(
      base.map((value) => (value === 'Stage one passed.' ? 'Stages one and two passed.' : value)),
      { runtime, io: updated },
    ),
    0,
  );
  const preserved = readFileSync(handoffPath, 'utf8');
  assert.match(preserved, /# 已确认事实\n\nThe public contract is stable/);
  assert.match(preserved, /# 关键决策\n\nKeep replacement snapshots/);
  assert.match(preserved, /# 验证证据\n\nFocused tests passed/);
  assert.match(preserved, /# 未解决事项\n\nFull verification remains/);
  assert.match(preserved, /^scope:\n {2}- packages\/cli\/src\/feature\.ts$/m);
  assert.match(preserved, /^source-refs:\n {2}- docs\/contract\.md$/m);
  assert.match(preserved, /^status: blocked$/m);

  const cleared = capturedIo();
  assert.equal(
    runCli([...base, '--clear-decisions', '--clear-open', '--clear-scope', '--clear-source-refs'], {
      runtime,
      io: cleared,
    }),
    0,
  );
  const compacted = readFileSync(handoffPath, 'utf8');
  assert.doesNotMatch(compacted, /# 关键决策|# 未解决事项/);
  assert.match(compacted, /# 已确认事实|# 验证证据/);
  assert.match(compacted, /^scope: \[\]$/m);
  assert.match(compacted, /^source-refs: \[\]$/m);

  const closed = capturedIo();
  assert.equal(
    runCli(
      [
        'memory',
        'close-handoff',
        project,
        '--session',
        'stable-workstream',
        '--outcome',
        'cancelled',
        '--json',
      ],
      {
        runtime,
        io: closed,
      },
    ),
    0,
  );
  assert.match(readFileSync(handoffPath, 'utf8'), /^status: complete$/m);
  assert.doesNotMatch(
    readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8'),
    /memory:sessions\/.*stable-workstream/,
  );
});

test('profile reconciliation exposes an explicit forget command', () => {
  const { runtime } = fixture('harness-memory-profile-forget-');
  assert.equal(
    runCli(
      [
        'memory',
        'reconcile-profile',
        '--key',
        'communication.detail',
        '--conclusion',
        'Prefer concise answers.',
        '--evidence',
        'explicit',
        '--confidence',
        'high',
      ],
      { runtime, io: capturedIo() },
    ),
    0,
  );

  assert.equal(
    runCli(['memory', 'forget-profile', '--key', 'communication.detail', '--json'], {
      runtime,
      io: capturedIo(),
    }),
    0,
  );
  assert.doesNotMatch(
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
    /communication\.detail/,
  );
});

test('profile autopilot exposes explicit pause and resume controls', () => {
  const { runtime } = fixture('harness-memory-profile-pause-cli-');
  for (const state of ['pause', 'resume']) {
    const io = capturedIo();
    assert.equal(runCli(['memory', 'profile-autopilot', state, '--json'], { runtime, io }), 0);
    assert.equal(JSON.parse(io.logs[0]).kind, 'profile');
  }
  assert.match(
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
    /^profile-autopilot: enabled$/m,
  );
});
