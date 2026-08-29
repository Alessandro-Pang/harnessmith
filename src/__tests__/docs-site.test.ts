import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

test('documentation site has reproducible local build, search, links, and Pages deployment', () => {
  const manifest = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(manifest.devDependencies?.vitepress, '1.6.4');
  assert.equal(manifest.scripts?.['docs:dev'], 'vitepress dev docs');
  assert.equal(manifest.scripts?.['docs:build'], 'vitepress build docs');
  assert.equal(manifest.scripts?.['docs:preview'], 'vitepress preview docs');
  assert.equal(manifest.scripts?.['docs:check'], 'vitepress build docs');

  const config = read('docs/.vitepress/config.ts');
  assert.match(config, /base:\s*['"]\/harnessmith\/['"]/);
  assert.match(config, /provider:\s*['"]local['"]/);
  assert.match(config, /lang:\s*['"]en['"]/);
  assert.doesNotMatch(config, /ignoreDeadLinks:\s*true/);

  assert.match(read('docs/.vitepress/theme/custom.css'), /:focus-visible/);

  const workflow = read('.github/workflows/docs.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /pnpm run docs:build/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});

test('documentation site covers user, contributor, architecture, boundary, and history routes', () => {
  const pages = [
    'docs/index.md',
    'docs/guide/getting-started.md',
    'docs/guide/hosts.md',
    'docs/guide/lifecycle.md',
    'docs/reference/cli.md',
    'docs/architecture.md',
    'docs/concepts/design-principles.md',
    'docs/concepts/boundaries.md',
    'docs/concepts/memory-and-tasks.md',
    'docs/content-strategy.md',
    'docs/contributing.md',
    'docs/references.md',
    'docs/decisions/index.md',
    'docs/decisions/0001-documentation-site.md',
    'docs/versions/migrations.md',
    'docs/en/index.md',
    'docs/en/getting-started.md',
  ];

  for (const page of pages) {
    assert.equal(existsSync(join(root, page)), true, `${page} must exist`);
    const content = read(page);
    assert.match(content, /^---\n[\s\S]*?owner:\s*maintainers\n[\s\S]*?---\n/);
    assert.match(content, /^#\s+.+/m);
  }
});

test('concise bilingual READMEs preserve onboarding and safety while routing depth to docs', () => {
  const chinese = read('README.md');
  const english = read('README.en.md');

  assert.ok(chinese.split('\n').length <= 180, 'README.md must stay concise');
  assert.ok(english.split('\n').length <= 180, 'README.en.md must stay concise');
  assert.match(chinese, /https:\/\/alexpang\.cn\/harnessmith\//);
  assert.match(english, /https:\/\/alexpang\.cn\/harnessmith\/en\//);

  for (const content of [chinese, english]) {
    assert.match(content, /npx harnessmith/);
    assert.match(content, /npx harnessmith status/);
    assert.match(content, /npx harnessmith restore/);
    assert.match(content, /npx harnessmith uninstall/);
    assert.match(content, /Codex/);
    assert.match(content, /Cursor/);
    assert.match(content, /Claude Code/);
    assert.match(content, /OpenCode/);
    assert.match(content, /Kimi Code/);
    assert.match(content, /docs\/capability-evidence\.yaml/);
  }

  assert.doesNotMatch(chinese, /^### 分层记忆$/m);
  assert.doesNotMatch(english, /^### Layered memory$/m);
});
