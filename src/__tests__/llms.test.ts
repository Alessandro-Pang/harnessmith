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

test('public docs distinguish source development from the published npm workflow', () => {
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');

  assert.match(llms, /Release channel: npm registry/);
  assert.match(llms, /node bin\/harnessmith\.mjs/);
  assert.doesNotMatch(readme, /当前稳定性|latest.*dist-tag/);
  assert.doesNotMatch(english, /current public version|latest.*dist-tag/i);
  assert.match(security, /The latest published release receives security fixes/);
  assert.doesNotMatch(security, /`\d+\.x`/);
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

test('distributed rules define compact, user-only profile maintenance', () => {
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const globalMemory = readFileSync(
    join(root, 'template', 'agent-harness', 'templates', 'global-agent-docs', 'README.md'),
    'utf8',
  );
  const projectMemory = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const standard = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'user-profile-memory.md'),
    'utf8',
  );

  assert.match(agents, /profile\.md/);
  assert.match(agents, /用户画像/);
  assert.match(standard, /只记录用户本身/);
  assert.match(standard, /同一维度原位改写/);
  assert.match(standard, /当前状态优先/);
  assert.match(standard, /不得推断敏感属性/);
  assert.match(standard, /最多 32 条/);
  assert.match(standard, /唯一的当前用户画像/);
  assert.match(standard, /来源或历史证据/);
  assert.match(globalMemory, /用户偏好和身份只写入 `profile\.md`/);
  assert.doesNotMatch(globalMemory, /跨多个仓库复用的偏好、经历/);
  assert.match(projectMemory, /不得维护当前用户画像/);
  assert.match(agents, /宿主原生 memory 只作为待核对线索/);
});

test('cross-repository research closes the relationship-map writeback loop', () => {
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const playbook = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'projects', 'repository-map.md'),
    'utf8',
  );
  const personalMap = readFileSync(
    join(
      root,
      'template',
      'agent-harness',
      'templates',
      'personal',
      'projects',
      'repository-map.md',
    ),
    'utf8',
  );

  assert.match(agents, /交付前评估本次发现/);
  assert.match(agents, /updated、unchanged 或 blocked/);
  assert.match(playbook, /写回闭环/);
  assert.match(playbook, /更新 personal `repository-map\.md`/);
  assert.match(playbook, /动态状态/);
  assert.match(playbook, /updated/);
  assert.match(playbook, /unchanged/);
  assert.match(playbook, /blocked/);
  assert.match(personalMap, /正式来源/);
  assert.match(personalMap, /不要写入当前分支/);
});
