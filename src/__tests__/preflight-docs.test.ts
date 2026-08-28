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
    ['review'],
  );
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
