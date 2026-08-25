import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal } from '../commands/init.js';
import { memoryCheck } from '../commands/memory.js';
import { memoryMaintenance, supersedeMemory } from '../commands/memory-lifecycle.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-lifecycle-reference-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function inputDocument(
  title: string,
  lifecycleMetadata: string[],
  status: 'active' | 'superseded' = 'active',
): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} memory`,
    'type: user-input',
    'memory-kind: input',
    `status: ${status}`,
    'owners: [test-owner]',
    'created: 2026-08-25',
    'updated: 2026-08-25',
    'project: global',
    'tags: [test]',
    'scope: []',
    'source-refs: []',
    'source-of-truth: false',
    'input-source: chat',
    'verbatim: true',
    ...lifecycleMetadata,
    'schema-version: 1',
    '---',
    '',
    'Opaque user input.',
    '',
  ].join('\n');
}

function writeValidTarget(memoryRoot: string): void {
  writeFileSync(join(memoryRoot, 'target.md'), inputDocument('Target', []));
}

test('lifecycle references accept canonical string and string-array forms', () => {
  const root = fixture();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  writeValidTarget(runtime.memoryHome);
  writeFileSync(
    join(runtime.memoryHome, 'source.md'),
    inputDocument(
      'Source',
      [
        'derived-from: memory:target',
        'supersedes: [memory:target]',
        'superseded-by: memory:target',
      ],
      'superseded',
    ),
  );

  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo()));
});

const invalidMetadataCases = [
  ['superseded-by', 'false', 'superseded'],
  ['superseded-by', '""', 'superseded'],
  ['superseded-by', '"memory:"', 'superseded'],
  ['superseded-by', '{}', 'superseded'],
  ['superseded-by', '[]', 'superseded'],
  ['superseded-by', '[memory:target]', 'superseded'],
  ['superseded-by', 'external:target', 'superseded'],
  ['derived-from', 'false', 'active'],
  ['derived-from', '""', 'active'],
  ['derived-from', '[memory:target, ""]', 'active'],
  ['derived-from', '{}', 'active'],
  ['derived-from', '[]', 'active'],
  ['derived-from', '[memory:target, false]', 'active'],
  ['derived-from', '[memory:target, external:target]', 'active'],
  ['supersedes', 'false', 'active'],
  ['supersedes', '""', 'active'],
  ['supersedes', '"memory:"', 'active'],
  ['supersedes', '{}', 'active'],
  ['supersedes', '[]', 'active'],
  ['supersedes', '[memory:target, {}]', 'active'],
  ['supersedes', 'external:target', 'active'],
] as const;

for (const [field, value, status] of invalidMetadataCases) {
  test(`lifecycle reference contract rejects ${field}: ${value}`, () => {
    const root = fixture();
    const runtime = harnessRuntime(root);
    initGlobal(runtime, capturedIo());
    writeValidTarget(runtime.memoryHome);
    writeFileSync(
      join(runtime.memoryHome, 'source.md'),
      inputDocument('Source', [`${field}: ${value}`], status),
    );

    const io = capturedIo();
    assert.throws(() => memoryCheck(runtime, 'global', io), /issue/i);
    assert.match(io.errors.join('\n'), new RegExp(`${field}.*canonical memory reference`, 'i'));
  });
}

for (const field of ['superseded-by', 'derived-from', 'supersedes'] as const) {
  test(`${field} rejects a non-canonical memory reference`, () => {
    const root = fixture();
    const runtime = harnessRuntime(root);
    initGlobal(runtime, capturedIo());
    writeValidTarget(runtime.memoryHome);
    writeFileSync(
      join(runtime.memoryHome, 'source.md'),
      inputDocument(
        'Source',
        [`${field}: memory:./target`],
        field === 'superseded-by' ? 'superseded' : 'active',
      ),
    );

    const io = capturedIo();
    assert.throws(() => memoryCheck(runtime, 'global', io), /issue/i);
    assert.match(io.errors.join('\n'), /not canonical/i);
  });

  test(`${field} rejects a missing memory target`, () => {
    const root = fixture();
    const runtime = harnessRuntime(root);
    initGlobal(runtime, capturedIo());
    writeFileSync(
      join(runtime.memoryHome, 'source.md'),
      inputDocument(
        'Source',
        [`${field}: memory:missing`],
        field === 'superseded-by' ? 'superseded' : 'active',
      ),
    );

    const io = capturedIo();
    assert.throws(() => memoryCheck(runtime, 'global', io), /issue/i);
    assert.match(io.errors.join('\n'), /broken memory reference: memory:missing/i);
  });
}

test('canonical superseded-by references continue to participate in cycle reporting', () => {
  const root = fixture();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  writeFileSync(
    join(runtime.memoryHome, 'cycle-a.md'),
    inputDocument('Cycle A', ['superseded-by: memory:cycle-b'], 'superseded'),
  );
  writeFileSync(
    join(runtime.memoryHome, 'cycle-b.md'),
    inputDocument('Cycle B', ['superseded-by: memory:cycle-a'], 'superseded'),
  );

  const report = memoryMaintenance(runtime, 'global', { json: true }, capturedIo());
  assert.deepEqual(report.supersessionCycles, [['cycle-a.md', 'cycle-b.md', 'cycle-a.md']]);
});

test('supersede rejects a mutation that would create a cycle', () => {
  const root = fixture();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const first = join(runtime.memoryHome, 'first.md');
  const second = join(runtime.memoryHome, 'second.md');
  writeFileSync(first, inputDocument('First', []));
  writeFileSync(second, inputDocument('Second', []));

  supersedeMemory(runtime, 'global', 'first', 'second', capturedIo());
  const before = readFileSync(second, 'utf8');
  assert.throws(
    () => supersedeMemory(runtime, 'global', 'second', 'first', capturedIo()),
    /create a cycle/i,
  );
  assert.equal(readFileSync(second, 'utf8'), before);
});
