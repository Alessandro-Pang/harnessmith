import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { parseFrontmatter } from '../lib/frontmatter.js';
import type { HandoffOptions } from '../lib/memory-handoff.js';
import { assertHandoffOptions, reconcileHandoffOptions } from '../lib/memory-handoff.js';
import { handoffIdentityFromMetadata } from '../lib/memory-handoff-identity.js';

const base: HandoffOptions = {
  session: 'document-boundary',
  title: 'Document boundary',
  objective: 'Exercise handoff document validation boundaries.',
  completed: 'Prepared the handoff.',
  next: 'Continue validation.',
  reason: 'phase',
};

function activeDocument(body = ''): string {
  return `---
status: active
scope: [src]
source-refs: [memory:evidence]
---

${body}
`;
}

function legacyGenerationOneDocument(body: string): string {
  return `---
title: Legacy handoff
description: Legacy shipped session template fixture
type: session-handoff
memory-kind: episode
status: active
owners: [test-owner]
created: 2026-08-24
updated: 2026-08-24
tags: [handoff]
project: test-project
scope: [src]
source-refs: [memory:evidence]
source-of-truth: false
schema-version: 1
host-adapter: test-host
session-id: document-boundary
session-queryable: false
---

${body}
`;
}

test('handoff reconciliation rejects duplicate or non-canonical existing sections', () => {
  assert.throws(
    () =>
      reconcileHandoffOptions(
        base,
        activeDocument('# 已确认事实\n\nFirst.\n\n# 已确认事实\n\nSecond.'),
      ),
    /non-canonical or duplicate section heading/i,
  );
});

test('handoff reconciliation rejects conflicting clear and replacement values', () => {
  assert.throws(
    () => reconcileHandoffOptions({ ...base, facts: 'Replacement.', clearFacts: true }, ''),
    /facts cannot be supplied and cleared together/i,
  );
  assert.throws(
    () => reconcileHandoffOptions({ ...base, scope: ['src'], clearScope: true }, ''),
    /scope cannot be supplied and cleared together/i,
  );
});

test('changing a task-bound handoff requires the multi-task checkpoint reason', () => {
  const existing = legacyGenerationOneDocument('# Current goal\n\nResume.').replace(
    'session-id: document-boundary',
    'session-id: document-boundary\ntask-id: first-task',
  );
  assert.throws(
    () => reconcileHandoffOptions({ ...base, taskId: 'second-task', reason: 'phase' }, existing),
    /multi-task.*task transition/i,
  );
  assert.equal(
    reconcileHandoffOptions({ ...base, taskId: 'second-task', reason: 'multi-task' }, existing)
      .taskId,
    'second-task',
  );
});

test('handoff reconciliation requires explicit clear operations for blank values', () => {
  assert.throws(
    () => reconcileHandoffOptions({ ...base, facts: '  ' }, ''),
    /facts cannot be blank/i,
  );
  assert.throws(
    () => reconcileHandoffOptions({ ...base, sourceRefs: ['memory:evidence', ' '] }, ''),
    /source-refs entries must be non-empty strings/i,
  );
});

test('handoff option validation enforces required, bounded, and enumerated fields', () => {
  for (const [options, expected] of [
    [{ ...base, objective: '' }, /objective is required/i],
    [{ ...base, title: 'x'.repeat(201) }, /exceeds its length limit/i],
    [
      { ...base, reason: 'timer' as HandoffOptions['reason'] },
      /invalid handoff checkpoint reason/i,
    ],
    [{ ...base, status: 'complete' as HandoffOptions['status'] }, /invalid handoff status/i],
  ] as const) {
    assert.throws(() => assertHandoffOptions(options), expected);
  }
});

test('handoff reconciliation refuses to update a completed snapshot', () => {
  assert.throws(
    () =>
      reconcileHandoffOptions(base, activeDocument().replace('status: active', 'status: complete')),
    /cannot update complete handoff/i,
  );
});

test('handoff reconciliation preserves legacy unfinished and promotion sections when open is omitted', () => {
  const legacy = legacyGenerationOneDocument(`# 目标

Resume an older handoff.

# 已确认事实

Legacy fact.

# 已完成变更

Legacy completed work.

# 验证证据

Legacy verification.

# 未完成项与风险

Legacy unresolved risk.

# 下一步

Continue the legacy work.

# 需要提升或更新的正式文档

Promote the accepted decision to an ADR.`);

  assert.deepEqual(handoffIdentityFromMetadata(parseFrontmatter(legacy)), {
    sessionBase: 'document-boundary',
    generation: 1,
    sessionId: 'document-boundary',
  });
  const reconciled = reconcileHandoffOptions(base, legacy);

  assert.equal(reconciled.facts, 'Legacy fact.');
  assert.equal(reconciled.verification, 'Legacy verification.');
  assert.match(reconciled.open || '', /## 兼容保留：未完成项与风险\n\nLegacy unresolved risk\./);
  assert.match(
    reconciled.open || '',
    /## 兼容保留：需要提升或更新的正式文档\n\nPromote the accepted decision to an ADR\./,
  );
});

test('typed handoffs preserve legacy-named nested headings inside canonical sections', () => {
  const typed = activeDocument(`# 已确认事实

Current fact.

# 已完成变更

This heading is nested recovery content.`).replace(
    'status: active',
    'status: active\nsnapshot-mode: replace',
  );

  const reconciled = reconcileHandoffOptions(base, typed);

  assert.equal(
    reconciled.facts,
    'Current fact.\n\n# 已完成变更\n\nThis heading is nested recovery content.',
  );
});

test('the shipped session template uses the canonical typed handoff contract', () => {
  const template = readFileSync(
    join(import.meta.dirname, '..', '..', 'templates', 'project-agent-docs', 'session.md'),
    'utf8',
  );

  for (const metadata of [
    'session-base:',
    'handoff-generation: 1',
    'fact-class: recovery-state',
    'expiry-policy: handoff-lifecycle',
    'document-purpose: "<任务交接标题>"',
    'document-purpose-schema-version: 1',
    'checkpoint-reason:',
    'snapshot-mode: replace',
  ]) {
    assert.match(template, new RegExp(`^${metadata}`, 'm'));
  }
  const metadata = parseFrontmatter(template);
  assert.equal(metadata.get('session-base'), metadata.get('session-id'));
  for (const heading of ['# 当前目标', '# 已完成', '# 未解决事项', '# 下一步']) {
    assert.match(template, new RegExp(`^${heading}$`, 'm'));
  }
  assert.doesNotMatch(template, /^# 已完成变更$/m);
  assert.doesNotMatch(template, /^# 未完成项与风险$/m);
});
