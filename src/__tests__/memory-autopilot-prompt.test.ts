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
  assert.doesNotMatch(agents, /memory list|task status|memory maintain/);
  assert.match(agents, /命中正文.*事实源/s);
});

test('background sidecars stay quiet while explicit Memory requests remain auditable', () => {
  assert.match(agents, /自动.*sidecar.*静默/s);
  assert.match(agents, /明确.*Memory.*action.*path.*validation/s);
  assert.match(projectMemory, /自动后台.*静默/s);
  assert.match(projectMemory, /用户明确请求.*action.*path.*validation/s);
});

test('documentation states the real host-hook and source-of-truth boundaries', () => {
  assert.match(projectMemory, /Memory.*非权威|非权威.*Memory/s);
  assert.match(architecture, /宿主事件 hook.*尚未提供/s);
  assert.match(architecture, /真实 Host Eval/s);
});
