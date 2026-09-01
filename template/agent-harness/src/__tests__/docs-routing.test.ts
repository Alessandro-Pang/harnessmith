import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { routeDocumentation } from '../lib/docs-routing.js';
import { resolveResponseLanguage } from '../lib/response-language.js';
import { sourceHarnessRoot } from './helpers/harness.js';

const docsRoot = join(sourceHarnessRoot, 'docs');

test('documentation routing accepts canonical Chinese task aliases', () => {
  const report = routeDocumentation(docsRoot, ['评审']);
  assert.equal(report.version, 3);
  assert.equal(report.status, 'matched');
  assert.deepEqual(
    report.routes.map(({ name }) => name),
    ['review'],
  );
  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.deepEqual(report.topics, []);
});

test('documentation routing maps an explicit intent without re-inferring it from mentioned actions', () => {
  const report = routeDocumentation(docsRoot, ['通过第一性原理分析当前项目，实现方面是否合理？'], {
    intent: 'research-and-design',
  });

  assert.equal(report.version, 3);
  assert.deepEqual(report.intent, {
    requested: 'research-and-design',
    source: 'explicit',
    mentionedActions: ['change', 'research-and-design'],
    negatedActions: [],
  });
  assert.equal(report.status, 'matched');
  assert.equal(report.primaryPlaybook?.name, 'research-and-design');
});

test.each([
  ['分析当前项目，实现方面是否合理。', 'research-and-design'],
  ['实现思想是否合理？', null],
  ['根据评审结果，形成对应的解决方案。', null],
  ['进行逐个实施。', 'change'],
])('documentation routing conservatively classifies real request %s', (query, expected) => {
  const report = routeDocumentation(docsRoot, [query]);
  assert.equal(report.primaryPlaybook?.name ?? null, expected);
});

test('documentation routing separates one task playbook from supporting topics', () => {
  const report = routeDocumentation(docsRoot, ['重新审视 AGENTS.md 及其他 prompt 的设计和说明']);

  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['project-agents'],
  );
});

test('documentation routing treats review and research examples as concepts rather than requested actions', () => {
  const report = routeDocumentation(docsRoot, [
    '为什么只读任务不写入记忆？比如分析 xxx、评审 xxx、调研 xxx 都会产生高价值内容。',
  ]);

  assert.equal(report.primaryPlaybook, null);
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['operating-model', 'project-agent-docs'],
  );
});

test('documentation routing chooses research when the user explicitly asks to analyze prompt design', () => {
  const report = routeDocumentation(docsRoot, ['结合这个 QA 来分析 Prompt 的优化']);

  assert.equal(report.primaryPlaybook?.name, 'research-and-design');
});

test('documentation routing maps architecture and prompt design to their exact owners', () => {
  const report = routeDocumentation(
    docsRoot,
    ['通过第一性原理分析当前项目的架构设计、Prompt 设计和实现原理。'],
    { intent: 'research-and-design' },
  );

  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['harness-cli-architecture', 'prompt-rule-contract'],
  );
  assert.deepEqual(report.omittedTopics, []);
});

test('documentation routing ranks supporting evidence and reports topics beyond its context bound', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-doc-topic-routes-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'manifest.yaml'),
    `version: 1
entries:
  change:
    kind: playbook
    path: change.md
    actionAliases: [change]
  first:
    kind: topic
    path: first.md
    conceptAliases: [shared]
  exact-owner:
    kind: standard
    path: exact-owner.md
    conceptAliases: [shared, exact concept]
  third:
    kind: topic
    path: third.md
    conceptAliases: [shared]
  fourth:
    kind: topic
    path: fourth.md
    conceptAliases: [shared]
  fifth:
    kind: topic
    path: fifth.md
    conceptAliases: [shared]
`,
  );

  const report = routeDocumentation(root, ['change shared exact concept']);
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['exact-owner', 'first', 'third', 'fourth'],
  );
  assert.deepEqual(
    report.omittedTopics.map(({ name }) => name),
    ['fifth'],
  );
  assert.deepEqual(
    report.routes.map(({ name }) => name),
    ['change', 'exact-owner', 'first', 'third', 'fourth'],
  );
});

test.each([
  '这里引用了“review、design、research”三个词，但没有要求执行这些任务。',
  '文档举例包含评审、设计和调研，不代表当前要执行其中任何一项。',
])(
  'documentation routing does not select a playbook from quoted or explanatory mentions for %s',
  (query) => {
    assert.equal(routeDocumentation(docsRoot, [query]).primaryPlaybook, null);
  },
);

test('documentation routing keeps Git and safety as topics without giving either extra task weight', () => {
  const report = routeDocumentation(docsRoot, ['检查 Git 分支命名和安全风险']);

  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['git-conventions', 'safety-and-verification'],
  );
});

