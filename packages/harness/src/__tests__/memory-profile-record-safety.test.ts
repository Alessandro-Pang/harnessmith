import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal } from '../commands/init.js';
import { memoryCheck } from '../commands/memory/memory.js';
import { reconcileProfile, removeProfileEntry } from '../commands/memory/memory-profile.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  return { profile, runtime };
}

function appendProfileLines(profile: string, lines: string[]): string {
  const content = `${readFileSync(profile, 'utf8').replace(/\n+$/, '')}\n${lines.join('\n')}\n`;
  writeFileSync(profile, content);
  return content;
}

function profileEntry(key: string, marker = '-'): string {
  return `${marker} ${key} | Stable preference. | explicit | high | 2026-08-25`;
}

test('profile validation counts indented list-like records toward capacity and rejects them', () => {
  const { profile, runtime } = fixture('harness-profile-indented-capacity-');
  appendProfileLines(
    profile,
    Array.from({ length: 33 }, (_, index) => `  ${profileEntry(`capacity.entry-${index}`)}`),
  );
  const io = capturedIo();

  assert.throws(() => memoryCheck(runtime, 'global', io), /issue/i);
  assert.match(io.errors.join('\n'), /at most 32 active entries/i);
  assert.match(io.errors.join('\n'), /non-canonical user-profile entry/i);
});

test('profile validation rejects alternate bullets and detects keys hidden by indentation', () => {
  const { profile, runtime } = fixture('harness-profile-list-like-records-');
  appendProfileLines(profile, [
    profileEntry('communication.detail'),
    `  ${profileEntry('communication.detail')}`,
    profileEntry('communication.star', '*'),
    profileEntry('communication.plus', '+'),
  ]);
  const io = capturedIo();

  assert.throws(() => memoryCheck(runtime, 'global', io), /issue/i);
  assert.match(io.errors.join('\n'), /non-canonical user-profile entry/i);
  assert.match(io.errors.join('\n'), /duplicate user-profile key communication\.detail/i);
});

test('profile reconcile and forget reject a hidden duplicate without changing bytes', () => {
  const { profile, runtime } = fixture('harness-profile-hidden-duplicate-command-');
  const before = appendProfileLines(profile, [
    profileEntry('communication.detail'),
    `  ${profileEntry('communication.detail')}`,
  ]);

  assert.throws(
    () =>
      reconcileProfile(runtime, {
        key: 'communication.detail',
        conclusion: 'Updated preference.',
        evidence: 'explicit',
        confidence: 'high',
      }),
    /preflight/i,
  );
  assert.equal(readFileSync(profile, 'utf8'), before);

  assert.throws(() => removeProfileEntry(runtime, { key: 'communication.detail' }), /preflight/i);
  assert.equal(readFileSync(profile, 'utf8'), before);
});

test('profile reconcile ignores record-shaped strings in frontmatter source references', () => {
  const { profile, runtime } = fixture('harness-profile-frontmatter-decoy-');
  const decoy = 'communication.detail | Frontmatter decoy. | explicit | high | 2026-08-25';
  const before = readFileSync(profile, 'utf8').replace(
    'source-refs: []',
    `source-refs:\n  - ${decoy}`,
  );
  writeFileSync(profile, before);

  const result = reconcileProfile(
    runtime,
    {
      key: 'communication.detail',
      conclusion: 'Real body preference.',
      evidence: 'explicit',
      confidence: 'high',
    },
    capturedIo(),
  );

  const content = readFileSync(profile, 'utf8');
  assert.equal(result.action, 'created');
  assert.ok(content.includes(`  - ${decoy}`));
  assert.match(
    content,
    /^- communication\.detail \| Real body preference\. \| explicit \| high \|/m,
  );
  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo()));
});

test('profile forget removes every canonical duplicate for the exact target key', () => {
  const { profile, runtime } = fixture('harness-profile-forget-canonical-duplicates-');
  appendProfileLines(profile, [
    profileEntry('communication.target'),
    profileEntry('communication.target'),
  ]);

  const result = removeProfileEntry(runtime, { key: 'communication.target' }, capturedIo());

  assert.equal(result.action, 'updated');
  assert.doesNotMatch(readFileSync(profile, 'utf8'), /^- communication\.target \|/m);
  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo()));
});

test('profile forget can repair more than 32 canonical duplicates of the exact target key', () => {
  const { profile, runtime } = fixture('harness-profile-forget-over-capacity-target-');
  appendProfileLines(
    profile,
    Array.from({ length: 33 }, () => profileEntry('communication.target')),
  );

  const result = removeProfileEntry(runtime, { key: 'communication.target' }, capturedIo());

  assert.equal(result.action, 'updated');
  assert.doesNotMatch(readFileSync(profile, 'utf8'), /^- communication\.target \|/m);
  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo()));
});

test('profile forget repair does not suppress a duplicate for another key', () => {
  const { profile, runtime } = fixture('harness-profile-forget-other-duplicate-');
  const before = appendProfileLines(profile, [
    profileEntry('communication.target'),
    profileEntry('communication.target'),
    profileEntry('communication.other'),
    profileEntry('communication.other'),
  ]);

  assert.throws(() => removeProfileEntry(runtime, { key: 'communication.target' }), /preflight/i);
  assert.equal(readFileSync(profile, 'utf8'), before);
});

test('profile forget repair cannot hide secret material in the removed records', () => {
  const { profile, runtime } = fixture('harness-profile-forget-secret-');
  const secret = `ghp_${'S'.repeat(24)}`;
  const entry = `- communication.target | ${secret} | explicit | high | 2026-08-25`;
  const before = appendProfileLines(profile, [entry, entry]);

  let thrown = '';
  try {
    removeProfileEntry(runtime, { key: 'communication.target' });
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  assert.match(thrown, /secret material/i);
  assert.doesNotMatch(thrown, new RegExp(secret));
  assert.equal(readFileSync(profile, 'utf8'), before);
});
