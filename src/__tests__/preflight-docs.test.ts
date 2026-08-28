import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
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