test('documentation routing reports equally ranked playbook ambiguity without guessing', () => {
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
    actionAliases: [检查]
  second:
    kind: playbook
    priority: 10
    path: second.md
    actionAliases: [检查]
`,
  );

  const report = routeDocumentation(root, ['检查']);
  assert.equal(report.status, 'ambiguous');
  assert.equal(report.primaryPlaybook, null);
  assert.deepEqual(report.ambiguity, ['first', 'second']);
});

test('documentation routing rejects trigger substrings inside unrelated words', () => {
  const report = routeDocumentation(docsRoot, ['digital']);
  assert.equal(report.status, 'unmatched');
  assert.deepEqual(report.routes, []);
});

test('CJK punctuation and mixed-language requests preserve action intent', () => {
  for (const query of [
    '请评审这个 change plan。',
    'Please review 这个变更方案。',
    '请检查：Git branch 命名。',
  ]) {
    const report = routeDocumentation(docsRoot, [query]);
    assert.equal(report.primaryPlaybook?.name, 'review', query);
    assert.equal(report.status, 'matched', query);
  }
});

test.each([
  '不要评审，只分析这个方案。',
  'Do not review; analyze the design instead.',
  'For example, review and implement are action words. Now diagnose the actual failure.',
  '“请评审这个方案”只是引用，不是当前请求。',
  'The phrase "implement the fix" is an example, not an instruction.',
])(
  'negation, quotation, and meta discussion do not select the mentioned action for %s',
  (query) => {
    const report = routeDocumentation(docsRoot, [query]);
    assert.notEqual(
      report.primaryPlaybook?.name,
      query.includes('implement the fix') ? 'change' : 'review',
    );
  },
);

test('Chinese exclusive action prefix selects the requested action after a negated one', () => {
  const report = routeDocumentation(docsRoot, ['不要发布，只评审 release 风险。']);
  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.ok(!report.routes.some(({ name }) => name === 'release-and-external'));
});

test('response language priority is current explicit, persisted evidence, then detection', () => {
  assert.deepEqual(
    resolveResponseLanguage('Please inspect this change.', {
      currentExplicit: 'zh-CN',
      persisted: { language: 'en', evidence: 'explicit' },
    }),
    { language: 'zh-CN', source: 'current-explicit', profileMutation: 'none' },
  );
  assert.deepEqual(
    resolveResponseLanguage('请检查这个 change。', {
      persisted: { language: 'en', evidence: 'observed' },
    }),
    { language: 'en', source: 'persistent-observed', profileMutation: 'none' },
  );
  assert.deepEqual(resolveResponseLanguage('请检查这个 change。'), {
    language: 'zh-CN',
    source: 'detected',
    profileMutation: 'none',
  });
});

test('one-turn translation and rewrite requests never become persistent language evidence', () => {
  const report = routeDocumentation(docsRoot, ['Translate this sentence into Chinese.']);
  assert.equal(report.responseLanguage.profileMutation, 'none');
  assert.equal(report.responseLanguage.source, 'detected');

  assert.throws(
    () =>
      resolveResponseLanguage('Rewrite this in English.', {
        persisted: { language: 'en', evidence: 'transient' as 'explicit' },
      }),
    /persistent language evidence/i,
  );
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
  'Change docs/phase-a.txt from pending to ready and run node verify-phase.mjs docs/phase-a.txt.',
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

test('diagnostic routing ignores negated change intent and generic explanation wording', () => {
  const report = routeDocumentation(docsRoot, [
    'Diagnose a failing focused test and explain the likely cause. Do not implement a fix.',
  ]);

  assert.equal(report.primaryPlaybook?.name, 'diagnose');
  assert.deepEqual(report.topics, []);
  assert.ok(!report.routes.some(({ name }) => name === 'change'));
  assert.ok(!report.routes.some(({ name }) => name === 'harness-cli-architecture'));
});

test('diagnostic routing ignores negated Chinese change intent', () => {
  const report = routeDocumentation(docsRoot, ['诊断失败测试，不要修改代码']);

  assert.equal(report.primaryPlaybook?.name, 'diagnose');
  assert.ok(!report.routes.some(({ name }) => name === 'change'));
});

test('an exact multi-turn acceptance prompt routes every required autopilot owner', () => {
  const report = routeDocumentation(docsRoot, [
    'Change docs/status.txt from pending to ready. Acceptance: node verify-autopilot.mjs docs/status.txt exits 0 and no other tracked file changes. For all future tasks, keep status summaries to one sentence.',
  ]);

  assert.equal(report.primaryPlaybook?.name, 'change');
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['project-agent-docs', 'harness-cli-architecture', 'long-running-tasks', 'user-profile-memory'],
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

test.each(['审查 Prompt 的保证等级和规则 owner', 'compare confusing-pair fallback contracts'])(
  'prompt rule contract routes as a supporting standard for %s',
  (query) => {
    const report = routeDocumentation(docsRoot, [query]);
    assert.ok(
      report.topics.some(({ name }) => name === 'prompt-rule-contract'),
      `${query} did not route to prompt-rule-contract`,
    );
  },
);
