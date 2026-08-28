import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { resolveMemoryRoot } from '../commands/memory.js';
import { memoryPromotionProposal } from '../commands/memory-promotion.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function memoryDocument(title: string): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} memory`,
    'type: session-handoff',
    'memory-kind: distilled',
    'status: active',
    'owners: [test-owner]',
    'created: 2026-08-19',
    'updated: 2026-08-19',
    'project: test',
    'tags: [test]',
    'scope: []',
    'source-refs: []',
    'source-of-truth: false',
    'schema-version: 1',
    '---',
    '',
  ].join('\n');
}

test('memory promotion produces a proposal without writing authoritative docs', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-promotion-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(join(project, '.agent-docs', 'distilled'), { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memory = join(project, '.agent-docs', 'distilled', 'finding.md');
  writeFileSync(memory, memoryDocument('Finding'));
  const target = join(dirname(resolveMemoryRoot(runtime, project)), 'docs', 'finding.md');

  const proposal = memoryPromotionProposal(
    runtime,
    project,
    'distilled/finding',
    'docs/finding.md',
    capturedIo(),
  );

  assert.equal(proposal.mode, 'proposal-only');
  assert.equal(proposal.target, target);
  assert.equal(proposal.sourceOfTruth, false);
  assert.equal(existsSync(target), false);
  assert.throws(
    () =>
      memoryPromotionProposal(
        runtime,
        project,
        'distilled/finding',
        '.agent-docs/promoted.md',
        capturedIo(),
      ),
    /authoritative project path/,
  );
});
