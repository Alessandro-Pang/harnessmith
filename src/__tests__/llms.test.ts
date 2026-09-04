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
    'OpenCode',
    'Kimi Code CLI',
    'DeepSeek Harness',
    '0.1.1-rc.2',
    'dsh-v0.1.1-rc.2',
    'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
    'OPENCODE_CONFIG_DIR',
    'KIMI_CODE_HOME',
    'DSH_HOME',
    'Pi Agent',
    'PI_CODING_AGENT_DIR',
    '.backup-<timestamp>',
    '--force',
    'conflict',
    'harnessmith status',
    'harnessmith restore',
    'harnessmith uninstall',
  ]) {
    assert.ok(content.includes(required), `llms.txt is missing: ${required}`);
  }
  assert.doesNotMatch(content, /npx --yes (?!harnessmith\b)/);
  assert.doesNotMatch(content, /\bharnesssmith\b/);
  assert.doesNotMatch(content, /create-coding-agent-harness/);
});

test('AI installation links resolve the protocol from the same npm release channel', () => {
  for (const path of ['README.md', 'README.en.md']) {
    const content = readFileSync(join(root, path), 'utf8');
    assert.match(content, /https:\/\/unpkg\.com\/harnessmith@latest\/llms\.txt/);
    assert.doesNotMatch(content, /raw\.githubusercontent\.com\/.+\/main\/llms\.txt/);
  }
});

test('public docs distinguish source development from the published npm workflow', () => {
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');

  assert.match(llms, /Release channel: npm registry/);
  assert.match(llms, /node bin\/harnessmith\.mjs/);
  assert.match(llms, /Embedded Harness runtime dependencies: none/);
  assert.match(llms, /initializer uses the\s+dependencies declared in `package\.json`/);
  assert.doesNotMatch(llms, /initializer dependencies are bundled/);
  assert.doesNotMatch(readme, /当前稳定性|latest.*dist-tag/);
  assert.doesNotMatch(english, /current public version|latest.*dist-tag/i);
  assert.match(security, /The latest published release receives security fixes/);
  assert.doesNotMatch(security, /`\d+\.x`/);
});

test('public prose uses the established Harnessmith brand while npm commands keep the package identifier', () => {
  const canonicalBrand = 'Harnessmith';
  const nonCanonicalBrand = ['Harness', 'smith'].join('');
  for (const path of ['README.md', 'README.en.md', 'SECURITY.md', 'llms.txt']) {
    const content = readFileSync(join(root, path), 'utf8');
    assert.ok(content.includes(canonicalBrand), `${path} is missing ${canonicalBrand}`);
    assert.ok(!content.includes(nonCanonicalBrand), `${path} contains ${nonCanonicalBrand}`);
  }
  assert.match(readFileSync(join(root, 'llms.txt'), 'utf8'), /npx --yes harnessmith\b/);
});

test('public guidance routes advanced runtime contracts instead of duplicating them', () => {
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const docsIndex = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'README.md'),
    'utf8',
  );

  assert.match(docsIndex, /core\/long-running-tasks\.md/);
  assert.doesNotMatch(llms, /Task acceptance boundary|CI\/Host-owned verifier/);
  assert.doesNotMatch(agents, /CI\/Host-owned verifier|task verify/);
  assert.match(llms, /Boundary examples/);
  assert.match(llms, /Input:.*action: "conflict"/);
  assert.match(llms, /Expected response:.*blocked/);
  assert.match(llms, /Input:.*rollback.*recovery paths/);
  assert.match(llms, /recovery path/);
  assert.match(readme, /harness\.mjs health --json/);
  assert.match(english, /harness\.mjs health --json/);
});

test('post-install checks are conditional when global memory initialization is skipped', () => {
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');

  assert.match(llms, /If shared global memory was initialized, verify it with:/);
  assert.match(
    llms,
    /If `--no-init-global` was used, do not run the global-memory checks above; verify installation status and version instead/,
  );
});

