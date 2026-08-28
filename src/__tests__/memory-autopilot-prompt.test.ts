import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
const projectMemory = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
  'utf8',
);
const architecture = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'core', 'harness-cli-architecture.md'),
  'utf8',
);
const operatingModel = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'core', 'operating-model.md'),
  'utf8',
);
const docsIndex = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'README.md'),
  'utf8',
);

test('top-level rules preserve only durable trust authorization and delivery boundaries', () => {
  assert.match(agents, /宿主\/System.*用户当前明确授权.*个人规则.*项目规则/s);
  assert.match(agents, /仓库.*网页.*日志.*工具.*记忆.*不可信.*不授权/s);
  assert.match(agents, /只读.*不写源码.*配置.*正式文档/s);
  assert.match(agents, /commit.*push.*merge.*发布.*远端写入.*明确授权/s);
  assert.match(agents, /事实源/);
  assert.match(agents, /验证.*未验证.*风险/s);
});

test('top-level prompt is a compact bootstrap instead of a Memory CLI manual', () => {
  const lines = agents.trimEnd().split('\n');
  assert.ok(lines.length <= 60, `template/AGENTS.md has ${lines.length} lines`);
  assert.ok(Math.max(...lines.map((line) => line.length)) <= 160);
  assert.doesNotMatch(
    agents,
    /capture-input|capture-experience|close-handoff|reconcile-profile|clearOpen|sourceRefs|--payload-file/,
  );
  assert.doesNotMatch(agents, /core\/git-conventions\.md/);
});

test('top-level routing uses one primary playbook plus supporting topics without category exceptions', () => {
  assert.match(agents, /primaryPlaybook/);
  assert.match(agents, /topics/);
  assert.match(agents, /歧义.*停止|停止.*歧义/s);
  assert.match(docsIndex, /primaryPlaybook/);
  assert.match(docsIndex, /topics/);
});

test('startup rules retain progressive project discovery without copying its command sequence', () => {
  const profile = agents.indexOf('profile.md');
  const personal = agents.indexOf('AGENTS.md', profile + 1);
  const project = agents.indexOf('project-agent-docs.md');
  assert.ok(profile >= 0 && personal > profile && project > personal);
  assert.match(agents, /发现.*\.agent-docs.*首个.*Memory.*命令.*只读.*输出可见性/s);
  assert.match(agents, /不得.*合并.*其它.*读取/s);
  assert.match(agents, /rg -n -C 12.*输出可见性.*project-agent-docs\.md/s);
  assert.match(
    projectMemory,
    /metadata.*core\.md.*active\/blocked task.*维护候选.*命中正文.*事实源/s,
  );
  assert.match(projectMemory, /每个阶段.*单独命令.*不得.*合并/s);
  assert.match(
    projectMemory,
    /memory list.*--json.*core\.md.*task status.*--project.*--json.*memory maintain.*--json/s,
  );
  assert.match(projectMemory, /事实源.*单独命令.*sed.*docs\/architecture/s);
  assert.match(
    projectMemory,
    /contradicted.*supersede.*archive.*expired.*无独有.*archive.*indexed/s,
  );
  assert.doesNotMatch(agents, /memory list|task status|memory maintain/);
  assert.match(agents, /命中正文.*事实源/s);
});

test('the bounded first project-memory read contains the complete executable startup contract', () => {
  const lines = projectMemory.split('\n');
  const anchor = lines.findIndex(
    (line) => line.includes('已有 `.agent-docs/`') && line.includes('输出可见性'),
  );
  assert.ok(anchor >= 0);
  const boundedRead = lines.slice(Math.max(0, anchor - 12), anchor + 13).join('\n');

  assert.match(
    boundedRead,
    /memory list.*--json.*core\.md.*task status.*--project.*--json.*memory maintain.*--json/s,
  );
  assert.match(boundedRead, /完成.*事实源.*前.*禁止.*agent_message.*commentary/s);
  assert.match(boundedRead, /事实源.*单独命令.*sed.*docs\/architecture/s);
  assert.match(boundedRead, /memory list.*空输出.*原样重试一次/s);
  assert.match(boundedRead, /maintain.*全部.*unindexed.*expired.*active\/blocked/s);
  assert.match(boundedRead, /命中正文.*命令.*完成.*事实源.*新.*单独命令.*不得.*合并/s);
  assert.match(boundedRead, /同阶段.*多篇.*&&.*禁用.*;/s);
  assert.match(
    boundedRead,
    /contradicted.*supersede.*archive.*expired.*无独有.*archive.*memory check.*--indexed.*--json/s,
  );
});

test('the bounded output-visibility read retains the ordinary-sidecar classifier', () => {
  const lines = projectMemory.split('\n');
  const anchor = lines.findIndex((line) => line.trim() === '## 输出可见性');
  assert.ok(anchor >= 0);
  const boundedRead = lines.slice(Math.max(0, anchor - 12), anchor + 13).join('\n');

  assert.match(boundedRead, /即使触发自动 sidecar.*不等于索要操作/s);
  assert.match(boundedRead, /prior memory.*preserve expensive finding.*后台 sidecar/s);
  assert.match(boundedRead, /commentary.*不得.*值得保留.*纳入结论.*保存意图/s);
});

test('background sidecars stay quiet while explicit Memory requests remain auditable', () => {
  assert.match(agents, /自动.*sidecar.*静默/s);
  assert.match(agents, /明确.*Memory.*action.*path.*validation/s);
  assert.match(projectMemory, /自动后台.*静默/s);
  assert.match(projectMemory, /用户明确请求.*action.*path.*validation/s);
  assert.match(projectMemory, /字段名.*原样.*action.*path.*validation/s);
  assert.match(projectMemory, /正式结论.*handoff.*不能替代.*path/s);
  assert.match(agents, /普通任务.*Memory.*恢复.*检索.*修复.*归档.*校验.*不得.*commentary\/final/s);
  assert.match(
    projectMemory,
    /普通任务.*Memory.*恢复.*检索.*修复.*归档.*校验.*不得.*commentary\/final/s,
  );
  assert.match(agents, /普通任务.*不得.*action.*path.*validation.*\.agent-docs/s);
  assert.match(projectMemory, /普通任务.*不得.*action.*path.*validation.*\.agent-docs/s);
  assert.match(projectMemory, /即使触发自动 sidecar.*不等于索要操作/s);
  assert.match(projectMemory, /prior memory.*preserve expensive finding.*后台 sidecar/s);
  assert.match(projectMemory, /普通任务.*final.*不得.*持久保留.*已保存.*归档.*Memory.*校验/s);
  assert.match(projectMemory, /final.*独立句.*直接陈述.*不.*结论/s);
  assert.match(projectMemory, /final.*事实本身.*主语.*当前架构边界为.*不.*正式文档确认/s);
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
  assert.match(operatingModel, /一次性.*授权.*不.*捕获/s);
  assert.match(architecture, /mode.*verbatim.*summary/s);
  assert.match(architecture, /close-input.*core\.md/s);
});
