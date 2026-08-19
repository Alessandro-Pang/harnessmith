import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('llms.txt exposes a complete non-interactive install protocol', () => {
  const content = readFileSync(join(root, 'llms.txt'), 'utf8');
  for (const required of [
    'npx --yes harnessmith --agent <agents>',
    '--dry-run',
    'init global',
    'init project',
    'memory check global',
    'Codex',
    'Cursor',
    'Claude Code',
    '.backup-<timestamp>',
    '--force',
    'conflict',
    'harnessmith status',
    'harnessmith restore',
    'harnessmith uninstall',
  ]) {
    assert.ok(content.includes(required), `llms.txt is missing: ${required}`);
  }
  assert.doesNotMatch(content, /create-coding-agent-harness/);
});

test('public docs distinguish the unreleased source workflow from post-publication npx usage', () => {
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');

  assert.match(llms, /Release status: unreleased/);
  assert.match(llms, /node bin\/harnessmith\.mjs/);
  assert.match(readme, /尚未发布到 npm/);
  assert.match(english, /not yet published to npm/i);
  assert.match(security, /No versions have been published yet/);
});

test('npm package includes llms.txt', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const path of [
    'llms.txt',
    'README.en.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CHANGELOG.md',
    'RELEASING.md',
    'evals/README.md',
    'evals/scenarios.json',
  ])
    assert.ok(manifest.files.includes(path), `npm package is missing: ${path}`);
  assert.ok(!manifest.files.some((path: string) => path.includes('__tests__')));
});

test('npm package publishes the Harness runtime without its TypeScript sources', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const path of [
    'template/AGENTS.md',
    'template/agent-harness/bin',
    'template/agent-harness/dist',
    'template/agent-harness/docs',
    'template/agent-harness/manifest.json',
    'template/agent-harness/schemas',
    'template/agent-harness/templates',
  ])
    assert.ok(manifest.files.includes(path), `npm package is missing: ${path}`);
  assert.ok(!manifest.files.includes('template'));
  assert.ok(!manifest.files.some((path: string) => path.includes('agent-harness/src')));
});

test('distributed Harness template contains no host product identity', () => {
  const pending = [join(root, 'template')];
  while (pending.length > 0) {
    const directory = pending.pop();
    assert.ok(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        const content = readFileSync(path, 'utf8');
        assert.doesNotMatch(content, /\b(codex|cursor|claude)\b/i, path);
        assert.doesNotMatch(
          content,
          /CODEX_HOME|CLAUDE_CONFIG_DIR|DP_REPO_ROOT|dp-repository/i,
          path,
        );
      }
    }
  }
});
