import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { resolveHandoffTarget } from '../lib/memory-handoff.js';
import {
  type HandoffGenerationState,
  validateHandoffGenerations,
} from '../lib/memory-handoff-generation-rules.js';
import { generatedHandoffSessionId } from '../lib/memory-handoff-identity.js';
import { capturedIo } from './helpers/harness.js';

function fixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'sessions'), { recursive: true });
  return root;
}

function writeHandoff(
  root: string,
  filename: string,
  sessionBase: string,
  generation: number,
  status: string,
): string {
  const path = join(root, 'sessions', filename);
  writeFileSync(
    path,
    `---
type: session-handoff
memory-kind: episode
snapshot-mode: replace
session-queryable: false
session-id: ${generatedHandoffSessionId(sessionBase, generation)}
session-base: ${sessionBase}
handoff-generation: ${generation}
status: ${status}
---

Recovery snapshot.
`,
  );
  return path;
}

test('handoff generation validation reports portable, duplicate, and stale-active conflicts', () => {
  const state: HandoffGenerationState = new Map([
    [
      'portable-base',
      [
        { generation: 1, path: '/first.md', sessionBase: 'portable-base', status: 'active' },
        {
          generation: 1,
          path: '/duplicate.md',
          sessionBase: 'PORTABLE-BASE',
          status: 'complete',
        },
        { generation: 2, path: '/latest.md', sessionBase: 'portable-base', status: 'complete' },
      ],
    ],
  ]);
  const io = capturedIo();

  assert.equal(validateHandoffGenerations(state, io), 3);
  assert.match(io.errors.join('\n'), /portable handoff base identity collision/i);
  assert.match(io.errors.join('\n'), /duplicate handoff generation 1/i);
  assert.match(io.errors.join('\n'), /older handoff generation remains active/i);
});

test('handoff resolution rejects duplicate generations before choosing a target', () => {
  const root = fixture('harness-handoff-duplicate-resolution-');
  writeHandoff(root, 'duplicate-stream.md', 'duplicate-stream', 1, 'complete');
  writeHandoff(root, 'copy.md', 'duplicate-stream', 1, 'complete');

  assert.throws(
    () => resolveHandoffTarget(root, 'duplicate-stream', 'capture'),
    /ambiguous handoff generation 1/i,
  );
});

test('handoff resolution rejects multiple active generations', () => {
  const root = fixture('harness-handoff-active-resolution-');
  writeHandoff(root, 'active-stream.md', 'active-stream', 1, 'active');
  writeHandoff(root, 'active-stream--g2.md', 'active-stream', 2, 'blocked');

  assert.throws(
    () => resolveHandoffTarget(root, 'active-stream', 'capture'),
    /ambiguous active handoff generations/i,
  );
});

test('handoff resolution rejects an older active generation', () => {
  const root = fixture('harness-handoff-stale-active-resolution-');
  writeHandoff(root, 'stale-active.md', 'stale-active', 1, 'active');
  writeHandoff(root, 'stale-active--g2.md', 'stale-active', 2, 'complete');

  assert.throws(
    () => resolveHandoffTarget(root, 'stale-active', 'capture'),
    /older generation remains active/i,
  );
});

test('closing resolves the latest complete generation but rejects an absent workstream', () => {
  const root = fixture('harness-handoff-close-resolution-');
  const completed = writeHandoff(root, 'closed-stream.md', 'closed-stream', 1, 'complete');

  assert.deepEqual(resolveHandoffTarget(root, 'closed-stream', 'close'), {
    path: completed,
    identity: { sessionBase: 'closed-stream', generation: 1, sessionId: 'closed-stream' },
  });
  assert.throws(
    () => resolveHandoffTarget(fixture('harness-handoff-missing-resolution-'), 'missing', 'close'),
    /handoff session does not exist/i,
  );
});

test('capture rejects a terminal status that cannot start another generation', () => {
  const root = fixture('harness-handoff-terminal-resolution-');
  writeHandoff(root, 'terminal-stream.md', 'terminal-stream', 1, 'superseded');

  assert.throws(
    () => resolveHandoffTarget(root, 'terminal-stream', 'capture'),
    /cannot continue superseded handoff/i,
  );
});

test('an active handoff must use the filename declared by its session identity', () => {
  const root = fixture('harness-handoff-active-filename-');
  writeHandoff(root, 'wrong-name.md', 'active-name', 1, 'active');

  assert.throws(
    () => resolveHandoffTarget(root, 'active-name', 'capture'),
    /handoff filename collision/i,
  );
});

test('a non-handoff document cannot reserve the next generated session identity', () => {
  const root = fixture('harness-handoff-next-identity-');
  writeHandoff(root, 'next-identity.md', 'next-identity', 1, 'complete');
  writeFileSync(
    join(root, 'other.md'),
    `---
type: project-note
memory-kind: working
session-id: next-identity--g2
status: active
---

Unrelated content.
`,
  );

  assert.throws(
    () => resolveHandoffTarget(root, 'next-identity', 'capture'),
    /handoff identity collision/i,
  );
});
