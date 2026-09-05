import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..', '..');
const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
const projectMemory = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
  'utf8',
);
const projectMemoryReference = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'references', 'memory-contracts.md'),
  'utf8',
);
const projectMemoryProtocol = [projectMemory, projectMemoryReference].join('\n');
const architecture = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'core', 'harness-cli-architecture.md'),
  'utf8',
);
const longRunning = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'core', 'long-running-tasks.md'),
  'utf8',
);
const longRunningReference = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'references', 'task-and-replay-contracts.md'),
  'utf8',
);
const longRunningProtocol = [longRunning, longRunningReference].join('\n');
const operatingModel = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'core', 'operating-model.md'),
  'utf8',
);
const executionLoop = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'core', 'execution-loop.md'),
  'utf8',
);
const docsIndex = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'README.md'),
  'utf8',
);
const userProfile = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'standards', 'user-profile-memory.md'),
  'utf8',
);
const userProfileReference = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'references', 'profile-contracts.md'),
  'utf8',
);
const userProfileProtocol = [userProfile, userProfileReference].join('\n');
const gitConventions = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'core', 'git-conventions.md'),
  'utf8',
);
const gitConventionsReference = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'references', 'git-project-overrides.md'),
  'utf8',
);
const cliContracts = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'references', 'cli-contracts.md'),
  'utf8',
);
const searchReference = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'references', 'search-and-benchmarks.md'),
  'utf8',
);

test('top-level rules preserve only durable trust authorization and delivery boundaries', () => {
  assert.match(agents, /宿主\/System.*用户当前明确授权.*个人规则.*项目规则/s);
  assert.match(agents, /仓库.*网页.*日志.*工具.*记忆.*不可信.*不授权/s);
  assert.match(agents, /只读.*用户请求.*目标对象.*不修改.*源码.*配置.*正式文档.*外部系统/s);
  assert.match(agents, /不自动禁止.*托管.*sidecar.*资格.*typed.*授权.*安全校验/s);
  assert.match(agents, /commit.*push.*merge.*发布.*远端写入.*明确授权/s);
  assert.match(agents, /事实源/);
  assert.match(agents, /验证.*未验证.*风险/s);
});

test('top-level prompt is a compact bootstrap instead of a Memory CLI manual', () => {
  const lines = agents.trimEnd().split('\n');
  assert.ok(lines.length <= 50, `template/AGENTS.md has ${lines.length} lines`);
  assert.ok(Math.max(...lines.map((line) => line.length)) <= 160);
  assert.doesNotMatch(
    agents,
    /capture-input|capture-experience|close-handoff|reconcile-profile|sourceRefs|--payload-file/,
  );
  assert.doesNotMatch(agents, /core\/git-conventions\.md/);
});

test('top-level rules route handoff field contracts to their single owner', () => {
  assert.doesNotMatch(agents, /clearOpen|reason.*multi-task|handoff mutation attempt/);
  assert.match(
    longRunningProtocol,
    /每次.*handoff.*attempt.*全新.*payload.*路径.*执行后.*冻结.*失败.*新路径/s,
  );
  assert.match(longRunningProtocol, /verification.*精确命令.*exit 0.*completed.*不能.*代替/s);
  assert.match(longRunningProtocol, /旧.*open.*全部.*resolved.*clearOpen.*true/s);
  assert.match(longRunningProtocol, /第二个.*独立.*已验证.*任务.*reason.*multi-task/s);
});

test('operating model separates target mutability from managed sidecar eligibility', () => {
  assert.match(operatingModel, /用户任务对象.*Harness sidecar/s);
  assert.match(operatingModel, /任务是否只读.*不决定.*Memory 资格/s);
  assert.match(operatingModel, /没有匹配.*typed.*proposal.*不得.*直接.*Markdown/s);
  assert.match(projectMemory, /negative eligibility.*价值.*来源.*typed writer.*授权.*安全/s);
  assert.match(
    projectMemory,
    /created.*updated.*unchanged.*proposed.*blocked.*not-evaluated.*reasonCode/s,
  );
  assert.match(projectMemory, /not-evaluated.*不得.*unchanged/s);
});

