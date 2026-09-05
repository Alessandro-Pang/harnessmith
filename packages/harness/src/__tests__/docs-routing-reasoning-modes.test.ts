import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import { routeDocumentation } from '../lib/documentation/docs-routing.js';

const docsRoot = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'template',
  'agent-harness',
  'docs',
);

test.each([
  '请用贝叶斯推理分析这几个可能原因。',
  '请做一次事前验尸，判断这个发布方案如何失败。',
  '请使用信息价值原则决定是否继续调查。',
  '请用 OODA 循环推进这个多步骤任务。',
  '请用批判性思维审查这个实现方案。',
])(
  'documentation routing exposes requested reasoning modes as deferred references: %s',
  (query) => {
    const report = routeDocumentation(docsRoot, [query], { intent: 'research-and-design' });
    assert.ok(
      report.references.some(({ name }) => name === 'reasoning-modes'),
      `${query} did not route to reasoning-modes`,
    );
    assert.ok(report.reasoningModes.length > 0, `${query} did not select a reasoning mode`);
    assert.ok(report.reasoningModes.every(({ activation }) => activation === 'explicit'));
  },
);

test.each([
  ['登录偶发失败，请分析最可能的原因，并列出还需要哪些证据。', 'evidence-update'],
  [
    '评审这个权限设计，说明攻击者可能如何绕过，以及发布后最可能在哪里失败。',
    'failure-and-consequence',
  ],
  ['比较这三个方案，结合长期副作用和继续调查的成本给出建议。', 'decision-under-uncertainty'],
])(
  'documentation routing infers a reasoning mode from task structure without theory names: %s',
  (query, expectedMode) => {
    const report = routeDocumentation(docsRoot, [query], { intent: 'research-and-design' });
    const activation = report.reasoningModes.find(({ mode }) => mode === expectedMode);
    assert.ok(activation, `${query} did not infer ${expectedMode}`);
    assert.equal(activation.activation, 'inferred');
    assert.ok(activation.matchedSignals.length >= 2);
    assert.ok(activation.section.length > 0);
    assert.ok(activation.requiredArtifacts.length > 0);
    assert.ok(report.references.some(({ name }) => name === 'reasoning-modes'));
  },
);

test('documentation routing does not activate a reasoning mode for a simple low-risk change', () => {
  const report = routeDocumentation(docsRoot, ['把按钮颜色改成蓝色。'], { intent: 'change' });
  assert.deepEqual(report.reasoningModes, []);
  assert.equal(
    report.references.some(({ name }) => name === 'reasoning-modes'),
    false,
  );
});

test('documentation routing challenges a prescribed complex means before execution', () => {
  const report = routeDocumentation(
    docsRoot,
    ['实现权限功能，必须引入复杂策略引擎和多层抽象架构。'],
    { intent: 'change' },
  );
  const activation = report.reasoningModes.find(({ mode }) => mode === 'pre-execution-judgment');
  assert.ok(activation);
  assert.equal(activation.activation, 'inferred');
  assert.ok(activation.matchedSignals.length >= 3);
  assert.ok(activation.requiredArtifacts.includes('proposed-means'));
  assert.ok(activation.requiredArtifacts.includes('alternatives'));
  assert.ok(report.references.some(({ name }) => name === 'reasoning-modes'));
});

test('explicit reasoning activation exposes the selected section and output contract', () => {
  const report = routeDocumentation(docsRoot, ['请使用贝叶斯推理分析原因。'], {
    intent: 'research-and-design',
  });
  assert.deepEqual(report.reasoningModes, [
    {
      mode: 'evidence-update',
      activation: 'explicit',
      matchedSignals: ['贝叶斯推理'],
      section: '2. 证据更新',
      requiredArtifacts: [
        'hypotheses',
        'supporting-evidence',
        'conflicting-evidence',
        'next-verification',
        'confidence',
      ],
    },
  ]);
});

test.each([
  '不要使用贝叶斯推理分析原因。',
  '例如使用贝叶斯推理分析原因。',
  '请解释“贝叶斯推理”这个概念。',
])(
  'documentation routing does not activate reasoning aliases in negated, illustrative, or quoted references: %s',
  (query) => {
    const report = routeDocumentation(docsRoot, [query], { intent: 'research-and-design' });
    assert.equal(
      report.reasoningModes.some(({ mode }) => mode === 'evidence-update'),
      false,
    );
  },
);

test('documentation routing reports explicit reasoning modes omitted by the hard mode budget', () => {
  const report = routeDocumentation(
    docsRoot,
    ['请使用第一性原理、贝叶斯推理、对抗式审查和决策矩阵。'],
    { intent: 'research-and-design' },
  );
  assert.equal(report.reasoningModes.length, 2);
  assert.equal(report.omittedReasoningModes.length, 2);
  assert.ok(report.omittedReasoningModes.every(({ activation }) => activation === 'explicit'));
});
