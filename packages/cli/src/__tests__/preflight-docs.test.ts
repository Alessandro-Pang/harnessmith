import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { parse } from 'yaml';
import { promptRuleContractIssues } from '../../../../scripts/benchmarks/prompt-route/prompt-rule-contract.js';
import { capabilityEvidenceIssues } from '../../../../scripts/evaluation/capability-evidence.js';
import {
  documentRouteOwnershipIssues,
  filesUnder,
  invalidManifestRouteMetadata,
  missingCanonicalRouteIds,
} from '../../../../scripts/preflight/preflight-docs.js';

function parseManifest(root: string): unknown {
  return parse(readFileSync(join(root, 'manifest.yaml'), 'utf8'));
}

test('trusted apps/docs/site traversal returns filtered full paths in deterministic order', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-preflight-docs-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'z.md'), '# Z\n');
  writeFileSync(join(root, 'nested', 'a.md'), '# A\n');
  writeFileSync(join(root, 'nested', 'ignored.txt'), 'ignored\n');

  assert.deepEqual(
    filesUnder(root, (path) => path.endsWith('.md')),
    [join(root, 'nested', 'a.md'), join(root, 'z.md')],
  );
});

test('docs preflight validates canonical contract route ids instead of prose snippets', () => {
  assert.deepEqual(
    missingCanonicalRouteIds({
      entries: {
        'operating-model': {},
        'execution-loop': {},
        'tool-routing': {},
        'safety-and-verification': {},
        'git-conventions': {},
        'harness-cli-architecture': {},
        'long-running-tasks': {},
        change: {},
        diagnose: {},
        'research-and-design': {},
        'release-and-external': {},
        'repository-map': {},
        'project-agents': {},
        'project-agent-docs': {},
        'user-profile-memory': {},
      },
    }),
    ['review', 'understand-and-map', 'verify-and-accept', 'prompt-rule-contract'],
  );
});

test('prompt rule contracts require complete semantics, evidence, owners, and confusing pairs', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-prompt-rule-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/cli/src'), { recursive: true });
  mkdirSync(join(root, 'packages/cli/src', '__tests__'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'packages/cli/src', 'gate.ts'), 'export const gate = true;\n');
  writeFileSync(
    join(root, 'packages/cli/src', '__tests__', 'gate.test.ts'),
    "test('gate', () => true);\n",
  );
  writeFileSync(join(root, 'docs', 'rules.md'), '# Rules\n');

  const manifest = {
    entries: {
      'long-running-tasks': { kind: 'topic' },
      'operating-model': { kind: 'topic' },
    },
  };
  assert.deepEqual(
    promptRuleContractIssues(root, manifest, {
      version: 1,
      rules: [
        {
          id: 'task-completion-gate',
          owner: 'long-running-tasks',
          principle: 'Only verified tasks complete.',
          rationale: 'A prose completion claim is not evidence.',
          action: 'Run the acceptance gate before persistence.',
          fallback: 'Keep the task in progress or blocked.',
          guarantee: 'enforced',
          enforcedBy: 'runtime',
          evidence: {
            implementation: ['packages/cli/src/gate.ts'],
            verification: ['packages/cli/src/__tests__/gate.test.ts'],
          },
          confusingWith: ['task-curation'],
        },
        {
          id: 'task-curation',
          owner: 'operating-model',
          principle: 'Curation does not complete tasks.',
          rationale: 'Semantic review and acceptance prove different things.',
          action: 'Return a proposal only.',
          fallback: 'Return none.',
          guarantee: 'guided',
          enforcedBy: 'agent',
          boundary: ['docs/rules.md'],
          confusingWith: ['task-completion-gate'],
        },
      ],
    }),
    [],
  );

  const issues = promptRuleContractIssues(root, manifest, {
    version: 1,
    rules: [
      {
        id: 'duplicate',
        owner: 'missing-owner',
        principle: 'Incomplete rule.',
        rationale: '',
        action: '',
        fallback: '',
        guarantee: 'absolute',
        enforcedBy: 'agent',
        confusingWith: ['missing-rule'],
      },
      {
        id: 'duplicate',
        owner: 'operating-model',
        principle: 'Duplicate rule.',
        rationale: 'Duplicate identities hide ownership drift.',
        action: 'Reject it.',
        fallback: 'Keep the existing owner.',
        guarantee: 'host-dependent',
        enforcedBy: 'host',
        boundary: [],
      },
      {
        id: 'self-pair',
        owner: 'operating-model',
        principle: 'A rule cannot be its own confusing pair.',
        rationale: 'Self references do not explain a semantic distinction.',
        action: 'Reject the pair.',
        fallback: 'Remove the self reference.',
        guarantee: 'guided',
        enforcedBy: 'agent',
        boundary: ['docs/rules.md'],
        confusingWith: ['self-pair'],
      },
    ],
  });
  for (const expected of [
    'prompt rule id is duplicated: duplicate',
    'prompt rule duplicate references unknown owner: missing-owner',
    'prompt rule duplicate has no rationale',
    'prompt rule duplicate has no action',
    'prompt rule duplicate has no fallback',
    'prompt rule duplicate has invalid guarantee',
    'prompt rule duplicate references unknown confusing rule: missing-rule',
    'host-dependent prompt rule duplicate has no boundary evidence',
    'prompt rule self-pair cannot be confused with itself',
  ])
    assert.ok(issues.includes(expected), `missing issue: ${expected}`);
});

