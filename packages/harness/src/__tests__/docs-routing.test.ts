import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { routeDocumentation } from '../lib/documentation/docs-routing.js';
import { sourceHarnessRoot } from './helpers/harness.js';

const docsRoot = join(sourceHarnessRoot, 'docs');

test('documentation routing accepts canonical Chinese task aliases', () => {
  const report = routeDocumentation(docsRoot, ['评审']);
  assert.equal(report.version, 3);
  assert.deepEqual(report.rawQuery, ['评审']);
  assert.deepEqual(report.normalizedQuery, ['评审']);
  assert.equal(report.status, 'matched');
  assert.deepEqual(
    report.routes.map(({ name }) => name),
    ['review'],
  );
  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.deepEqual(report.topics, []);
});

test('documentation routing preserves raw query separately from normalized terms', () => {
  const rawQuery = ['  Please  review   Git branch  '];
  const report = routeDocumentation(docsRoot, rawQuery);

  assert.deepEqual(report.rawQuery, rawQuery);
  assert.deepEqual(report.normalizedQuery, ['please review git branch']);
  assert.deepEqual(report.query, report.normalizedQuery);
});

test('documentation routing joins CLI argv before classifying action intent', () => {
  const negated = routeDocumentation(docsRoot, ['Do', 'not', 'review']);
  assert.equal(negated.primaryPlaybook, null);
  assert.deepEqual(negated.intent.negatedActions, ['review']);

  const requested = routeDocumentation(docsRoot, ['please', 'review', 'Git']);
  assert.equal(requested.primaryPlaybook?.name, 'review');
  assert.deepEqual(
    requested.topics.map(({ name }) => name),
    ['git-conventions'],
  );
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
    ['project-agents', 'prompt-rule-contract'],
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
  assert.deepEqual(
    report.references.map(({ name }) => name),
    ['reasoning-modes'],
  );
  assert.deepEqual(report.omittedTopics, []);
});

test('documentation routing recognizes prompt-system wording used in real audits', () => {
  const report = routeDocumentation(
    docsRoot,
    ['请审查当前 Prompt 体系的结构、信息密度、上下文占用和实际可执行性。'],
    { intent: 'review' },
  );

  assert.equal(report.primaryPlaybook?.name, 'review');
  assert.ok(
    report.topics.some(({ name }) => name === 'prompt-rule-contract'),
    'prompt audits must load the prompt-rule owner',
  );
});

test('documentation routing exposes the runtime architecture owner for package audits', () => {
  const report = routeDocumentation(docsRoot, ['请审查 /packages/harness 目录。'], {
    intent: 'review',
  });

  assert.ok(
    report.topics.some(
      ({ name, matchedAliases }) =>
        name === 'harness-cli-architecture' && matchedAliases.includes('packages/harness'),
    ),
    'package audits must load the runtime architecture owner',
  );
});

test.each(['请修复这个路由问题', 'please repair the routing contract'])(
  '%s routes to change',
  (query) => {
    assert.equal(routeDocumentation(docsRoot, [query]).primaryPlaybook?.name, 'change');
  },
);

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

test('documentation routing prioritizes required topics within a hard topic budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-required-topic-routes-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'manifest.yaml'),
    `version: 1
entries:
  first:
    kind: topic
    path: first.md
    conceptAliases: [shared]
  second:
    kind: topic
    path: second.md
    conceptAliases: [shared]
  third:
    kind: topic
    path: third.md
    conceptAliases: [shared]
  fourth:
    kind: topic
    path: fourth.md
    conceptAliases: [shared]
  required-owner:
    kind: topic
    path: required-owner.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
`,
  );

  const report = routeDocumentation(root, ['shared mandatory']);
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['required-owner', 'first', 'second', 'third'],
  );
  assert.deepEqual(
    report.omittedTopics.map(({ name }) => name),
    ['fourth'],
  );
  assert.deepEqual(
    report.requiredTopics.map(({ name }) => name),
    ['required-owner'],
  );
  assert.deepEqual(report.omittedRequiredTopics, []);
});

test('documentation routing reports required topics omitted by the hard budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-required-overflow-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'manifest.yaml'),
    `version: 1
entries:
  required-a:
    kind: topic
    path: required-a.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-b:
    kind: topic
    path: required-b.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-c:
    kind: topic
    path: required-c.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-d:
    kind: topic
    path: required-d.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-e:
    kind: topic
    path: required-e.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
`,
  );

  const report = routeDocumentation(root, ['mandatory']);
  assert.deepEqual(
    report.requiredTopics.map(({ name }) => name),
    ['required-a', 'required-b', 'required-c', 'required-d'],
  );
  assert.deepEqual(
    report.omittedRequiredTopics.map(({ name }) => name),
    ['required-e'],
  );
  assert.deepEqual(report.omittedTopics, []);
});

test('documentation routing loads required topics before bounded optional topics', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-required-order-routes-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'manifest.yaml'),
    `version: 1
entries:
  optional-a:
    kind: topic
    path: optional-a.md
    conceptAliases: [shared]
  optional-b:
    kind: topic
    path: optional-b.md
    conceptAliases: [shared]
  required:
    kind: topic
    path: required.md
    conceptAliases: [required]
    requiredConceptAliases: [required]
`,
  );

  const report = routeDocumentation(root, ['shared required']);
  assert.deepEqual(
    report.requiredTopics.map(({ name }) => name),
    ['required'],
  );
  assert.deepEqual(
    report.topics.map(({ name }) => name),
    ['required', 'optional-a', 'optional-b'],
  );
  assert.deepEqual(
    report.routes.map(({ name }) => name),
    ['required', 'optional-a', 'optional-b'],
  );
});

test('documentation routing keeps deferred references out of supporting topics', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-reference-routes-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'manifest.yaml'),
    `version: 1
entries:
  reference:
    kind: topic
    load: reference
    owner: reference
    path: reference.md
    conceptAliases: [deep-reference]
  reference-secondary:
    kind: topic
    load: reference
    owner: reference
    path: reference-secondary.md
    conceptAliases: [deep-reference]
  supporting:
    kind: topic
    path: supporting.md
    conceptAliases: [supporting]
`,
  );

  const report = routeDocumentation(root, ['deep-reference']);
  assert.deepEqual(report.topics, []);
  assert.deepEqual(
    report.references.map(({ name }) => name),
    ['reference', 'reference-secondary'],
  );
  assert.deepEqual(report.omittedReferences, []);
  assert.deepEqual(
    report.routes.map(({ name }) => name),
    ['reference', 'reference-secondary'],
  );
});
