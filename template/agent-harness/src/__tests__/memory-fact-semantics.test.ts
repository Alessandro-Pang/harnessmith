import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { parseFrontmatterDocument } from '../lib/frontmatter.js';
import {
  assertFindingFactSemantics,
  classifyMemoryDocument,
  classifyMemoryFact,
  type MemoryFactClass,
  validFactExpiry,
} from '../lib/memory-fact-semantics.js';
import { searchText } from '../lib/search.js';
import { searchWithIndex } from '../lib/search-index.js';
import { harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-fact-semantics-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(root, { recursive: true });
  return root;
}

test('fact semantics preserve explicit classes and only derive authoritative contracts', () => {
  const explicit = classifyMemoryFact(
    new Map<string, unknown>([
      ['fact-class', 'current-state'],
      ['source-of-truth', false],
    ]),
  );
  assert.deepEqual(explicit, {
    factClass: 'current-state',
    classification: 'explicit',
    requiresReverification: true,
  });
  assert.deepEqual(classifyMemoryFact(new Map([['type', 'session-handoff']])), {
    factClass: 'recovery-state',
    classification: 'derived',
    requiresReverification: true,
  });
  assert.deepEqual(classifyMemoryFact(new Map([['source-of-truth', true]])), {
    factClass: 'formal-fact',
    classification: 'derived',
    requiresReverification: false,
  });
  assert.deepEqual(classifyMemoryFact(new Map([['type', 'analytical-finding']])), {
    factClass: null,
    classification: 'legacy-unclassified',
    requiresReverification: false,
  });
});

test('finding fact semantics fail closed and malformed legacy documents remain unclassified', () => {
  assert.throws(
    () => assertFindingFactSemantics('durable', 'unknown' as MemoryFactClass),
    /invalid finding fact class/i,
  );
  assert.throws(
    () => assertFindingFactSemantics('durable', 'formal-fact'),
    /cannot declare formal-fact/i,
  );
  assert.equal(validFactExpiry('2026-09-30'), true);
  assert.equal(validFactExpiry('2026-02-30'), false);
  assert.deepEqual(classifyMemoryDocument('---\ntitle: [unterminated\n---\n'), {
    factClass: null,
    classification: 'legacy-unclassified',
    requiresReverification: false,
  });
});

test('scan and fulltext search expose identical recovery and formal fact semantics', () => {
  const root = fixture();
  const recovery = join(root, 'handoff.md');
  const formal = join(root, 'formal.md');
  writeFileSync(
    recovery,
    '---\ntype: session-handoff\nsource-of-truth: false\n---\n\nrecoverymarker next action\n',
  );
  writeFileSync(
    formal,
    '---\ntype: decision\nsource-of-truth: true\n---\n\nformalmarker accepted decision\n',
  );
  const sources = [{ root, label: 'memory', trust: 'untrusted' as const }];
  const runtime = harnessRuntime(root);

  const scan = searchText('recoverymarker', sources);
  const indexed = searchWithIndex(runtime, 'recoverymarker', sources, { refreshIndex: true });
  assert.equal(scan.matches[0]?.factClass, 'recovery-state');
  assert.equal(scan.matches[0]?.requiresReverification, true);
  assert.equal(indexed.matches[0]?.factClass, 'recovery-state');
  assert.equal(indexed.matches[0]?.classification, 'derived');

  const formalResult = searchWithIndex(runtime, 'formalmarker', sources, { mode: 'fulltext' });
  assert.equal(formalResult.matches[0]?.factClass, 'formal-fact');
  assert.equal(formalResult.matches[0]?.requiresReverification, false);
  assert.equal(
    classifyMemoryFact(parseFrontmatterDocument(writeDocument()).metadata).factClass,
    null,
  );
});

function writeDocument(): string {
  return '---\ntype: legacy-note\nsource-of-truth: false\n---\n\nlegacy\n';
}