test('prompt rule contracts require an explicit enforcement subject', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-prompt-rule-enforcement-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'rules.md'), '# Rules\n');

  const manifest = { entries: { operating: { kind: 'topic' } } };
  const valid = promptRuleContractIssues(root, manifest, {
    version: 1,
    rules: [
      {
        id: 'rule',
        owner: 'operating',
        principle: 'Keep the boundary.',
        rationale: 'Avoid silent drift.',
        action: 'Check the boundary.',
        fallback: 'Stop safely.',
        guarantee: 'guided',
        enforcedBy: 'agent',
        boundary: ['rules.md'],
      },
    ],
  });
  assert.deepEqual(valid, []);

  const invalid = promptRuleContractIssues(root, manifest, {
    version: 1,
    rules: [
      {
        id: 'missing-subject',
        owner: 'operating',
        principle: 'Keep the boundary.',
        rationale: 'Avoid silent drift.',
        action: 'Check the boundary.',
        fallback: 'Stop safely.',
        guarantee: 'guided',
        boundary: ['rules.md'],
      },
      {
        id: 'unknown-subject',
        owner: 'operating',
        principle: 'Keep the boundary.',
        rationale: 'Avoid silent drift.',
        action: 'Check the boundary.',
        fallback: 'Stop safely.',
        guarantee: 'guided',
        enforcedBy: 'policy-engine',
        boundary: ['rules.md'],
      },
    ],
  });
  assert.ok(invalid.includes('prompt rule missing-subject has no enforcement subject'));
  assert.ok(invalid.includes('prompt rule unknown-subject has invalid enforcement subject'));
});

test('prompt rule contracts align guarantee level with its enforcement subject', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-prompt-rule-guarantee-alignment-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'rules.md'), '# Rules\n');
  const manifest = { entries: { operating: { kind: 'topic' } } };

  const issues = promptRuleContractIssues(root, manifest, {
    version: 1,
    rules: [
      {
        id: 'guided-runtime',
        owner: 'operating',
        principle: 'Keep the boundary.',
        rationale: 'Avoid silent drift.',
        action: 'Check the boundary.',
        fallback: 'Stop safely.',
        guarantee: 'guided',
        enforcedBy: 'runtime',
        boundary: ['rules.md'],
      },
      {
        id: 'enforced-agent',
        owner: 'operating',
        principle: 'Keep the boundary.',
        rationale: 'Avoid silent drift.',
        action: 'Check the boundary.',
        fallback: 'Stop safely.',
        guarantee: 'enforced',
        enforcedBy: 'agent',
        evidence: {
          implementation: ['rules.md'],
          verification: ['rules.md'],
        },
      },
      {
        id: 'host-runtime',
        owner: 'operating',
        principle: 'Keep the boundary.',
        rationale: 'Avoid silent drift.',
        action: 'Check the boundary.',
        fallback: 'Stop safely.',
        guarantee: 'host-dependent',
        enforcedBy: 'runtime',
        boundary: ['rules.md'],
      },
    ],
  });

  assert.ok(issues.includes('guided prompt rule guided-runtime must be enforced by agent'));
  assert.ok(issues.includes('enforced prompt rule enforced-agent cannot be enforced by agent'));
  assert.ok(issues.includes('host-dependent prompt rule host-runtime must be enforced by host'));
});

test('docs preflight validates route kinds and requires explicit playbook priority', () => {
  assert.deepEqual(
    invalidManifestRouteMetadata({
      entries: {
        change: { kind: 'playbook', priority: 40 },
        safety: { kind: 'topic' },
        standard: { kind: 'standard' },
      },
    }),
    [],
  );
  assert.deepEqual(
    invalidManifestRouteMetadata({
      entries: {
        missing: {},
        unknown: { kind: 'workflow' },
        unranked: { kind: 'playbook' },
        fractional: { kind: 'playbook', priority: 1.5 },
        malformedRequired: { kind: 'topic', requiredConceptAliases: 'handoff' },
        normalizedDuplicate: {
          kind: 'topic',
          conceptAliases: ['Git', 'git'],
        },
        malformedLoad: { kind: 'topic', load: 'later' },
        unknownOwner: { kind: 'topic', owner: 'not-present' },
        malformedOwner: { kind: 'topic', owner: 42 },
        deferredWithoutOwner: { kind: 'topic', load: 'reference' },
        deferredWithRequired: {
          kind: 'topic',
          load: 'reference',
          owner: 'unknownOwner',
          requiredConceptAliases: ['required'],
        },
      },
    }),
    [
      'deferredWithRequired',
      'deferredWithoutOwner',
      'fractional',
      'malformedLoad',
      'malformedOwner',
      'malformedRequired',
      'missing',
      'normalizedDuplicate',
      'unknown',
      'unknownOwner',
      'unranked',
    ],
  );
});

