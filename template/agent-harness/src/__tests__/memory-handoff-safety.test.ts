import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
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

test('Closing a handoff removes its reference only from Recent Handoffs', () => {
  const { project, runtime } = fixture('harness-handoff-close-section-');
  const options = {
    title: 'Section-scoped handoff',
    objective: 'Preserve unrelated core routes.',
    completed: 'Created a recovery snapshot.',
    next: 'Close one snapshot.',
    reason: 'phase' as const,
  };
  const first = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...options, session: 'section-thread-1' },
    capturedIo(),
  );
  const second = memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...options, session: 'section-thread-2' },
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  const withOtherRoutes = readFileSync(corePath, 'utf8')
    .replace('## Active Work\n', `## Active Work\n\n- historical route ${first.reference}\n`)
    .replace(`；${first.reference}`, `；${first.reference} related ${second.reference}`);
  writeFileSync(corePath, withOtherRoutes);

  memoryAutopilot.closeHandoff(runtime, project, { session: 'section-thread-1' }, capturedIo());

  const core = readFileSync(corePath, 'utf8');
  const activeWork = core.slice(
    core.indexOf('## Active Work'),
    core.indexOf('## Important Inputs'),
  );
  const recent = core.slice(core.indexOf('## Recent Handoffs'));
  assert.match(activeWork, new RegExp(first.reference));
  assert.doesNotMatch(recent, new RegExp(first.reference));
  assert.match(recent, new RegExp(second.reference));
});

test('Handoff updates preserve nested headings and extension metadata', () => {
  const { project, runtime } = fixture('harness-handoff-extension-metadata-');
  const base = {
    session: 'nested-handoff',
    title: 'Nested recovery facts',
    objective: 'Preserve structured recovery content.',
    completed: 'Captured the first phase.',
    facts: 'First fact.\n\n# Nested heading\n\nSecond fact.',
    next: 'Continue the work.',
    reason: 'phase' as const,
  };
  const created = memoryAutopilot.captureHandoff(runtime, project, base, capturedIo());
  writeFileSync(
    created.path,
    readFileSync(created.path, 'utf8').replace(
      'snapshot-mode: replace\n',
      'snapshot-mode: replace\nrequest-id: req-123\nagent: host-agent\n',
    ),
  );

  memoryAutopilot.captureHandoff(
    runtime,
    project,
    { ...base, facts: undefined, completed: 'Captured the second phase.' },
    capturedIo(),
  );

  const content = readFileSync(created.path, 'utf8');
  assert.match(content, /# 已确认事实\n\nFirst fact\.\n\n# Nested heading\n\nSecond fact\./);
  assert.match(content, /^request-id: req-123$/m);
  assert.match(content, /^agent: host-agent$/m);
  assert.throws(
    () =>
      memoryAutopilot.captureHandoff(
        runtime,
        project,
        { ...base, facts: 'Safe fact.\n# 下一步\nInjected action.' },
        capturedIo(),
      ),
    /canonical section heading/i,
  );
  assert.throws(
    () =>
      memoryAutopilot.captureHandoff(
        runtime,
        project,
        { ...base, facts: 'Safe fact.\n# 下一步 #\nInjected action.' },
        capturedIo(),
      ),
    /canonical section heading/i,
  );
});

test('Identical handoff state does not refresh observational dates', () => {
  const { project, runtime } = fixture('harness-handoff-date-idempotency-');
  const options = {
    session: 'date-stable-handoff',
    title: 'Date-stable handoff',
    objective: 'Avoid false daily changes.',
    completed: 'Captured the same state.',
    next: 'Wait for a material change.',
    reason: 'phase' as const,
  };
  const created = memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  const priorDateContent = readFileSync(created.path, 'utf8')
    .replace(/^created: .*$/m, 'created: 2000-01-01')
    .replace(/^updated: .*$/m, 'updated: 2000-01-02');
  writeFileSync(created.path, priorDateContent);

  const repeated = memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());

  assert.equal(repeated.action, 'unchanged');
  assert.equal(readFileSync(created.path, 'utf8'), priorDateContent);
});

