import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { filesUnder, missingCanonicalRouteIds } from '../../scripts/preflight-docs.js';

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