test('docs preflight requires one frontmatter owner and keeps deferred references explicit', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-doc-ownership-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'manifest.yaml'),
    `version: 1
entries:
  core:
    kind: topic
    path: core.md
  reference:
    kind: topic
    load: reference
    path: reference.md
`,
  );
  writeFileSync(
    join(root, 'core.md'),
    '---\ntitle: Core\ntype: harness-core\nstatus: active\nupdated: 2026-09-04\nowner: core\n---\n',
  );
  writeFileSync(
    join(root, 'reference.md'),
    '---\ntitle: Reference\ntype: harness-reference\nstatus: active\nupdated: 2026-09-04\nowner: reference\n---\n',
  );
  assert.deepEqual(documentRouteOwnershipIssues(root, parseManifest(root)), []);

  writeFileSync(
    join(root, 'reference.md'),
    '---\ntitle: Reference\ntype: harness-core\nstatus: active\nupdated: 2026-09-04\nowner: core\n---\n',
  );
  assert.deepEqual(documentRouteOwnershipIssues(root, parseManifest(root)), [
    'docs route reference owner must be reference, got core',
    'docs route reference must use harness-reference frontmatter type',
  ]);
});

test('capability evidence requires explicit states and code plus test evidence for implemented claims', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-capability-evidence-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/cli/src'), { recursive: true });
  writeFileSync(join(root, 'packages/cli/src', 'feature.ts'), 'export const feature = true;\n');
  writeFileSync(
    join(root, 'packages/cli/src', 'feature.test.ts'),
    "test('feature', () => true);\n",
  );

  assert.deepEqual(
    capabilityEvidenceIssues(root, {
      version: 1,
      positioning: 'cross-host Personal Harness distribution and work-state control plane',
      claims: [
        {
          id: 'feature',
          status: 'implemented',
          owner: 'Harnessmith',
          claim: 'Feature exists.',
          implementation: ['packages/cli/src/feature.ts'],
          verification: ['packages/cli/src/feature.test.ts'],
        },
        {
          id: 'host-loop',
          status: 'delegated',
          owner: 'Host runtime',
          claim: 'The host owns the model loop.',
          boundary: ['README.md'],
        },
        {
          id: 'policy-engine',
          status: 'unsupported',
          owner: 'None',
          claim: 'No policy engine is provided.',
          boundary: ['README.md'],
        },
      ],
    }),
    [
      'claim host-loop references missing boundary evidence: README.md',
      'claim policy-engine references missing boundary evidence: README.md',
    ],
  );

  assert.deepEqual(
    capabilityEvidenceIssues(root, {
      version: 1,
      positioning: 'wrong scope',
      claims: [
        {
          id: 'feature',
          status: 'implemented',
          owner: 'Harnessmith',
          claim: 'Feature exists.',
          implementation: ['packages/cli/src/missing.ts'],
          verification: [],
        },
      ],
    }),
    [
      'capability evidence positioning is not canonical',
      'capability evidence is missing status: delegated',
      'capability evidence is missing status: unsupported',
      'implemented claim feature has no verification evidence',
      'claim feature references missing implementation evidence: packages/cli/src/missing.ts',
    ],
  );
});

test('capability evidence rejects duplicate ids and non-executable verification evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-capability-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/cli/src'), { recursive: true });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'packages/cli/src', 'feature.ts'), 'export const feature = true;\n');
  writeFileSync(join(root, 'docs', 'claim.md'), '# Claim\n');

  assert.deepEqual(
    capabilityEvidenceIssues(root, {
      version: 1,
      positioning: 'cross-host Personal Harness distribution and work-state control plane',
      claims: [
        {
          id: 'feature',
          status: 'implemented',
          owner: 'Harness runtime',
          claim: 'Feature exists.',
          implementation: ['packages/cli/src/feature.ts'],
          verification: ['docs/claim.md'],
        },
        {
          id: 'feature',
          status: 'delegated',
          owner: 'Host runtime',
          claim: 'Host owns execution.',
          boundary: ['docs/claim.md'],
        },
        {
          id: 'unsupported',
          status: 'unsupported',
          owner: 'none',
          claim: 'Capability is not provided.',
          boundary: ['docs/claim.md'],
        },
      ],
    }),
    [
      'capability claim id is duplicated: feature',
      'implemented claim feature verification evidence is not executable: docs/claim.md',
    ],
  );
});
