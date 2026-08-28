import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { routeDocumentation } from '../lib/docs-routing.js';
import { sourceHarnessRoot } from './helpers/harness.js';

const docsRoot = join(sourceHarnessRoot, 'docs');

test('documentation routing accepts canonical Chinese task aliases', () => {
  const report = routeDocumentation(docsRoot, ['评审']);
  assert.deepEqual(
    report.routes.map(({ name }) => name),
    ['review'],
  );
  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.deepEqual(report.topics, []);
});

test('documentation routing separates one task playbook from supporting topics', () => {
  const report = routeDocumentation(docsRoot, ['重新审视 AGENTS.md 及其他 prompt 的设计和说明']);

  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['project-agents'],
  );
});

test('documentation routing keeps Git and safety as topics without giving either extra task weight', () => {
  const report = routeDocumentation(docsRoot, ['检查 Git 分支命名和安全风险']);

  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['safety-and-verification', 'git-conventions'],
  );
});

test('documentation routing rejects equally ranked playbook ambiguity', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-doc-routes-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'manifest.yaml'),
    `version: 1
entries:
  first:
    kind: playbook
    priority: 10
    path: first.md
    triggers: [检查]
  second:
    kind: playbook
    priority: 10
    path: second.md
    triggers: [检查]
`,
  );

  assert.throws(() => routeDocumentation(root, ['检查']), /ambiguous documentation playbooks/i);
});

test('documentation routing rejects trigger substrings inside unrelated words', () => {
  assert.deepEqual(routeDocumentation(docsRoot, ['digital']).routes, []);
});

test.each(['创建分支', '给我创建一个分支名', '请检查这个提交规范'])(
  'documentation routing matches CJK triggers inside natural sentences for %s',
  (query) => {
    const routes = routeDocumentation(docsRoot, [query]).routes.map(({ name }) => name);
    assert.ok(routes.includes('git-conventions'), `${query} did not route to git-conventions`);
  },
);

test.each([
  'multi-stage task with verified phase',
  'context budget compaction',
  '多阶段任务，阶段已验证仍有后续',
  '上下文预算信号',
])('documentation routing reaches staged handoff guidance for %s', (query) => {
  const routes = routeDocumentation(docsRoot, [query]).routes.map(({ name }) => name);
  assert.ok(routes.includes('long-running-tasks'), `${query} did not route to long-running-tasks`);
  assert.ok(routes.includes('project-agent-docs'), `${query} did not route to project-agent-docs`);
});

test('debugging a long-running handoff chooses diagnose and loads only supporting topics', () => {
  const report = routeDocumentation(docsRoot, ['调试长任务 handoff CLI']);

  assert.equal(report.primaryPlaybook?.name, 'diagnose');
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['operating-model', 'harness-cli-architecture', 'long-running-tasks', 'project-agent-docs'],
  );
});

test('an exact multi-turn acceptance prompt routes every required autopilot owner', () => {
  const report = routeDocumentation(docsRoot, [
    'Change docs/status.txt from pending to ready. Acceptance: node verify-autopilot.mjs docs/status.txt exits 0 and no other tracked file changes. For all future tasks, keep status summaries to one sentence.',
  ]);

  assert.equal(report.primaryPlaybook?.name, 'change');
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['harness-cli-architecture', 'long-running-tasks', 'project-agent-docs', 'user-profile-memory'],
  );
});

test('local Harness profile controls route locally instead of to product documentation', () => {
  const report = routeDocumentation(docsRoot, ['Pause this local Harness profile autopilot.']);

  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['harness-cli-architecture', 'user-profile-memory'],
  );
  assert.ok(!report.routes.some(({ name }) => name === 'tool-routing'));
});

test('runtime audit, policy decision, and token cost queries route to observability guidance', () => {
  const report = routeDocumentation(docsRoot, ['查看运行审计、policy decision 和 token 成本']);
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['observability'],
  );
});