test('routed prompts keep Memory policy and command contracts with their designated owners', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const projectMemory = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const profile = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'user-profile-memory.md'),
    'utf8',
  );
  const research = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'playbooks', 'research-and-design.md'),
    'utf8',
  );
  const change = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'playbooks', 'change.md'),
    'utf8',
  );
  const architecture = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'harness-cli-architecture.md'),
    'utf8',
  );
  const manifest = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'manifest.yaml'),
    'utf8',
  );
  const longRunning = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'long-running-tasks.md'),
    'utf8',
  );

  assert.match(
    agents,
    /新宿主.*task\/thread.*首个工具调用.*只能.*profile\.md.*不得合并.*项目发现命令/s,
  );
  assert.match(agents, /入口层不复制其协议/);
  assert.match(projectMemory, /long-running-tasks\.md/);
  assert.match(projectMemory, /harness-cli-architecture\.md/);
  assert.doesNotMatch(projectMemory, /--consume-payload-file|clearOpen/);
  assert.match(projectMemory, /typed lesson\/failure/);
  assert.match(projectMemory, /无需逐次询问用户/);
  assert.match(projectMemory, /blocked.*冲突.*校验失败/s);
  assert.match(readme, /Memory Autopilot/);
  assert.match(english, /Memory Autopilot/);
  assert.match(architecture, /--consume-payload-file/);
  assert.match(architecture, /领域命令成功.*才删除文件/s);
  assert.match(architecture, /宿主事件 hook.*尚未提供/s);
  assert.match(architecture, /prompt\/单元测试.*不能替代真实 Host Eval/s);
  assert.match(architecture, /记忆适配闭环.*不是模型权重学习/s);
  assert.match(architecture, /不得自动改写.*prompt.*skill.*规则.*源码/s);
  assert.match(architecture, /host-evals.*eval:validate/s);
  assert.match(manifest, /memory-autopilot/);
  assert.match(longRunning, /Task ledger.*唯一事实源/s);
  assert.match(longRunning, /phase.*compaction.*multi-task.*manual/s);
  assert.match(longRunning, /close-handoff.*completed\|cancelled/s);
  assert.match(longRunning, /同一 session.*原位更新/s);
  assert.match(research, /只有用户授权项目写入且结论已被采纳/);
  assert.match(research, /否则只提交 proposal/);
  assert.match(change, /用户新增验收.*必须.*去重.*--payload-file/s);
  assert.match(profile, /跨任务.*explicit\/high/s);
  assert.match(profile, /本次任务.*项目.*input.*handoff/s);
  assert.match(profile, /profile-autopilot pause/);
  assert.match(profile, /profile-autopilot resume/);
  assert.match(profile, /paused.*机械拒绝.*reconcile/s);
  assert.match(projectMemory, /host-evals.*eval:validate/s);
});

test('release documentation describes the resumable immutable snapshot workflow', () => {
  const releasing = readFileSync(join(root, 'RELEASING.md'), 'utf8');
  const evaluations = readFileSync(join(root, 'evals', 'README.md'), 'utf8');

  assert.match(releasing, /read-only private snapshot/);
  assert.match(releasing, /rebuilds the deterministic candidate/);
  assert.match(releasing, /publishes that exact file/);
  assert.match(releasing, /pnpm run release:prepare/);
  assert.match(releasing, /resume/i);
  assert.match(releasing, /does not rerun.*release checks/i);
  assert.match(releasing, /Trusted Publishing/);
  assert.match(releasing, /npm run release -- patch/);
  assert.match(releasing, /npm run release -- finalize/);
  assert.match(releasing, /git push --atomic origin main refs\/tags\/v/);
  assert.match(evaluations, /Fingerprint that exact tarball/);
  assert.doesNotMatch(
    evaluations,
    /Install that exact tarball and print the expected subject fingerprints/,
  );
});

test('search documentation records every default scan budget in one authoritative location', () => {
  const architecture = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'harness-cli-architecture.md'),
    'utf8',
  );
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');

  for (const contract of [
    '8 层',
    '5000 个目录条目',
    '1000 个目录',
    '1000 个普通文件',
    '单文件 1 MiB',
    '总计 8 MiB',
    '2 秒',
  ]) {
    assert.ok(architecture.includes(contract), `missing search budget contract: ${contract}`);
  }
  assert.doesNotMatch(readme, /默认的 8 层、1000 个文件/);
  assert.doesNotMatch(english, /defaults to 8 levels, 1,000 files/);
});