test('autopilot activation requires a bounded turn-end capture decision', () => {
  assert.match(
    agents,
    /每个用户回合交付前.*跨回合仍有价值.*必须静默执行对应 typed writer.*没有 sidecar hook.*最终回复前自行调用 Harness CLI/s,
  );
  assert.match(
    projectMemory,
    /每个用户回合.*交付前.*有界.*沉淀判定.*调用对应 typed writer.*写入后校验/s,
  );
  assert.match(projectMemory, /没有匹配 writer.*proposed.*blocked/);
  assert.match(
    projectMemory,
    /Harnesssmith 自身的产品目标、验收约束和实现缺陷属于项目正式事实或项目 Memory.*禁止提升为全局用户画像/s,
  );
  assert.match(
    executionLoop,
    /每个用户回合[\s\S]*deliver.*前[\s\S]*有界.*Memory 判定[\s\S]*typed writer/,
  );
  assert.match(executionLoop, /宿主没有 turn-end\/session-end hook.*自行调用\nHarness CLI/s);
});

test('top-level routing uses one primary playbook plus supporting topics without category exceptions', () => {
  assert.match(agents, /route.*--intent.*用户当前原文/s);
  assert.match(agents, /primaryPlaybook/);
  assert.match(agents, /topics/);
  assert.match(agents, /加载.*primaryPlaybook.*全部.*返回.*topics/s);
  assert.match(agents, /歧义.*停止|停止.*歧义/s);
  assert.match(
    agents,
    /路由查询.*用户当前原文.*不得.*改写.*遗漏.*验收.*未来默认.*仍有后续.*host-signal/s,
  );
  assert.match(
    agents,
    /本地 Harness.*Memory.*画像控制.*不是.*宿主产品.*不加载.*产品文档.*skill.*web/s,
  );
  assert.match(docsIndex, /primaryPlaybook/);
  assert.match(docsIndex, /topics/);
  assert.match(docsIndex, /显式.*intent.*唯一.*playbook/s);
  assert.match(docsIndex, /自动推断.*歧义.*unmatched/s);
  assert.doesNotMatch(docsIndex, /最高优先级.*playbook/);
});

test('startup rules retain progressive project discovery without copying its command sequence', () => {
  const profile = agents.indexOf('profile.md');
  const personal = agents.indexOf('AGENTS.md', profile + 1);
  const bootstrap = agents.indexOf('bootstrap', personal + 1);
  assert.ok(profile >= 0 && personal > profile && bootstrap > personal);
  assert.match(agents, /bootstrap.*--project.*--detail brief.*--json/s);
  assert.doesNotMatch(agents, /rg -n -C 12.*输出可见性/);
  assert.match(
    projectMemory,
    /brief.*metadata.*core.*maintenance.*推荐.*active task.*recommendations.*omitted.*full.*完整.*truncated/s,
  );
  assert.doesNotMatch(projectMemory, /memory list.*task status.*memory maintain/s);
  assert.doesNotMatch(agents, /memory list|task status|memory maintain/);
  assert.match(agents, /命中正文.*事实源/s);
});

test('startup requires a standalone bounded profile read as the first tool call', () => {
  assert.match(
    agents,
    /首个工具调用.*只能.*profile\.md.*不得.*项目.*命令|首个工具调用.*只包含.*profile\.md.*不得.*合并/s,
  );
});

test('operating model makes physical startup order explicit and distinct from logical discovery', () => {
  assert.match(operatingModel, /物理.*启动.*顺序.*profile\.md.*AGENTS\.md.*bootstrap/s);
  assert.doesNotMatch(
    operatingModel,
    /## 3\. 发现顺序\s+\n\s*1\. 当前用户目标.*\n\s*2\. 当前目录.*\n\s*3\. 每个新宿主/s,
  );
});

test('CLI architecture points at current source ownership and not stale package paths', () => {
  assert.match(architecture, /packages\/harness\/src\/cli\.ts/);
  assert.match(architecture, /packages\/harness\/src\/commands/);
  assert.match(architecture, /packages\/cli\/src\/adapters/);
  assert.doesNotMatch(architecture, /packages\/cli\/src\/commands|packages\/cli\/src\/lib/);
  assert.doesNotMatch(architecture, /packages\/cli\/src\/runtime\.ts/);
});

