import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { capabilityEvidenceIssues } from '../../scripts/capability-evidence.js';
import {
  filesUnder,
  invalidManifestRouteMetadata,
  missingCanonicalRouteIds,
} from '../../scripts/preflight-docs.js';
import { promptRuleContractIssues } from '../../scripts/prompt-rule-contract.js';

test('trusted docs traversal returns filtered full paths in deterministic order', () => {
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
    ['review', 'prompt-rule-contract'],
  );
});

test('prompt rule contracts require complete semantics, evidence, owners, and confusing pairs', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-prompt-rule-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'src', '__tests__'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'src', 'gate.ts'), 'export const gate = true;\n');
  writeFileSync(join(root, 'src', '__tests__', 'gate.test.ts'), "test('gate', () => true);\n");
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
          evidence: {
            implementation: ['src/gate.ts'],
            verification: ['src/__tests__/gate.test.ts'],
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
      },
    }),
    ['fractional', 'missing', 'unknown', 'unranked'],
  );
});

test('capability evidence requires explicit states and code plus test evidence for implemented claims', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-capability-evidence-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'feature.ts'), 'export const feature = true;\n');
  writeFileSync(join(root, 'src', 'feature.test.ts'), "test('feature', () => true);\n");

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
          implementation: ['src/feature.ts'],
          verification: ['src/feature.test.ts'],
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
          implementation: ['src/missing.ts'],
          verification: [],
        },
      ],
    }),
    [
      'capability evidence positioning is not canonical',
      'capability evidence is missing status: delegated',
      'capability evidence is missing status: unsupported',
      'implemented claim feature has no verification evidence',
      'claim feature references missing implementation evidence: src/missing.ts',
    ],
  );
});

test('capability evidence rejects duplicate ids and non-executable verification evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-capability-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'src', 'feature.ts'), 'export const feature = true;\n');
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
          implementation: ['src/feature.ts'],
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