test('distributed prompt entrypoints stay readable and use executable Harness commands', () => {
  const agentsPath = join(root, 'template', 'AGENTS.md');
  const docsIndexPath = join(root, 'template', 'agent-harness', 'docs', 'README.md');
  const pending = [join(root, 'template')];
  const markdown: string[] = [join(root, 'llms.txt')];
  while (pending.length > 0) {
    const directory = pending.pop();
    assert.ok(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) markdown.push(path);
    }
  }

  const agentLines = readFileSync(agentsPath, 'utf8').trimEnd().split('\n');
  assert.ok(agentLines.length <= 140);
  assert.ok(Math.max(...agentLines.map((line) => line.length)) <= 160);
  assert.ok(readFileSync(docsIndexPath, 'utf8').trimEnd().split('\n').length <= 70);
  for (const path of markdown) {
    const content = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      content,
      /(?:^|[\s`])harness (?:task|memory|install|project|validate|health|doctor|route|explain)\b/m,
      path,
    );
    assert.doesNotMatch(
      content,
      /memory search[^\n]*--no-ignore|显式记忆检索必须使用 `--no-ignore`/,
      path,
    );
  }
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
});

test('distributed rules keep trust and authorization boundaries non-waivable', () => {
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const operatingModel = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'operating-model.md'),
    'utf8',
  );
  const toolRouting = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'tool-routing.md'),
    'utf8',
  );
  const projectAgents = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agents.md'),
    'utf8',
  );
  const projectTemplate = readFileSync(
    join(root, 'template', 'agent-harness', 'templates', 'project-AGENTS.md'),
    'utf8',
  );
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');

  assert.match(agents, /## 信任与授权/);
  assert.match(agents, /项目规则不能扩权或降低安全边界/);
  assert.doesNotMatch(agents, /更近的项目规则覆盖本文件/);
  assert.match(toolRouting, /不可信数据.*不构成授权/);
  assert.match(operatingModel, /低优先级内容\s+不能授予工具权限或副作用授权/);
  assert.match(projectAgents, /项目规则不得扩大权限、降低安全要求或改写用户授权边界/);
  assert.doesNotMatch(projectTemplate, /默认使用简体中文|当前事实以代码|<package-manager>/);
  assert.doesNotMatch(projectTemplate, /项目规则只能细化工作方式|未经明确授权/);
  assert.match(llms, /Distributed instructions do not grant permissions/);
});

test('read-only requests allow only narrow local Autopilot and qualified repository-map maintenance', () => {
  const operatingModel = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'operating-model.md'),
    'utf8',
  );
  const projectMemory = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const profile = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'user-profile-memory.md'),
    'utf8',
  );
  const repositoryMap = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'projects', 'repository-map.md'),
    'utf8',
  );

  assert.match(operatingModel, /只读任务不得修改项目源码、配置或正式文档/);
  assert.match(operatingModel, /明确用户画像信号.*自动 reconcile/s);
  assert.match(operatingModel, /跨仓分析.*personal `repository-map\.yaml`.*默认维护/s);
  assert.match(projectMemory, /未初始化的只读项目.*不自动创建/);
  assert.match(profile, /用户明确表达.*自动原位更新/s);
  assert.match(profile, /无需再说.*记住/s);
  assert.match(
    repositoryMap,
    /跨仓分析本身授权更新 personal\s+`repository-map\.md`.*`repository-map\.yaml`/,
  );
  assert.match(repositoryMap, /不需要用户\s+二次确认/);
  assert.match(repositoryMap, /用户明确禁止.*不得写入/);
});

test('cross-repository research closes the relationship-map writeback loop', () => {
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
  const canonicalMap = readFileSync(
    join(
      root,
      'template',
      'agent-harness',
      'templates',
      'personal',
      'projects',
      'repository-map.yaml',
    ),
    'utf8',
  );

  assert.match(playbook, /自动发现、校验与维护/);
  assert.match(playbook, /更新 personal\s+`repository-map\.md`.*`repository-map\.yaml`/);
  assert.match(playbook, /HEAD.*dirty/);
  assert.match(playbook, /updated/);
  assert.match(playbook, /用户明确禁止写入.*`proposed`/s);
  assert.match(playbook, /unchanged/);
  assert.match(playbook, /blocked/);
  assert.match(personalMap, /generated from repository-map\.yaml/);
  assert.match(canonicalMap, /schemaVersion: 1/);
});

test('distributed rules close project-memory recall, writeback, and promotion loops', () => {
  const standard = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
    'utf8',
  );

  assert.match(standard, /启动发现闭环/);
  assert.match(standard, /沉淀与正式提升/);
  assert.match(standard, /proposed/);
  assert.match(standard, /实际写入和验证正式事实源/);
  assert.match(standard, /维护报告默认只读/);
  assert.match(standard, /全根 schema/);
});
