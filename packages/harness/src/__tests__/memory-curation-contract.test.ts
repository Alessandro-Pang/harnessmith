import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  curationRecoveryPaths,
  curationWorkspaceDigest,
} from '../lib/memory/memory-curation-contract.js';
import { buildCurationProposals } from '../lib/memory/memory-curation-proposals.js';
import { readCurationSelectionFile } from '../lib/memory/memory-curation-selection.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-curation-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project);
  return { root, project };
}

test('selection files reject malformed and untyped apply contracts', () => {
  const { root } = fixture();
  const cases: Array<[unknown, RegExp]> = [
    ['{', /invalid JSON/i],
    [{ version: 2, selections: [] }, /version 1/i],
    [{ version: 1, selections: [], extra: true }, /unknown key/i],
    [{ version: 1, selections: [null] }, /proposalId/i],
    [{ version: 1, selections: [{ proposalId: 'x', extra: true }] }, /unknown key/i],
    [{ version: 1, selections: [{ proposalId: 'x', replacement: 1 }] }, /replacement/i],
    [{ version: 1, selections: [{ proposalId: 'x', promotion: [] }] }, /promotion/i],
  ];
  for (const [index, [value, expected]] of cases.entries()) {
    const path = join(root, `selection-${index}.json`);
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    assert.throws(() => readCurationSelectionFile(path), expected);
  }
});

test('proposal helpers fail closed for unavailable sources and preserve recovery paths', () => {
  const { root, project } = fixture();
  assert.throws(() => curationWorkspaceDigest(join(root, 'missing')), /unavailable/i);
  assert.throws(
    () =>
      buildCurationProposals({
        project,
        documents: [],
        candidates: {
          promote: [{ reference: 'memory:missing', reason: 'missing' }],
          close: [],
          supersede: [],
          archive: [],
        },
        expiresOn: '2026-09-01',
        task: 'task',
        taskStatus: 'in_progress',
        workstream: 'task',
        outcome: 'phase-complete',
      }),
    /source disappeared/i,
  );
  assert.deepEqual(
    curationRecoveryPaths(
      new Error('recovery path: /tmp/one; unresolved paths: /tmp/two\nrecovery path: /tmp/one'),
    ),
    ['/tmp/one', '/tmp/two'],
  );
  assert.deepEqual(curationRecoveryPaths('no recovery information'), []);
});
