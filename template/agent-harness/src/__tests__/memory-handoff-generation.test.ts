import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { memoryCheck } from '../commands/memory.js';
import * as memoryAutopilot from '../commands/memory-autopilot.js';
import { archiveMemory } from '../commands/memory-lifecycle.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { project, runtime: harnessRuntime(root) };
}

test('an archived handoff remains historical when its base starts the next generation', () => {
  const { project, runtime } = fixture('harness-handoff-archive-continuation-');
  const options = {
    session: 'archived-workstream',
    title: 'Archived workstream',
    objective: 'Continue a host workstream without reviving its closed episode.',
    completed: 'Completed the first episode.',
    next: 'Close and archive the first episode.',
    reason: 'phase' as const,
  };
  const first = memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  writeFileSync(
    first.path,
    readFileSync(first.path, 'utf8')
      .replace(/^session-base: .+\n/m, '')
      .replace(/^handoff-generation: 1\n/m, ''),
  );
  memoryAutopilot.closeHandoff(runtime, project, { session: options.session }, capturedIo());
  const archived = archiveMemory(runtime, project, first.reference, {}, capturedIo());
  const archivedBytes = readFileSync(archived, 'utf8');

  const second = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      ...options,
      completed: 'Started a new episode after archival.',
      next: 'Continue the latest episode.',
    },
    capturedIo(),
  );

  assert.equal(second.action, 'created');
  assert.match(
    second.path.replaceAll('\\', '/'),
    /\/sessions\/\d{4}\/\d{2}\/\d{2}\/archived-workstream--g2\.md$/,
  );
  assert.equal(readFileSync(archived, 'utf8'), archivedBytes);
  assert.match(readFileSync(second.path, 'utf8'), /^status: active$/m);
  assert.match(readFileSync(second.path, 'utf8'), /^handoff-generation: 2$/m);

  const closed = memoryAutopilot.closeHandoff(
    runtime,
    project,
    { session: options.session },
    capturedIo(),
  );
  assert.equal(closed.path, second.path);
  assert.match(readFileSync(second.path, 'utf8'), /^status: complete$/m);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
});

test('a 100-character handoff base continues with a deterministic portable generation id', () => {
  const { project, runtime } = fixture('harness-handoff-long-generation-');
  const session = `a${'b'.repeat(99)}`;
  const options = {
    session,
    title: 'Long portable handoff base',
    objective: 'Continue a maximum-length host identity safely.',
    completed: 'Created the first generation.',
    next: 'Close and continue the workstream.',
    reason: 'phase' as const,
  };
  const first = memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  memoryAutopilot.closeHandoff(runtime, project, { session }, capturedIo());

  const second = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...options, completed: 'Created the second generation.' },
    capturedIo(),
  );
  const content = readFileSync(second.path, 'utf8');
  const generatedSession = content.match(/^session-id: (.+)$/m)?.[1];
  assert.ok(generatedSession);
  assert.ok(generatedSession.length <= 100);
  assert.match(generatedSession, /^[a-z0-9][a-z0-9._-]{2,99}$/);
  assert.notEqual(generatedSession, session);
  assert.match(content, new RegExp(`^session-base: ${session}$`, 'm'));
  assert.match(content, /^handoff-generation: 2$/m);
  assert.notEqual(second.path, first.path);

  const repeated = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...options, completed: 'Created the second generation.' },
    capturedIo(),
  );
  assert.equal(repeated.path, second.path);
  assert.equal(repeated.action, 'unchanged');
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
});

test('handoff generation identity cannot be claimed as another workstream base', () => {
  const { project, runtime } = fixture('harness-handoff-generation-collision-');
  const options = {
    session: 'generation-owner',
    title: 'Generation owner',
    objective: 'Keep generation identity bound to its original base.',
    completed: 'Created the first generation.',
    next: 'Create the next generation.',
    reason: 'phase' as const,
  };
  memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  memoryAutopilot.closeHandoff(runtime, project, { session: options.session }, capturedIo());
  const second = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...options, completed: 'Created the second generation.' },
    capturedIo(),
  );
  const before = readFileSync(second.path, 'utf8');

  assert.throws(
    () =>
      memoryAutopilot.captureHandoff(
        runtime,
        project,
        {
          ...options,
          session: 'generation-owner--g2',
          title: 'Colliding workstream',
        },
        capturedIo(),
      ),
    /handoff identity collision/i,
  );
  assert.equal(readFileSync(second.path, 'utf8'), before);
});

