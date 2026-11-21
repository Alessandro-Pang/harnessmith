import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { elementAt } from '../../../../packages/harness/src/__tests__/helpers/harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

test('concise bilingual READMEs preserve onboarding and safety while routing depth to apps/docs/site', () => {
  const chinese = read('README.md');
  const english = read('README.en.md');

  assert.ok(chinese.split('\n').length <= 180, 'README.md must stay concise');
  assert.ok(english.split('\n').length <= 180, 'README.en.md must stay concise');
  assert.match(chinese, /https:\/\/alexpang\.cn\/harnessmith\//);
  assert.match(english, /https:\/\/alexpang\.cn\/harnessmith\/en\//);
  // Canonical positioning prose is owned by public-positioning.test.ts; the READMEs only
  // need the onboarding path, safety commands, host list, and the evidence pointer.

  for (const content of [chinese, english]) {
    assert.match(content, /npm install -g harnessmith/);
    assert.match(content, /npx --yes harnessmith/);
    assert.match(content, /harnessmith status/);
    assert.match(content, /harnessmith restore/);
    assert.match(content, /harnessmith uninstall/);
    assert.match(content, /Codex/);
    assert.match(content, /Cursor/);
    assert.match(content, /Claude Code/);
    assert.match(content, /OpenCode/);
    assert.match(content, /Kimi Code/);
    assert.match(content, /apps\/docs\/site\/capability-evidence\.yaml/);
  }

  assert.doesNotMatch(chinese, /^### 分层记忆$/m);
  assert.doesNotMatch(english, /^### Layered memory$/m);
});

test('READMEs state skills-delegated installation and a package-bundled Runtime that is never copied', () => {
  const chinese = read('README.md');
  const english = read('README.en.md');

  assert.match(chinese, /固定版本的 `skills`/);
  assert.match(chinese, /Runtime 只执行 npm 包内与 CLI 同版本的 bundle/);
  assert.match(english, /pinned `skills` package/);
  assert.match(english, /Runtime bundle shipped in the npm package/);
  for (const content of [chinese, english]) {
    assert.doesNotMatch(content, /~\/\.agents\/harnessmith/);
    assert.doesNotMatch(content, /scripts\/harness\.mjs/);
  }
});

test('README repository-relative links resolve to files that exist', () => {
  for (const readme of ['README.md', 'README.en.md']) {
    const content = read(readme);
    const targets = [
      ...[...content.matchAll(/<img\s+src="(\.[^"]+)"/g)].map((match) => elementAt(match, 1)),
      ...[...content.matchAll(/\]\((\.[^)#]+)(?:#[^)]*)?\)/g)].map((match) => elementAt(match, 1)),
    ];
    assert.ok(targets.length > 0, `${readme} should link repository files`);
    for (const target of targets) {
      assert.equal(existsSync(join(root, target)), true, `${readme} link ${target} must exist`);
    }
  }
});