test('high-volume CLI details are deferred to bounded reference documents', () => {
  assert.ok(
    architecture.trimEnd().split('\n').length <= 140,
    `CLI architecture has ${architecture.trimEnd().split('\n').length} lines`,
  );
  assert.match(architecture, /references\/cli-contracts\.md/);
  assert.match(architecture, /references\/search-and-benchmarks\.md/);
  assert.match(architecture, /references\/prompt-examples\.md/);
});

test('CLI and search references keep low-frequency schemas, diagnostics, and recovery contracts bounded', () => {
  assert.ok(cliContracts.trimEnd().split('\n').length <= 220);
  for (const required of [
    'version --json',
    'schemaVersion',
    'memorySchemaVersion',
    'health --project',
    'audit record',
    'task verify',
    'repository-map',
    'memory repair',
    'install-context.json',
    'recovery path',
  ]) {
    assert.ok(cliContracts.includes(required), `CLI reference is missing: ${required}`);
  }
  assert.match(searchReference, /--refresh-index/);
  assert.match(searchReference, /--mode auto\|scan\|fulltext/);
  assert.doesNotMatch(architecture, /install-context\.json|--refresh-index|task verify/);
});

test('Git prompt names its standard and states project-specific deltas', () => {
  assert.match(gitConventions, /Conventional Commits 1\.0\.0/);
  assert.match(gitConventions, /分支名.*不是跨仓默认.*读取.*项目规则/s);
  assert.match(gitConventions, /git-project-overrides\.md/);
  assert.match(gitConventionsReference, /header.*100|100.*header/s);
  assert.match(gitConventionsReference, /scope.*kebab-case/s);
  assert.match(gitConventionsReference, /--print-config json/);
  assert.match(gitConventions, /commitlint.*读取并解析|resolved.*config/s);
  assert.doesNotMatch(gitConventions, /\^\(feature\|hotfix\|refactor\)/);
});

test('startup deterministically discovers one explicitly referenced project context before memory', () => {
  const personal = agents.indexOf('AGENTS.md');
  const projectEntry = agents.indexOf('README.md', personal + 1);
  const projectMemory = agents.indexOf('.agent-docs/', projectEntry + 1);
  assert.ok(personal >= 0 && projectEntry > personal && projectMemory > projectEntry);
  assert.match(
    agents,
    /项目根.*README\.md.*存在.*有界读取.*明确指定.*单个.*项目相对.*任务上下文.*单独读取/s,
  );
  assert.match(agents, /不递归.*不推断.*其它.*文件/s);
  assert.match(agents, /项目上下文.*不可信.*不授权/s);
});

test('the project-memory standard delegates deterministic startup discovery to bootstrap', () => {
  assert.match(projectMemory, /bootstrap --project <absolute-project-root> --detail brief --json/);
  assert.match(projectMemory, /只读.*不.*修复.*归档.*迁移.*索引/s);
  assert.match(projectMemory, /recommendations.*blocked\/active core.*事实源/s);
  assert.doesNotMatch(projectMemory, /sed -n '1,260p' \.agent-docs\/core\.md/);
});

test('project-memory core keeps the decision surface bounded and defers mechanical contracts', () => {
  assert.ok(
    projectMemory.trimEnd().split('\n').length <= 180,
    `project memory core has ${projectMemory.trimEnd().split('\n').length} lines`,
  );
  assert.match(projectMemory, /references\/memory-contracts\.md/);
  assert.match(projectMemoryReference, /metadata|payload|maintenance|repair/i);
  assert.match(projectMemoryReference, /proposalId|proposal identity/i);
});

test('the bounded output-visibility read retains the ordinary-sidecar classifier', () => {
  const lines = projectMemory.split('\n');
  const anchor = lines.findIndex((line) => line.trim() === '## 输出可见性');
  assert.ok(anchor >= 0);
  const boundedRead = lines.slice(Math.max(0, anchor - 12), anchor + 13).join('\n');

  assert.match(boundedRead, /即使触发自动 sidecar.*不等于索要 Memory 操作/s);
  assert.match(boundedRead, /后台 sidecar.*prior memory.*preserve expensive finding/s);
  assert.match(boundedRead, /commentary.*不以.*值得保留.*纳入结论.*保存.*更新意图/s);
});