test('memory validation rejects multiple active generations for one handoff base', () => {
  const { project, runtime } = fixture('harness-handoff-generation-lifecycle-');
  const options = {
    session: 'single-active-generation',
    title: 'Single active generation',
    objective: 'Keep only the latest handoff generation active.',
    completed: 'Created the first generation.',
    next: 'Continue in a new generation.',
    reason: 'phase' as const,
  };
  const first = memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  memoryAutopilot.closeHandoff(runtime, project, { session: options.session }, capturedIo());
  memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...options, completed: 'Created the active second generation.' },
    capturedIo(),
  );
  writeFileSync(
    first.path,
    readFileSync(first.path, 'utf8').replace('status: complete', 'status: active'),
  );

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /multiple active handoff generations/i);
});

test('typed handoff validation enforces recovery metadata and canonical structure', () => {
  const { project, runtime } = fixture('harness-handoff-schema-marker-');
  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'typed-schema',
      title: 'Typed schema',
      objective: 'Keep recovery data valid.',
      completed: 'Created a valid handoff.',
      next: 'Validate tampering.',
      reason: 'phase',
    },
    capturedIo(),
  );
  const baseline = readFileSync(created.path, 'utf8');
  const legacyGenerationOne = baseline
    .replace(/^session-base: .+\n/m, '')
    .replace(/^handoff-generation: 1\n/m, '');
  writeFileSync(created.path, legacyGenerationOne);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
  for (const [name, content, expected] of [
    ['session id', baseline.replace(/^session-id: .+\n/m, ''), /session-id/i],
    ['session base', baseline.replace(/^session-base: .+\n/m, ''), /generation identity/i],
    [
      'generation',
      baseline.replace(/^handoff-generation: 1$/m, 'handoff-generation: 2'),
      /generation identity/i,
    ],
    [
      'checkpoint reason',
      baseline.replace(/^checkpoint-reason: .+$/m, 'checkpoint-reason: invalid'),
      /checkpoint-reason/i,
    ],
    [
      'queryability marker',
      baseline.replace(/^session-queryable: false$/m, 'session-queryable: true'),
      /session-queryable/i,
    ],
    ['next section', baseline.replace(/^# 下一步$/m, '# Missing next'), /下一步/],
  ] as const) {
    writeFileSync(created.path, content);
    const validation = capturedIo();
    assert.throws(() => memoryCheck(runtime, project, validation), /issue/i, name);
    assert.match(validation.errors.join('\n'), expected, name);
  }
});

test('typed handoff validation binds snapshots to the canonical sessions date tree', () => {
  const { project, runtime } = fixture('harness-handoff-canonical-tree-');
  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'canonical-tree',
      title: 'Canonical handoff tree',
      objective: 'Keep typed snapshots in their recovery namespace.',
      completed: 'Created the canonical snapshot.',
      next: 'Reject a moved typed snapshot.',
      reason: 'phase',
    },
    capturedIo(),
  );
  const moved = join(project, '.agent-docs', 'rogue.md');
  renameSync(created.path, moved);
  const core = join(project, '.agent-docs', 'core.md');
  writeFileSync(core, readFileSync(core, 'utf8').replace(created.reference, 'memory:rogue'));

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /typed handoff canonical path/i);
});

test('typed handoff validation binds the filename to its exact session id', () => {
  const { project, runtime } = fixture('harness-handoff-canonical-name-');
  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'canonical-name',
      title: 'Canonical handoff name',
      objective: 'Keep session identity and storage identity aligned.',
      completed: 'Created the canonical snapshot.',
      next: 'Reject a renamed typed snapshot.',
      reason: 'phase',
    },
    capturedIo(),
  );
  const moved = join(dirname(created.path), 'other-name.md');
  renameSync(created.path, moved);
  const core = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    core,
    readFileSync(core, 'utf8').replace(
      created.reference,
      created.reference.replace(/canonical-name$/, 'other-name'),
    ),
  );

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /typed handoff canonical path/i);
});
