import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { resolveMemoryRoot } from '../commands/memory/memory.js';
import { memoryPromotionProposal } from '../commands/memory/memory-promotion.js';
import { findingDigest } from '../lib/memory/memory-finding.js';
import { assertPromotionTargetType } from '../lib/memory/memory-promotion-contract.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function memoryDocument(title: string): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} memory`,
    'type: analytical-finding',
    'memory-kind: distilled',
    'status: active',
    'owners: [test-owner]',
    'created: 2026-08-19',
    'updated: 2026-08-19',
    'project: test',
    'tags: [test]',
    'scope: []',
    'source-refs: [docs/source.md]',
    'source-of-truth: false',
    'schema-version: 1',
    'finding-schema-version: 2',
    'finding-kind: analysis',
    'fact-class: settled-fact',
    `finding-digest: sha256:${findingDigest('analysis', 'Stable finding.')}`,
    'retention: durable',
    '---',
    '',
    '# 结论',
    '',
    'Stable finding.',
    '',
    '# 理由',
    '',
    'The behavior is stable and reusable.',
    '',
    '# 应用',
    '',
    'Maintain the contract in project documentation.',
    '',
    '# 证据',
    '',
    '- Reproduced by the focused fixture.',
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
  mkdirSync(join(project, 'docs'), { recursive: true });
  writeFileSync(join(project, 'docs', 'source.md'), 'Source evidence.\n');
  const target = join(dirname(resolveMemoryRoot(runtime, project)), 'docs', 'finding.md');

  const proposal = memoryPromotionProposal(
    runtime,
    project,
    'distilled/finding',
    {
      target: 'docs/finding.md',
      artifactType: 'docs',
      owner: 'docs-owner',
      reason: 'The finding should become a team-maintained contract.',
      verifier: 'pnpm run check:docs',
    },
    capturedIo(),
  );

  assert.equal(proposal.version, 2);
  assert.equal(proposal.mode, 'proposal-only');
  assert.deepEqual(proposal.target, {
    path: target,
    reference: 'docs/finding.md',
    artifactType: 'docs',
    owner: 'docs-owner',
    exists: false,
    dirty: false,
  });
  assert.equal(proposal.reason, 'The finding should become a team-maintained contract.');
  assert.deepEqual(proposal.evidence, {
    items: ['Reproduced by the focused fixture.'],
    sourceRefs: ['docs/source.md'],
  });
  assert.equal(proposal.verification.command, 'pnpm run check:docs');
  assert.equal(proposal.verification.status, 'required');
  assert.equal(proposal.authorization.formalWrite, 'not-authorized-by-proposal');
  assert.equal(proposal.source.freshness, 'current');
  assert.deepEqual(proposal.source.owners, ['test-owner']);
  assert.deepEqual(proposal.unmetConditions, ['formal-write-authorization-required']);
  assert.equal(proposal.supersedeCandidate, null);
  assert.equal(proposal.sourceOfTruth, false);
  assert.equal(existsSync(target), false);
  assert.throws(
    () =>
      memoryPromotionProposal(
        runtime,
        project,
        'distilled/finding',
        {
          target: '.agent-docs/promoted.md',
          artifactType: 'docs',
          owner: 'docs-owner',
          reason: 'Invalid target.',
          verifier: 'pnpm run check:docs',
        },
        capturedIo(),
      ),
    /authoritative project path/,
  );
  assert.throws(
    () =>
      memoryPromotionProposal(
        runtime,
        project,
        'distilled/finding',
        {
          target: 'packages/cli/src/runtime.ts',
          artifactType: 'docs',
          owner: 'docs-owner',
          reason: 'Mislabeled target.',
          verifier: 'pnpm run check:docs',
        },
        capturedIo(),
      ),
    /artifact type.*target/i,
  );

  writeFileSync(target, '# Finding\n\nAdopted contract.\n');
  execFileSync('git', ['-C', project, 'add', 'docs/finding.md']);
  const adopted = memoryPromotionProposal(
    runtime,
    project,
    'distilled/finding',
    {
      target: 'docs/finding.md',
      artifactType: 'docs',
      owner: 'docs-owner',
      reason: 'The finding is now carried by the formal document.',
      verifier: 'pnpm run check:docs',
      adoptionEvidence: ['docs/finding.md#finding'],
    },
    capturedIo(),
  );
  assert.equal(adopted.target.dirty, true);
  assert.deepEqual(adopted.unmetConditions, [
    'formal-write-authorization-required',
    'target-dirty',
  ]);
  assert.deepEqual(adopted.supersedeCandidate, {
    status: 'candidate',
    memory: 'memory:distilled/finding',
    authoritativeTarget: 'docs/finding.md',
    evidence: ['docs/finding.md#finding'],
    requiredLifecycle: 'owner-confirmed-typed-supersede',
  });

  const artifactTargets = [
    ['adr', 'docs/adr/0001-purpose.md'],
    ['docs', 'docs/purpose.md'],
    ['tests', 'packages/cli/src/__tests__/purpose.test.ts'],
    ['schema', 'schemas/purpose.schema.json'],
    ['lint', 'biome.json'],
    ['ci', '.github/workflows/ci.yml'],
  ] as const;
  for (const [artifactType, artifactTarget] of artifactTargets) {
    assert.doesNotThrow(() => assertPromotionTargetType(artifactType, artifactTarget));
  }

  const schema = JSON.parse(
    readFileSync(
      join(process.cwd(), 'packages', 'harness', 'schemas', 'memory-promotion.schema.json'),
      'utf8',
    ),
  );
  assert.equal(schema.$id, proposal.schema);
  assert.deepEqual(schema.properties.target.properties.artifactType.enum, [
    'adr',
    'docs',
    'tests',
    'schema',
    'lint',
    'ci',
  ]);
});