test('Unchanged handoff capture still validates unrelated managed memory', () => {
  const { project, runtime } = fixture('harness-handoff-unchanged-validation-');
  const options = {
    session: 'validated-unchanged-handoff',
    title: 'Validated unchanged handoff',
    objective: 'Keep the managed root healthy.',
    completed: 'Captured a valid snapshot.',
    next: 'Repeat without material changes.',
    reason: 'phase' as const,
  };
  memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  writeFileSync(join(project, '.agent-docs', 'bad.md'), 'missing frontmatter\n');

  assert.throws(
    () => memoryAutopilot.captureHandoff(runtime, project, options, capturedIo()),
    /memory check failed/i,
  );
});

test('typed handoff source references protect their memory target from archival', () => {
  const { project, runtime } = fixture('harness-handoff-source-reference-');
  initProject(runtime, project, capturedIo());
  const target = join(project, '.agent-docs', 'evidence.md');
  writeFileSync(
    target,
    `---
title: Referenced evidence
description: Evidence retained by a typed handoff
type: project-note
memory-kind: evidence
status: complete
owners: [test-owner]
created: 2026-08-25
updated: 2026-08-25
project: project
tags: [test]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---

Verified evidence.
`,
  );
  memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'source-reference-handoff',
      title: 'Source reference handoff',
      objective: 'Keep recovery provenance intact.',
      completed: 'Captured the evidence reference.',
      next: 'Resume from the referenced evidence.',
      reason: 'phase',
      sourceRefs: ['memory:evidence'],
    },
    capturedIo(),
  );

  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
  assert.throws(
    () => archiveMemory(runtime, project, 'evidence', {}, capturedIo()),
    /still referenced/i,
  );
});

test('handoff identity rejects case-folded filename collisions without writing', () => {
  const { project, runtime } = fixture('harness-handoff-case-collision-');
  const options = {
    session: 'case-collision',
    title: 'Case collision',
    objective: 'Protect an existing session file.',
    completed: 'Created the baseline.',
    next: 'Detect a filename collision.',
    reason: 'phase' as const,
  };
  const created = memoryAutopilot.captureHandoff(runtime, project, options, capturedIo());
  const uppercasePath = join(created.path, '..', 'CASE-COLLISION.md');
  renameSync(created.path, uppercasePath);
  const foreign = readFileSync(uppercasePath, 'utf8').replace(
    'session-id: case-collision',
    'session-id: foreign-session',
  );
  writeFileSync(uppercasePath, foreign);

  assert.throws(
    () => memoryAutopilot.captureHandoff(runtime, project, options, capturedIo()),
    /filename collision/i,
  );
  assert.equal(readFileSync(uppercasePath, 'utf8'), foreign);
});

test('handoff identity rejects a non-handoff document with the same session id', () => {
  const { project, runtime } = fixture('harness-handoff-type-collision-');
  initProject(runtime, project, capturedIo());
  const path = join(project, '.agent-docs', 'sessions', 'unrelated.md');
  mkdirSync(join(project, '.agent-docs', 'sessions'), { recursive: true });
  const unrelated = `---
title: Unrelated working note
description: Must not become a handoff
type: project-note
memory-kind: working
status: active
owners: [test-owner]
created: 2026-08-19
updated: 2026-08-19
project: project
tags: [test]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
expires: 2026-08-26
session-id: collision-id
---

# Preserve me
`;
  writeFileSync(path, unrelated);
  const corePath = join(project, '.agent-docs', 'core.md');
  const originalCore = readFileSync(corePath, 'utf8');

  assert.throws(
    () =>
      memoryAutopilot.captureHandoff(
        runtime,
        project,
        {
          session: 'collision-id',
          title: 'Type collision',
          objective: 'Preserve an unrelated memory document.',
          completed: 'Detected the collision.',
          next: 'Choose another session id.',
          reason: 'phase',
        },
        capturedIo(),
      ),
    /handoff identity collision/i,
  );
  assert.equal(readFileSync(path, 'utf8'), unrelated);
  assert.equal(readFileSync(corePath, 'utf8'), originalCore);
});

