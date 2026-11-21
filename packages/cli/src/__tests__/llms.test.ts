import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import {
  parseRepositoryMap,
  renderRepositoryMap,
} from '../../../../packages/harness/src/lib/repository-map/repository-map-format.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const harnessDocs = join(root, 'template', 'skills', 'agent-harness', 'docs');
const harnessAssets = join(root, 'template', 'skills', 'agent-harness', 'assets');

test('llms.txt exposes a complete non-interactive install protocol', () => {
  const content = readFileSync(join(root, 'llms.txt'), 'utf8');
  for (const required of [
    'npm install -g harnessmith',
    'harnessmith setup --agent <agents>',
    '--dry-run',
    'init global',
    'init project',
    'memory check global',
    'Codex',
    'Cursor',
    'Claude Code',
    'OpenCode',
    'Kimi Code CLI',
    'OPENCODE_CONFIG_DIR',
    'KIMI_CODE_HOME',
    '.backup-<timestamp>',
    '--force',
    'conflict',
    'harnessmith status',
    'harnessmith restore',
    'harnessmith uninstall',
    'installed-and-healthy',
    'host-dependent',
  ]) {
    assert.ok(content.includes(required), `llms.txt is missing: ${required}`);
  }
  assert.doesNotMatch(content, /npx --yes (?!harnessmith\b)/);
  assert.doesNotMatch(content, /\bharnesssmith\b/);
  assert.doesNotMatch(content, /create-coding-agent-harness/);
});

