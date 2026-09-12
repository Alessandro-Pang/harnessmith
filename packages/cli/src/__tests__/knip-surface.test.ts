import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const config = JSON.parse(readFileSync(join(root, 'config', 'knip.json'), 'utf8')) as {
  workspaces: Record<string, { entry?: string[]; project?: string[] }>;
};

// A pattern that matches nothing makes the dead-code gate pass without analyzing anything, which is
// how the gate stayed green for a repository-wide `../` prefix mistake.
test('every knip entry and project pattern matches at least one file', () => {
  const workspaces = Object.entries(config.workspaces);
  assert.ok(workspaces.length > 0, 'knip must declare workspaces');

  for (const [workspace, patterns] of workspaces) {
    const cwd = join(root, workspace);
    for (const kind of ['entry', 'project'] as const) {
      const declared = patterns[kind] ?? [];
      assert.ok(declared.length > 0, `${workspace} declares no ${kind} patterns`);
      for (const pattern of declared) {
        assert.ok(
          globSync(pattern, { cwd }).length > 0,
          `knip ${kind} pattern matches no file: ${workspace} -> ${pattern}`,
        );
      }
    }
  }
});

test('knip analyses both distributed packages and the repository tooling', () => {
  for (const workspace of ['.', 'packages/cli', 'packages/harness']) {
    assert.ok(config.workspaces[workspace], `knip must analyse ${workspace}`);
  }
});