test('handoff identity rejects a case-folded legacy session collision', () => {
  const { project, runtime } = fixture('harness-handoff-session-case-collision-');
  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'legacy-id',
      title: 'Legacy portable identity',
      objective: 'Preserve the original workstream identity.',
      completed: 'Created the legacy fixture.',
      next: 'Reject a case-folded collision.',
      reason: 'phase',
    },
    capturedIo(),
  );
  const legacyPath = join(dirname(created.path), 'legacy.md');
  const legacy = readFileSync(created.path, 'utf8')
    .replace('session-id: legacy-id', 'session-id: Foo')
    .replace(/^snapshot-mode: replace\n/m, '');
  renameSync(created.path, legacyPath);
  writeFileSync(legacyPath, legacy);
  const corePath = join(project, '.agent-docs', 'core.md');
  const originalCore = readFileSync(corePath, 'utf8').replace(
    created.reference,
    created.reference.replace(/legacy-id$/, 'legacy'),
  );
  writeFileSync(corePath, originalCore);

  assert.throws(
    () =>
      memoryAutopilot.captureHandoff(
        runtime,
        project,
        {
          session: 'foo',
          title: 'Portable identity collision',
          objective: 'Do not create a second portable-equivalent workstream.',
          completed: 'Detected the collision.',
          next: 'Choose a distinct session id.',
          reason: 'phase',
        },
        capturedIo(),
      ),
    /handoff identity collision/i,
  );
  assert.equal(readFileSync(legacyPath, 'utf8'), legacy);
  assert.equal(readFileSync(corePath, 'utf8'), originalCore);
  assert.equal(existsSync(join(dirname(created.path), 'foo.md')), false);
});

test('closing a handoff removes a case-folded active reference alias', () => {
  const { project, runtime } = fixture('harness-handoff-case-reference-');
  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'case-reference',
      title: 'Case reference',
      objective: 'Remove portable aliases from the active index.',
      completed: 'Created the snapshot.',
      next: 'Close it.',
      reason: 'phase',
    },
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  const alias = `memory:${created.reference.slice('memory:'.length).toUpperCase()}`;
  writeFileSync(corePath, readFileSync(corePath, 'utf8').replace(created.reference, alias));

  memoryAutopilot.closeHandoff(runtime, project, { session: 'case-reference' }, capturedIo());

  assert.doesNotMatch(
    readFileSync(corePath, 'utf8').toLowerCase(),
    /memory:sessions\/.*case-reference/,
  );
});

test('closing a handoff removes a dot-segment active reference alias', () => {
  const { project, runtime } = fixture('harness-handoff-dot-reference-');
  const created = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session: 'dot-reference',
      title: 'Dot reference',
      objective: 'Repair a non-canonical active route.',
      completed: 'Created the snapshot.',
      next: 'Close it.',
      reason: 'phase',
    },
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  const alias = created.reference.replace('memory:sessions/', 'memory:./sessions/');
  writeFileSync(corePath, readFileSync(corePath, 'utf8').replace(created.reference, alias));

  memoryAutopilot.closeHandoff(runtime, project, { session: 'dot-reference' }, capturedIo());

  assert.doesNotMatch(readFileSync(corePath, 'utf8'), /memory:\.\/sessions\/.*dot-reference/);
});

test('handoff session ids are portable and cannot collide with reference extensions', () => {
  const { project, runtime } = fixture('harness-handoff-portable-session-');
  const base = {
    title: 'Portable session id',
    objective: 'Keep filenames portable and references unambiguous.',
    completed: 'Defined the boundary.',
    next: 'Reject the invalid session.',
    reason: 'phase' as const,
  };

  for (const session of [
    'thread.md',
    'con',
    'prn.report',
    'aux',
    'nul',
    'com1',
    'lpt9',
    'trailing.',
  ]) {
    assert.throws(
      () => memoryAutopilot.captureHandoff(runtime, project, { ...base, session }, capturedIo()),
      /invalid portable session id/i,
    );
  }
});