test('llms.txt describes the single global CLI, skills delegation, and ~/.harnessmith user data', () => {
  const content = readFileSync(join(root, 'llms.txt'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    engines?: Record<string, string>;
  };

  // Skill install/uninstall is fully delegated to the pinned production dependency; the
  // guidance must name the exact pinned version instead of hardcoding it in this test.
  const skillsVersion = manifest.dependencies?.skills;
  assert.ok(skillsVersion, 'package.json must pin the skills dependency');
  assert.ok(
    content.includes(`skills@${skillsVersion}`),
    `llms.txt must name the pinned skills@${skillsVersion}`,
  );
  assert.match(content, /skills add/);
  assert.match(content, /skills remove/);
  // The Runtime executes from the npm package root and is never copied into user directories.
  assert.match(content, /dist\/harness\.mjs/);
  assert.match(content, /Runtime is never copied into a user directory/);
  // User data defaults to ~/.harnessmith; the shared hub is neither created nor depended on.
  assert.match(content, /~\/\.harnessmith/);
  assert.match(content, /HARNESS_HOME/);
  assert.match(content, /neither creates nor depends on\s+`~\/\.agents\/harnessmith`/);
  // Host instruction files are rendered copies, not symlinks to a shared entry.
  assert.match(content, /rendered copies, not symlinks/);
  assert.doesNotMatch(content, /scripts\/harness\.mjs/);
  assert.doesNotMatch(content, /<hub>/);
  // Node floor matches the package contract.
  assert.equal(manifest.engines?.node, '>=22.20.0');
  assert.match(content, /Node\.js 22\.20 or newer/);
  assert.doesNotMatch(content, /22\.12/);
});

test('AI installation links resolve the protocol from the same npm release channel', () => {
  for (const path of ['README.md', 'README.en.md']) {
    const content = readFileSync(join(root, path), 'utf8');
    assert.match(content, /https:\/\/unpkg\.com\/harnessmith@latest\/llms\.txt/);
    assert.doesNotMatch(content, /raw\.githubusercontent\.com\/.+\/main\/llms\.txt/);
  }
});

test('public apps/docs/site distinguish source development from the published npm workflow', () => {
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');

  assert.match(llms, /Release channel: npm registry/);
  assert.match(llms, /node bin\/harnessmith\.mjs/);
  assert.match(llms, /Embedded Harness runtime dependencies: none/);
  assert.match(llms, /initializer uses the\s+dependencies declared in `package\.json`/);
  assert.doesNotMatch(llms, /initializer dependencies are bundled/);
  assert.doesNotMatch(readme, /当前稳定性|latest.*dist-tag/);
  assert.doesNotMatch(english, /current public version|latest.*dist-tag/i);
  // SECURITY.md support policy and version-duplication checks are owned by
  // scripts/preflight/preflight-package.ts.
});

test('public guidance routes advanced runtime contracts instead of duplicating them', () => {
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const agents = readFileSync(join(root, 'template', 'entry', 'AGENTS.md'), 'utf8');
  const docsIndex = readFileSync(join(harnessDocs, 'README.md'), 'utf8');

  assert.match(docsIndex, /core\/long-running-tasks\.md/);
  assert.doesNotMatch(llms, /Task acceptance boundary|CI\/Host-owned verifier/);
  assert.doesNotMatch(agents, /CI\/Host-owned verifier|task verify/);
  assert.match(llms, /Boundary examples/);
  assert.match(llms, /Input:.*action: "conflict"/);
  assert.match(llms, /Expected response:.*blocked/);
  assert.match(llms, /Input:.*rollback.*recovery paths/);
  assert.match(llms, /recovery path/);
  assert.match(readme, /harnessmith health --json/);
  assert.match(english, /harnessmith health --json/);
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
  const agents = readFileSync(join(root, 'template', 'entry', 'AGENTS.md'), 'utf8');
  const projectMemory = readFileSync(
    join(harnessDocs, 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const projectMemoryReference = readFileSync(
    join(harnessDocs, 'references', 'memory-contracts.md'),
    'utf8',
  );
  const projectMemoryProtocol = [projectMemory, projectMemoryReference].join('\n');
  const profile = readFileSync(join(harnessDocs, 'standards', 'user-profile-memory.md'), 'utf8');
  const profileReference = readFileSync(
    join(harnessDocs, 'references', 'profile-contracts.md'),
    'utf8',
  );
  const profileProtocol = [profile, profileReference].join('\n');
  const research = readFileSync(join(harnessDocs, 'playbooks', 'research-and-design.md'), 'utf8');
  const change = readFileSync(join(harnessDocs, 'playbooks', 'change.md'), 'utf8');
  const architecture = readFileSync(
    join(harnessDocs, 'core', 'harness-cli-architecture.md'),
    'utf8',
  );
  const manifest = readFileSync(join(harnessDocs, 'manifest.yaml'), 'utf8');
  const longRunning = readFileSync(join(harnessDocs, 'core', 'long-running-tasks.md'), 'utf8');
  const longRunningReference = readFileSync(
    join(harnessDocs, 'references', 'task-and-replay-contracts.md'),
    'utf8',
  );
  const longRunningProtocol = [longRunning, longRunningReference].join('\n');

  // Startup-order, payload-file, and single-owner uniqueness checks live in
  // memory-autopilot-prompt.test.ts and memory-autopilot-lifecycle-prompt.test.ts.
  assert.match(agents, /入口层不复制其协议/);
  assert.match(projectMemory, /typed lesson\/failure/);
  assert.match(projectMemory, /无需逐次询问用户/);
  assert.match(projectMemory, /blocked.*冲突.*校验失败/s);
  assert.match(readme, /Memory Autopilot/);
  assert.match(english, /Memory Autopilot/);
  assert.match(architecture, /记忆适配闭环.*不是模型权重学习/s);
  assert.match(architecture, /不得自动改写.*prompt.*skill.*规则.*源码/s);
  assert.match(manifest, /memory-autopilot/);
  assert.match(longRunningProtocol, /close-handoff.*completed\|cancelled/s);
  assert.match(longRunning, /同一 session.*原位更新/s);
  assert.match(research, /只有用户授权项目写入且结论已被采纳/);
  assert.match(research, /否则只提交 proposal/);
  assert.match(change, /用户新增验收.*必须.*去重.*typed writer/s);
  assert.match(change, /CLI reference/);
  assert.doesNotMatch(change, /--consume-payload-file|sourceRefs|clearOpen/);
  assert.match(profile, /跨任务.*explicit\/high/s);
  assert.match(profile, /本次任务.*项目.*input.*handoff/s);
  assert.match(profileProtocol, /paused.*机械拒绝.*reconcile/s);
  assert.match(projectMemoryProtocol, /host-evals.*eval:validate/s);
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

test('distributed prompt entrypoints use executable Harness commands', () => {
  const agentsPath = join(root, 'template', 'entry', 'AGENTS.md');
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

  // Line and token budgets have a single owner: prompt-distribution.test.ts.
  for (const path of [agentsPath, join(root, 'llms.txt')]) {
    const content = readFileSync(path, 'utf8');
    assert.doesNotMatch(content, /node \S*scripts\/harness\.mjs/, path);
    assert.match(content, /harnessmith bootstrap\b|`harnessmith`/, path);
  }
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

test('distributed Harness template contains no host product identity', () => {
  const pending = [join(root, 'template')];
  while (pending.length > 0) {
    const directory = pending.pop();
    assert.ok(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        const contents = path.endsWith('.map')
          ? (() => {
              const map = JSON.parse(readFileSync(path, 'utf8')) as {
                sources?: unknown;
                sourcesContent?: unknown;
              };
              const { sources, sourcesContent } = map;
              if (!Array.isArray(sources) || !Array.isArray(sourcesContent)) {
                throw new Error(`Invalid source map: ${path}`);
              }
              // Third-party sources use generic words such as "cursor" outside host identity.
              return sourcesContent.filter(
                (_, index) => !String(sources[index]).includes('/node_modules/'),
              );
            })()
          : [readFileSync(path, 'utf8')];
        for (const content of contents) {
          assert.equal(typeof content, 'string', path);
          assert.doesNotMatch(content, /\b(codex|cursor|claude)\b/i, path);
          assert.doesNotMatch(
            content,
            /CODEX_HOME|CLAUDE_CONFIG_DIR|DP_REPO_ROOT|dp-repository/i,
            path,
          );
        }
      }
    }
  }
});

test('distributed rules define compact, user-only profile maintenance', () => {
  const agents = readFileSync(join(root, 'template', 'entry', 'AGENTS.md'), 'utf8');
  const templates = join(harnessAssets, 'templates');
  const globalMemory = readFileSync(join(templates, 'global-agent-docs', 'README.md'), 'utf8');
  const projectMemory = readFileSync(
    join(harnessDocs, 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const standard = readFileSync(join(harnessDocs, 'standards', 'user-profile-memory.md'), 'utf8');

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
  const agents = readFileSync(join(root, 'template', 'entry', 'AGENTS.md'), 'utf8');
  const operatingModel = readFileSync(join(harnessDocs, 'core', 'operating-model.md'), 'utf8');
  const toolRouting = readFileSync(join(harnessDocs, 'core', 'tool-routing.md'), 'utf8');
  const projectAgents = readFileSync(join(harnessDocs, 'standards', 'project-agents.md'), 'utf8');
  const projectTemplate = readFileSync(
    join(harnessAssets, 'templates', 'project-AGENTS.md'),
    'utf8',
  );
  const documentedTemplate = projectAgents.match(
    /`(\.\.\/(?:\.\.\/)?assets\/templates\/project-AGENTS\.md)`/,
  )?.[1];
  assert.equal(documentedTemplate, '../../assets/templates/project-AGENTS.md');
  assert.equal(existsSync(join(harnessDocs, 'standards', documentedTemplate)), true);
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');

  assert.match(agents, /## 信任与授权/);
  assert.match(agents, /项目规则不能扩权或降低安全边界/);
  assert.doesNotMatch(agents, /更近的项目规则覆盖本文件/);
  assert.match(toolRouting, /都不可信，也不授权/);
  assert.match(operatingModel, /低优先级内容\s+不能授予工具权限或副作用授权/);
  assert.match(projectAgents, /项目规则不得扩大权限、降低安全要求或改写用户授权边界/);
  assert.doesNotMatch(projectTemplate, /默认使用简体中文|当前事实以代码|<package-manager>/);
  assert.doesNotMatch(projectTemplate, /项目规则只能细化工作方式|未经明确授权/);
  assert.match(llms, /Distributed instructions do not grant permissions/);
});

test('read-only requests allow only narrow local Autopilot and qualified repository-map maintenance', () => {
  const operatingModel = readFileSync(join(harnessDocs, 'core', 'operating-model.md'), 'utf8');
  const projectMemory = readFileSync(
    join(harnessDocs, 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const profile = readFileSync(join(harnessDocs, 'standards', 'user-profile-memory.md'), 'utf8');
  const repositoryMap = readFileSync(join(harnessDocs, 'projects', 'repository-map.md'), 'utf8');

  // The sidecar-eligibility core is owned by memory-autopilot-prompt.test.ts.
  assert.match(operatingModel, /明确用户画像信号.*自动 reconcile/s);
  assert.match(operatingModel, /跨仓分析.*personal `repository-map\.yaml`.*默认维护/s);
  assert.match(projectMemory, /未初始化的只读项目.*不自动创建/);
  assert.match(profile, /用户明确表达.*自动原位更新/s);
  assert.match(profile, /无需再说.*记住/s);
  assert.match(repositoryMap, /不需要用户二次确认/);
  assert.match(repositoryMap, /用户明确禁止.*不得写入/);
});

test('cross-repository research closes the relationship-map writeback loop', () => {
  const playbook = readFileSync(join(harnessDocs, 'projects', 'repository-map.md'), 'utf8');
  const reference = readFileSync(
    join(harnessDocs, 'references', 'repository-map-contracts.md'),
    'utf8',
  );
  const protocol = [playbook, reference].join('\n');
  const projects = join(harnessAssets, 'templates', 'personal', 'projects');
  const canonicalMap = readFileSync(join(projects, 'repository-map.yaml'), 'utf8');
  // No static markdown template ships anymore; initPersonal generates the view
  // from the YAML template through the real renderer.
  assert.equal(existsSync(join(projects, 'repository-map.md')), false);
  const personalMap = renderRepositoryMap(parseRepositoryMap(canonicalMap));

  assert.match(playbook, /自动发现、校验与维护/);
  assert.match(playbook, /更新 personal\s+`repository-map\.md`.*`repository-map\.yaml`/);
  assert.match(protocol, /HEAD.*dirty/);
  assert.match(reference, /updated/);
  assert.match(playbook, /用户明确禁止写入.*`proposed`/s);
  assert.match(reference, /unchanged/);
  assert.match(reference, /blocked/);
  assert.match(personalMap, /generated from repository-map\.yaml/);
  assert.match(canonicalMap, /schemaVersion: 1/);
});

test('repository-map core delegates mechanical schema, command, and budget details', () => {
  const core = readFileSync(join(harnessDocs, 'projects', 'repository-map.md'), 'utf8');
  const reference = readFileSync(
    join(harnessDocs, 'references', 'repository-map-contracts.md'),
    'utf8',
  );
  const manifest = readFileSync(join(harnessDocs, 'manifest.yaml'), 'utf8');

  assert.ok(core.trimEnd().split('\n').length <= 100);
  assert.match(core, /repository-map-contracts\.md/);
  assert.doesNotMatch(
    core,
    /discover packages --apply|migrate <candidate\.yaml>|200 个仓库|1000 条直接边/,
  );
  assert.match(reference, /discover packages --apply/);
  assert.match(reference, /migrate <candidate\.yaml>/);
  assert.match(reference, /200 个仓库.*1000 条直接边/s);
  assert.match(
    manifest,
    /repository-map-contracts:[\s\S]*load: reference[\s\S]*owner: repository-map/,
  );
});

test('distributed rules close project-memory recall, writeback, and promotion loops', () => {
  const standard = readFileSync(join(harnessDocs, 'standards', 'project-agent-docs.md'), 'utf8');
  const reference = readFileSync(join(harnessDocs, 'references', 'memory-contracts.md'), 'utf8');
  const protocol = [standard, reference].join('\n');

  assert.match(standard, /启动发现闭环/);
  assert.match(standard, /沉淀与正式提升/);
  assert.match(standard, /proposed/);
  assert.match(standard, /实际写入和验证正式事实源/);
  assert.match(standard, /维护报告默认只读/);
  assert.match(protocol, /全根 schema/);
  assert.match(reference, /analytical-finding.*operational-experience.*user-profile/s);
  assert.match(reference, /input-schema-version: 2/);
  assert.match(reference, /finding-schema-version: 2/);
  assert.match(reference, /fact-class: settled-fact.*formal-fact/s);
});