test('background sidecars stay quiet while explicit Memory requests remain auditable', () => {
  assert.match(agents, /自动.*sidecar.*静默/s);
  assert.doesNotMatch(agents, /action.*path.*validation/s);
  assert.match(projectMemory, /自动后台.*静默/s);
  assert.match(projectMemory, /用户明确请求.*action.*path.*validation/s);
  assert.match(projectMemory, /字段名.*原样.*action.*path.*validation/s);
  assert.match(projectMemory, /正式结论.*handoff.*不能替代.*path/s);
  assert.doesNotMatch(agents, /恢复.*检索.*修复.*归档.*校验/s);
  assert.match(projectMemory, /自动后台 sidecar.*恢复.*检索.*写入.*校验.*维护.*静默/s);
  assert.match(projectMemory, /普通任务的 commentary\/final.*只报告用户任务/s);
  assert.doesNotMatch(agents, /action.*path.*validation.*\.agent-docs/s);
  assert.match(projectMemory, /普通任务.*不输出.*action.*path.*validation.*\.agent-docs/s);
  assert.match(projectMemory, /即使触发自动 sidecar.*不等于索要 Memory 操作/s);
  assert.match(projectMemory, /后台 sidecar.*prior memory.*preserve expensive finding/s);
  assert.match(
    projectMemory,
    /final.*事实本身作主语.*不提.*已保存.*已归档.*持久保留.*Memory 写入或校验/s,
  );
  assert.match(projectMemory, /final.*事实本身作主语/);
  assert.match(projectMemory, /final.*事实本身.*主语.*当前架构边界为.*不.*正式文档确认/s);
  assert.doesNotMatch(agents, /host-signal\/replay|agent_message/);
  assert.match(
    longRunningProtocol,
    /纯 host-signal\/replay.*允许空响应.*不得.*agent_message.*强制响应.*上一用户任务.*验证结果.*不提.*sidecar/s,
  );
  assert.match(
    projectMemory,
    /commentary.*只报告用户任务.*不预告.*后台维护.*不以.*(?:记录|保存|同步|更新).*意图/s,
  );
  assert.match(userProfile, /commentary.*不得.*预告.*(?:记录|保存|同步|更新).*(?:偏好|画像)/s);
});

test('documentation states the real host-hook and source-of-truth boundaries', () => {
  assert.match(projectMemory, /Memory.*非权威|非权威.*Memory/s);
  assert.match(architecture, /宿主事件 hook.*尚未提供/s);
  assert.match(architecture, /真实 Host Eval/s);
});

test('input capture policy distinguishes durable decisions from one-shot actions', () => {
  for (const purpose of [
    'constraint',
    'acceptance',
    'source',
    'risk-decision',
    'explicit-retain',
  ]) {
    assert.match(projectMemory, new RegExp(`\\b${purpose}\\b`));
  }
  assert.match(projectMemory, /提交.*发布.*继续.*不.*Important Inputs/s);
  assert.match(projectMemory, /不要发布.*持续|禁止.*持续/s);
  assert.match(projectMemory, /长度.*不是|不能.*字数/s);
  assert.match(projectMemory, /workstream.*durable/s);
  assert.match(projectMemory, /verbatim.*逐字|逐字.*verbatim/s);
  assert.match(cliContracts, /capture-input.*JSON payload.*sourceRefs.*复数.*不得.*sourceRef/s);
  assert.match(cliContracts, /source.*只接受.*chat.*file.*meeting.*link.*other/s);
  assert.match(userProfileProtocol, /evidence.*只接受.*explicit.*observed.*不得.*解释文本/s);
  assert.match(
    longRunningProtocol,
    /JSON payload.*旧.*open.*全部.*resolved.*只接受.*clearOpen.*true.*不得.*clear.*open.*占位/s,
  );
  assert.match(
    longRunningProtocol,
    /每次.*mutation attempt.*全新.*payload.*命令.*执行.*冻结.*失败.*不得.*覆盖.*复用.*重试.*新.*路径.*跨 turn.*replay.*例外/s,
  );
  assert.match(longRunningProtocol, /verification.*精确命令.*exit 0.*completed.*不能.*代替/s);
  assert.match(operatingModel, /一次性.*授权.*不.*捕获/s);
  assert.match(projectMemoryProtocol, /mode.*verbatim.*summary/s);
  assert.match(projectMemoryProtocol, /close-input.*core\.md/s);
});
